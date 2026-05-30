---
name: verify-deployment-end-to-end
description: Create a real project from template, deploy end-to-end, discover runtime bugs, fix them, delete and re-run from scratch until scripts work zero-touch
source: auto-skill
extracted_at: '2026-05-29T21:00:00.000Z'
---

# Verify Deployment End-to-End

After building deploy automation scripts (see `build-deploy-automation` skill), you MUST verify them by creating a real project and running every step. Scripts that look correct in code review will still fail against real infrastructure. This skill describes the **delete-and-rerun** methodology that catches bugs invisible to static analysis.

## When to Use

- After building or significantly modifying deploy scripts
- After fixing bugs found during deployment — you must re-verify the fix actually works
- Before declaring deploy automation "done"
- When users report that scripts fail on fresh environments

## The Core Principle: Scripts Must Work Zero-Touch

The goal is: given two API tokens, the scripts run from Step 00 to Step 06 **without any human intervention, AI assistance, or parameter tweaking**. If you need to manually fix anything mid-run, the scripts are not done.

## The Delete-and-Rerun Methodology

### Validated Through 5 Rounds

This methodology was validated by running 7 complete rounds against real infrastructure:

| Round | Mode | Project | Steps Run | Bugs Found | Result |
|-------|------|---------|-----------|-----------|--------|
| Round 1 | Workers | xshop | 00→01→02→03 | 5 bugs | Multiple failures, each fixed individually |
| Round 2 | Workers | xshop | 01→02→03 (partial) | 4 bugs | stdout pollution, Homebrew timeout, SQL comments |
| Round 3 | Workers | xshop | 00→01→02→03→06 (full) | 3 bugs | Full-width brackets, APP_ORIGIN, CI type-check |
| Round 4 | Workers | xshop | 00→01→02→03→06 (full) | 3 bugs | Turso 502 retry, gh_check retry, CI first-run |
| Round 5 | Workers | xshop | 00→01→02→03→06 (zero changes) | 0 bugs | ✅ Zero-touch in 137s |
| Round 6 | Pages | xshop-static | 00→03 (full) | 7 bugs | Pages mode: cred_save pollution, set -u, wrangler params, stdout leaks, exit code |
| **Round 7** | **Pages** | **freelancer-calc** | **00→03→04→06 (full)** | **1 bug** | **04-bind-domain.sh only supported Workers mode, not Pages mode** |

**Total: 23 bugs found across 7 rounds, all fixed. 137/137 cf-core tests + 34/34 shared.sh tests passing.**

**Verified URLs**:
- Workers mode: https://xshop.mailforwdy.workers.dev
- Pages mode: https://xshop-static.pages.dev
- Pages mode (custom domain): https://opc.eforge.xyz (freelancer-calc project)

### What "Zero-Touch" Really Means

After 4 rounds, the honest answer is: **scripts are zero-touch for all script-level bugs**, but external services (Turso, GitHub API) can cause transient failures. The fix is to build retry logic INTO the scripts rather than relying on external service reliability. After adding retries, the scripts are truly zero-touch.

**Key insight from Round 4**: The user asked "did AI change anything mid-run?" The honest answer was YES — Turso returned 502 during migration, requiring AI to add retry logic to migrate.mjs. This is NOT a script bug but an **external service resilience gap**. The fix (retry logic) makes the scripts resilient to Turso's intermittent failures.

### Round 1: First Deployment (Expect Failures)

1. **Set up environment**:
   ```bash
   export CLOUDFLARE_API_TOKEN="cfat_xxx"
   export TURSO_API_TOKEN="eyJ..."
   export PROJECT_NAME="test-project"
   ```

2. **Create project from template**:
   ```bash
   cp -R templates/cf-shop ../test-project
   cd ../test-project
   # Adjust paths (template uses ../../packages/cf-core, standalone uses ./packages/cf-core)
   sed -i '' 's|../../packages/cf-core|../packages/cf-core|g' tsconfig.json
   sed -i '' 's|"file:../../packages/cf-core"|"file:./packages/cf-core"|' package.json
   sed -i '' 's|"name": "cf-shop"|"name": "test-project"|' wrangler.jsonc
   npm install
   ```

3. **Run steps one by one** (NOT one-click.sh first — you need to see each step's output):
   ```bash
   bash .deploy/00-init-project.sh   # Git + GitHub
   bash .deploy/01-setup-turso.sh     # Database
   bash .deploy/02-setup-secrets.sh   # Secrets
   bash .deploy/03-deploy-worker.sh   # Deploy
   ```

4. **Record every failure** with:
   - Exact error message
   - Which file and line
   - Root cause analysis
   - Fix applied

### Round 2: Delete Everything and Rerun

**This is the critical step most people skip.** After fixing bugs in Round 1:

1. **Delete the test project completely**:
   ```bash
   rm -rf ../test-project
   turso db destroy test-project-db --yes
   gh repo delete user/test-project --yes
   ```

2. **Recreate from scratch** — same steps as Round 1

3. **Run steps in sequence** — this time they should all pass without intervention

4. **If any step fails** → fix → delete → rerun from scratch again

### Round 3: One-Click Verification

Only after Round 2 passes cleanly:

```bash
# Full one-click run
CLOUDFLARE_API_TOKEN="cfat_xxx" \
TURSO_API_TOKEN="eyJ..." \
PROJECT_NAME="test-project" \
SKIP_DOMAIN=true \
SKIP_TURNSTILE=true \
bash .deploy/one-click.sh
```

## Bug Categories Found Only Through E2E

These bugs are **invisible to code review and unit tests** — they only appear when running against real infrastructure:

### Category 1: stdout Pollution (Fatal)

**Bug**: Functions that return values via `echo` also output log messages to stdout, which get captured by the caller.

```bash
# The function returns a value via echo
turso_get_org() {
  log_ok "Turso 组织: $_turso_org"   # ← This goes to stdout!
  echo "$_turso_org"                  # ← This ALSO goes to stdout
}

# Caller captures stdout
ORG=$(turso_get_org)
# ORG is now "[OK]    Turso 组织: qwsky\nqwsky" — TWO lines!
# Next API call: /organizations/[OK].../databases → 404
```

**Fix**: All log output in "return value" functions MUST go to stderr:
```bash
log_ok "Turso 组织: $_turso_org" >&2   # ← stderr, not captured
echo "$_turso_org"                       # ← stdout, captured correctly
```

**Detection**: If a step fails silently (no error message, just exits), check if the previous step's function polluted stdout.

**Rule**: **Any bash function whose return value is captured via `$()` must redirect ALL non-return output to stderr.**

### Category 2: External Tool Side Effects (High)

**Bug**: CLI tools trigger unexpected side effects (auto-updates, telemetry, version checks) that cause timeouts.

```bash
# turso CLI triggers Homebrew auto-update on macOS
turso db tokens create my-db
# → "Updating to the latest version..."
# → "==> Updating Homebrew..."
# → Downloads 500MB of formulae...
# → TIMEOUT after 120 seconds
```

**Fix**: Disable auto-updates and add timeouts:
```bash
export HOMEBREW_NO_AUTO_UPDATE=1
TURSO_TOKEN=$(timeout 30 turso db tokens create "$DB_NAME" 2>/dev/null | grep -E '^eyJ' | head -1)
```

**Detection**: If a step hangs for 60+ seconds with no output, check if the CLI tool is doing something unexpected.

**Rule**: **Always wrap external CLI calls with `timeout` and disable auto-update features.**

### Category 3: SQL Comment Handling (High)

**Bug**: Migration scripts split SQL by `;` but don't strip `--` comment lines first. Comments get sent as part of SQL statements.

```javascript
// ❌ WRONG — comment lines become part of SQL statements
const statements = sql.split(";").map(s => s.trim()).filter(s => s.length > 0);
// Result: "-- ============================================================\n-- cf-shop 数据库初始化...\nCREATE TABLE IF NOT EXISTS system_config..."
// Turso returns: SERVER_ERROR: HTTP 502

// ✅ RIGHT — strip comments first
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
```

**Detection**: If migration returns a generic server error (502, 500), check if the SQL being sent includes comment text.

**Rule**: **Always strip `--` comment lines before splitting SQL by `;` in migration scripts.**

### Category 4: API Field Name Case Sensitivity (Fatal)

**Bug**: APIs return lowercase field names but scripts use PascalCase.

```bash
# Turso API returns: {"slug": "qwsky", "name": "personal"}
# Script expects: .[0].Name (PascalCase)
_turso_org=$(echo "$resp" | jq -r '.[0].Name // empty')
# Result: empty string → subsequent API calls fail
```

**Fix**: Always test API responses and use the actual field names:
```bash
_turso_org=$(echo "$resp" | jq -r '.[0].slug // .[0].name // empty')
```

**Detection**: If an API-derived variable is empty when it shouldn't be, the field name is probably wrong.

**Rule**: **Never guess API field names. Always test with `curl | jq .` first.**

### Category 5: URL Parsing Assumptions (High)

**Bug**: Scripts hardcode URL patterns that don't match reality.

```bash
# ❌ WRONG — assumes simple workers.dev pattern
BASE_URL="https://${WORKER_NAME}.workers.dev"
# Actual URL: https://xshop.mailforwdy.workers.dev (includes account subdomain)

# ✅ RIGHT — parse from deploy output
DEPLOY_OUTPUT=$(npx wrangler deploy --secrets-file=... 2>&1)
BASE_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1)
```

**Detection**: If smoke tests fail with connection errors but the Worker is confirmed deployed via API, the URL is wrong.

**Rule**: **Never hardcode URLs. Always parse from tool output or API responses.**

### Category 6: External Service Transient Errors (High)

**Bug**: External services (Turso, GitHub API) return 502/503/504 intermittently, causing script failure with no retry.

```javascript
// ❌ WRONG — no retry, Turso 502 kills the migration
for (const stmt of statements) {
  try {
    await client.execute(stmt);
  } catch (err) {
    if (err.message?.includes("already exists")) { continue; }
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);  // ← Turso 502 = instant death
  }
}

// ✅ RIGHT — retry 3 times with increasing delay for transient errors
for (const stmt of statements) {
  let retries = 3;
  while (retries > 0) {
    try {
      await client.execute(stmt);
      break;
    } catch (err) {
      if (err.message?.includes("already exists")) { break; }
      if (err.message?.includes("502") || err.message?.includes("503") || err.message?.includes("SERVER_ERROR")) {
        retries--;
        if (retries > 0) {
          const delay = (4 - retries) * 2 + 2;
          console.warn(`⚠️ Transient error, retry in ${delay}s (${retries} left)...`);
          await new Promise((r) => setTimeout(r, delay * 1000));
          continue;
        }
      }
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  }
}
```

**Detection**: If a step fails with a generic server error (502, 503, 504, SERVER_ERROR) that doesn't reproduce on retry, it's a transient external failure.

**Rule**: **All external service calls (database, API, CLI) must have retry logic with at least 3 attempts and increasing delays.**

### Category 7: Network-Dependent CLI Tools (Medium)

**Bug**: CLI tools that make network calls (gh, turso, wrangler) can fail due to network instability, especially from regions with high latency to GitHub/Cloudflare APIs.

```bash
# ❌ WRONG — single attempt, network glitch = step failure
gh_check() {
  if ! gh auth status &>/dev/null 2>&1; then
    log_error "gh CLI 未登录"
    return 1
  fi
}

# ✅ RIGHT — 3 retries with 2s interval
gh_check() {
  for attempt in 1 2 3; do
    if gh auth status &>/dev/null 2>&1; then
      log_ok "gh CLI 已登录"
      return 0
    fi
    [ "$attempt" -lt 3 ] && { log_warn "gh auth 失败 (${attempt}/3)，2s 后重试..."; sleep 2; }
  done
  log_error "gh CLI 未登录 — gh auth login"
  return 1
}
```

**Detection**: If a step fails intermittently (works sometimes, fails other times), it's likely a network-dependent CLI tool.

**Rule**: **All CLI tools that make network calls must have retry logic (3 attempts, 2s interval).**

### Category 8: deploy.yml Exists in Two Locations (High)

**Bug**: The deploy.yml workflow file exists in TWO places within each template:
1. `templates/cf-shop/.github/workflows/deploy.yml` — committed by Step 00 (initial push)
2. `templates/cf-shop/.deploy/workflows/deploy.yml` — copied over by Step 06

If you fix a bug in `.deploy/workflows/deploy.yml` but forget to sync to `.github/workflows/deploy.yml`, the FIRST CI run (triggered by Step 00's push) uses the OLD version, and the SECOND CI run (triggered by Step 06's push) uses the NEW version.

```bash
# After ANY fix to .deploy/workflows/deploy.yml, sync to ALL locations:
for tpl in cf-shop cf-api cf-tools; do
  cp .deploy/workflows/deploy.yml "$tpl/.github/workflows/deploy.yml"
  cp .deploy/workflows/deploy.yml "$tpl/.deploy/workflows/deploy.yml"
done
```

**Detection**: If the first CI run fails but the second CI run passes, check if the two deploy.yml files are different.

**Rule**: **deploy.yml must be byte-identical in `.github/workflows/` and `.deploy/workflows/` for every template.**

### Category 9: CI First-Run Failure Is Expected Behavior (Info)

**Not a bug**: The first CI run (triggered by Step 00's `git push`) WILL fail because GitHub Actions Secrets haven't been set yet (Step 06 sets them). The second CI run (triggered by Step 06's `git push`) will succeed.

**Why this happens**:
1. Step 00: `git push` → GitHub Actions triggers `deploy.yml` → Secrets are empty → Deploy fails
2. Step 06: Sets all Secrets via `gh secret set` → `git push` → GitHub Actions triggers `deploy.yml` → Secrets available → Deploy succeeds

**User communication**: Document this clearly so users don't panic when they see the first CI failure. Add to the deployment summary:
```
ℹ️ GitHub Actions 首次 CI 运行会失败（Secrets 尚未设置），Step 06 完成后第二次 CI 会自动通过。
```

**Rule**: **Document expected CI failures so users don't waste time debugging them.**

## The Smoke Test Strategy

After deployment, run THREE levels of verification:

### Level 1: CF API Verification (Authoritative)

```bash
# Confirm Worker exists via Cloudflare API — this is the ground truth
CF_ACCOUNT_ID=$(curl -sS "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id')

curl -sS "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | \
  jq -r ".result[] | select(.id == \"${WORKER_NAME}\") | .id"
```

If this returns the worker name, deployment succeeded — even if HTTP tests fail.

### Level 2: HTTP Smoke Test (With Timeout Tolerance)

```bash
# workers.dev may be unreachable from some regions — timeout is a WARNING, not a FAILURE
HTTP_STATUS=$(curl -sS -o /tmp/smoke.json -w "%{http_code}" --max-time 10 \
  "${BASE_URL}/api/health" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
  log_ok "Health check passed"
elif [ "$HTTP_STATUS" = "000" ]; then
  log_warn "HTTP timeout (workers.dev may be unreachable from this region)"
  log_info "Worker confirmed online via CF API — bind custom domain for stable access"
fi
```

### Level 3: Auth Smoke Test

```bash
# No token → 401
curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/admin/summary"
# Expected: 401

# Valid token → 200
curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  "${BASE_URL}/api/admin/summary"
# Expected: 200
```

## Post-Deployment Checklist

```
□ All steps completed without manual intervention
□ GitHub repo created and code pushed
□ Turso database created with all migrations applied
□ Worker deployed and confirmed via CF API
□ All secrets uploaded to both CF Workers and GitHub Actions
□ CI/CD workflows installed and triggered
□ Smoke tests pass (or timeout with CF API confirmation)
□ .credentials/ directory contains all generated values
□ No step required re-running due to failure
```

## Syncing Fixes Back to Source

When bugs are found in the test project's `.deploy/` scripts:

1. **Fix in the source template**: `templates/.deploy/shared.sh` (NOT the test project)
2. **Sync to all product templates**:
   ```bash
   for tpl in cf-shop cf-api cf-tools; do
     cp templates/.deploy/shared.sh "templates/$tpl/.deploy/shared.sh"
   done
   ```
3. **Sync to the test project**:
   ```bash
   cp templates/.deploy/shared.sh ../test-project/.deploy/shared.sh
   ```
4. **Commit both**: the source template fix AND the test project fix

## Documenting Findings

Create a **pitfall record** document with:

| Bug # | Severity | Description | Root Cause | Fix | Iron Rule |
|-------|----------|-------------|-----------|-----|-----------|
| 1 | Fatal | stdout pollution | `log_ok` in return-value function | `>&2` redirect | All log in captured functions → stderr |
| 2 | High | Homebrew timeout | CLI auto-update | `HOMEBREW_NO_AUTO_UPDATE=1` | Always wrap CLI with timeout |
| 3 | High | SQL comments | `--` lines not stripped | Filter before split | Strip comments before SQL split |

Each bug gets an **Iron Rule** — a one-sentence principle that prevents the entire class of bug.

## Key Lessons Learned

1. **Scripts that pass code review still fail in production** — there is no substitute for running them
2. **Delete-and-rerun is non-negotiable** — fixing a bug and re-running the failing step is NOT sufficient; you must rerun from scratch to verify the fix doesn't break earlier steps
3. **stdout pollution is the #1 silent bash bug** — any function whose output is captured via `$()` must redirect all non-return output to stderr
4. **External CLI tools have side effects** — auto-updates, telemetry, version checks can all cause timeouts
5. **Never guess API field names** — always `curl | jq .` first to see the actual response shape
6. **Smoke test with timeout tolerance** — `workers.dev` may be unreachable from some regions; CF API verification is the ground truth
7. **Fix in source, sync everywhere** — never fix only the test project; always fix the source template and propagate
8. **Four rounds minimum**: Round 1 (discover bugs) → Round 2 (verify fixes from scratch) → Round 3 (full pipeline) → Round 4 (no code changes, pure verification)
9. **Document iron rules, not just fixes** — a fix solves one bug; an iron rule prevents the entire class
10. **The goal is zero human intervention** — if you need to manually tweak anything mid-run, the scripts are not done
11. **External services WILL fail transiently** — Turso 502, GitHub API timeouts are inevitable; build retry logic INTO the scripts (3 attempts, increasing delays)
12. **deploy.yml exists in TWO locations per template** — `.github/workflows/` (Step 00 commits) and `.deploy/workflows/` (Step 06 copies); they MUST be byte-identical after any fix
13. **CI first-run failure is expected** — Step 00 pushes code before Secrets exist; Step 06 sets Secrets and triggers a second CI run that succeeds. Document this so users don't panic
14. **Be honest about what "zero-touch" means** — after 4 rounds, scripts are zero-touch for all script-level bugs, but external service resilience gaps (Turso 502) required one-time fixes. True zero-touch means building retries for every external call

## Pre-Deployment Static Testing (7-Test Matrix)

Before running against real infrastructure, execute a **static testing matrix** that catches bugs without consuming any API quota or tokens. This was validated on 2026-05-30 with 115+ automated tests across 5 templates.

### Test 1: Environment Prerequisites

Verify all tools required by the deploy scripts are available:

```bash
for cmd in rtk node npm gh jq curl openssl wrangler turso; do
  which $cmd >/dev/null 2>&1 && echo "✓ $cmd" || echo "✗ $cmd NOT FOUND"
done
```

**Key insight**: `wrangler` may not be globally installed but available via `npx wrangler`. Test both paths.

### Test 2: Bash Syntax Check (ALL Scripts)

Run `bash -n` on every .sh file across all templates and the shared `.deploy/` directory:

```bash
find templates/ -name "*.sh" -type f | while read f; do
  bash -n "$f" 2>&1 && echo "✓ $f" || echo "✗ $f"
done
```

**Expected**: 51/51 pass (5 templates × 10 scripts + 1 shared).

### Test 3: YAML Syntax Check (ALL Workflows)

Use Python's PyYAML to validate every .yml file:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$file"
```

Check both `.github/workflows/` and `.deploy/workflows/` for each template.

**Expected**: 20/20 pass (5 templates × 4 workflow files).

### Test 4: Scaffold Script Full Flow

Run the `create-project.mjs` (or equivalent) for **every template**, then verify the output:

```bash
for tmpl in cf-shop cf-api cf-tools cf-static cf-form; do
  echo "Y" | node scripts/create-project.mjs "test-$tmpl" \
    --template "$tmpl" --domain "test-$tmpl.example.com" --output /tmp/test

  # Verify: directory exists, package.json name replaced, .deploy-mode correct, .git initialized
  # Verify: wrangler.jsonc name replaced (use node to parse JSONC, stripping comments)
  # Verify: seo-config.json (for cf-static) has correct siteName
done
```

**Critical bug found**: seo-config.json was updated BEFORE text replacement ran, causing double replacement (`"cf-static"` → `"test-cf-static"`, then text replace turned it into `"test-test-cf-static"`). **Fix**: always run JSON-specific updates AFTER generic text replacement.

### Test 5: Environment Variable Pre-Check

Verify that one-click.sh correctly fails when required env vars are missing:

```bash
# Workers mode: should fail without both CLOUDFLARE_API_TOKEN and TURSO_API_TOKEN
CLOUDFLARE_API_TOKEN="" TURSO_API_TOKEN="" bash -c 'source .deploy/shared.sh && check_env CLOUDFLARE_API_TOKEN || echo "FAIL"'

# Pages mode: should fail without CLOUDFLARE_API_TOKEN only
CLOUDFLARE_API_TOKEN="" bash -c 'source .deploy/shared.sh && check_env CLOUDFLARE_API_TOKEN || echo "FAIL"'

# With token set: should pass
CLOUDFLARE_API_TOKEN="cfat_test" bash -c 'source .deploy/shared.sh && check_env CLOUDFLARE_API_TOKEN && echo "OK"'
```

### Test 6: Dependency Chain Verification

For each deploy script (00-06), catalog its **inputs** (cred_load calls) and **outputs** (cred_save calls). Verify the chain is complete:

```
Step 00 → saves: GITHUB_REPO, PROJECT_NAME
Step 01 → loads: PROJECT_NAME ← 00; saves: TURSO_URL, TURSO_TOKEN, DB_NAME
Step 02 → saves: ADMIN_TOKEN, RATE_LIMIT_SALT, JWT_SECRET, CREDENTIALS_ENCRYPTION_KEY
Step 03 → loads: PROJECT_NAME←00, TURSO_URL←01, TURSO_TOKEN←01, secrets←02; saves: WORKER_NAME, BASE_URL
Step 04 → loads: WORKER_NAME←03; saves: DOMAIN, BASE_URL
Step 05 → loads: WORKER_NAME←03, DOMAIN←04, TURSO_URL←01; saves: TURNSTILE keys
Step 06 → loads: everything; saves: (final)
```

**Verify**: every cred_load in a step has a matching cred_save in an earlier step.

### Test 7: Regression Tests

Run all existing unit tests after deployment-related changes:

```bash
cd packages/cf-core && npm test              # 81/81
cd templates/cf-form && npx tsc --noEmit      # no errors
cd templates/cf-static && node scripts/generate-seo-pages.mjs  # all pages
bash templates/.deploy/tests/test-shared.sh    # 34/34
```

### Scaffold Script Bug: Ordering Matters

The most important lesson from static testing: **when a scaffold script does both generic text replacement AND JSON-specific updates, the JSON update MUST run AFTER text replacement**.

```javascript
// ❌ WRONG — JSON update first, then text replacement overwrites it
seoConfig.siteName = name;  // "test-cf-static"
writeFileSync(seoConfigPath, JSON.stringify(seoConfig));
replaceInDir(outputDir, replacements);  // "cf-static" → "test-cf-static" double-applied

// ✅ RIGHT — text replacement first, then JSON update overwrites any corrupted values
replaceInDir(outputDir, replacements);
seoConfig.siteName = name;  // Clean write, no double replacement
writeFileSync(seoConfigPath, JSON.stringify(seoConfig));
```

### False Positives to Watch For

During static testing, two types of false positives appeared:

1. **JSONC parse failures**: `JSON.parse()` fails on wrangler.jsonc (which has `//` comments). The file content is correct; the test tool doesn't support JSONC. Strip comments before parsing, or use a JSONC-aware parser.

2. **Residual template names**: `grep "cf-shop"` matches `"test-cf-shop"` (already-replaced values). Use precise search: `grep "\"cf-shop\""` and exclude lines containing the new name.

## References

- Deploy scripts: `templates/.deploy/` (8 scripts + 3 CI/CD workflows)
- Deployment test report: `docs/052_部署测试报告_2026-05-30.md` (7-test matrix, 1 bug fix, dependency chain docs)
- Pitfall record: `docs/049_xshop端到端部署踩坑记录_2026-05-29.md` (15 bugs across 4 rounds, 15 iron rules)
- Prerequisite skill: `build-deploy-automation` (the scripts being verified)
- Related skills: `audit-cross-project-consistency` (post-deployment naming audit), `seo-geo-hardening` (SEO/GEO readiness)
