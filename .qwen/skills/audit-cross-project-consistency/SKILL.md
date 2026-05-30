---
name: audit-cross-project-consistency
description: Systematically audit a multi-project codebase for naming inconsistencies, broken import paths, script closure gaps, and documentation drift
source: auto-skill
extracted_at: '2026-05-30T03:16:05.656Z'
---

# Audit Cross-Project Consistency

When you have a shared library + multiple templates/projects consuming it, subtle inconsistencies accumulate across naming, imports, scripts, and documentation. These bugs are **silent and fatal** — they don't show up in unit tests but break at deployment or runtime.

## When to Use

- After building a shared library + multiple consumer projects
- When projects were created by different agents or at different times
- Before a major release or when onboarding new team members
- When users report "it works in dev but not in production"

## The 6 Audit Dimensions

Run all 6 audits in **parallel** using separate agents. Each dimension catches a different class of bug:

| Dimension | What it catches | Severity of bugs found |
|-----------|----------------|----------------------|
| **1. Token naming** | `ENCRYPTION_KEY` vs `CREDENTIALS_ENCRYPTION_KEY` across files | Fatal |
| **2. Import paths** | `@eforge/cf-core/types` missing from exports | High |
| **3. Script closure** | Deploy script A writes `FOO`, script B reads `foo` | High |
| **4. Config uniformity** | tsconfig.json / wrangler.jsonc structural drift between templates | Medium |
| **5. Documentation accuracy** | Docs reference removed functions | Low-Medium |
| **6. CI/CD & test file completeness** | Missing workflow files, undistributed test scripts | High |

## Audit 1: Token Naming Consistency

**Goal**: Every secret/token/env-var name must be byte-identical everywhere it appears.

### Procedure

Use an agent to search ALL of these locations for each token name:

```
Search scope:
  - Deploy scripts (*.sh)
  - Template source (*.ts in src/)
  - CI/CD workflows (*.yml)
  - Shared library source (*.ts in packages/)
  - Documentation (*.md)
```

For each token, build a **naming matrix**:

| Token | Deploy scripts | bindings.ts | wrangler.jsonc | CF core | Workflows | Docs |
|-------|---------------|-------------|---------------|---------|-----------|------|
| ADMIN_TOKEN | ✅ all | ✅ all | ✅ all | ✅ types.ts | ✅ deploy.yml | ✅ |
| ENCRYPTION_KEY | ❌ not found | ✅ cf-shop, cf-tools | ✅ cf-shop | ❌ not found | ❌ | ✅ cf-shop |
| CREDENTIALS_ENCRYPTION_KEY | ✅ 02,03,06 | ✅ cf-api only | ❌ | ✅ crypto.ts | ✅ deploy.yml | ✅ |

**Red flags**:
- Same concept, different names across files → **FATAL**
- Token exists in bindings.ts but not in deploy scripts → runtime `undefined`
- Token exists in deploy scripts but not in bindings.ts → type error

### Common Token Confusion Pairs

| Easily confused | Correct usage |
|----------------|--------------|
| `TURSO_API_TOKEN` (management API) | Only in deploy scripts, for creating databases |
| `TURSO_TOKEN` (database connection) | In Worker runtime, for DB queries |
| `CLOUDFLARE_API_TOKEN` (CF API) | Universal, for all CF operations |
| `CF_API_TOKEN` / `CF_AUTH_EMAIL` | **DEPRECATED** — don't use |
| `TURNSTILE_SECRET_KEY` (server-side) | Worker secret for verification |
| `TURNSTILE_SITE_KEY` (client-side) | Written to database, served to frontend |

## Audit 2: Import Path Validity

**Goal**: Every `import ... from "@scope/pkg/X"` must resolve through `package.json` exports.

### Procedure

```bash
# 1. Get all consumer imports
grep -rh "@eforge/cf-core/" templates/*/src/ | \
  grep -oP 'from "@eforge/cf-core/[^"]+' | \
  sed 's/from "//' | sort -u

# 2. Get all declared exports
jq -r '.exports | keys[]' packages/cf-core/package.json | sort

# 3. Diff: any import not in exports is a bug
```

### Common Issues

| Issue | Why it works in dev | Why it breaks in prod |
|-------|-------------------|---------------------|
| Missing export path | tsconfig `paths` resolves it | Strict bundlers (esbuild/Wrangler) reject it |
| Root path import without exact match | Wildcard `paths` catches it | `exports` requires exact `"."` entry |
| Import from `./src/X` not `./X` | Both work with `paths` | Only `exports` version is authoritative |

### Also Check

- **tsconfig.json `paths`** must be identical across all consumer projects
- **`exclude` arrays** must be consistent (some projects exclude `.wrangler`, others don't)
- **package.json dependency versions** must match for shared stack packages

## Audit 3: Script Dependency Closure

**Goal**: Every value written by one script must be readable by the script that consumes it, with matching names.

### Procedure

For each pair of scripts (writer → reader):

```
Writer script              →  cred_save "NAME" "value"
Reader script              →  cred_load "NAME"
```

Build a **data flow table**:

| Credential | Written by | Read by | Names match? |
|-----------|-----------|---------|-------------|
| TURSO_URL | 01-setup-turso | 03-deploy, 05-turnstile | ✅ |
| ADMIN_TOKEN | 02-setup-secrets | 03-deploy, 06-github | ✅ |
| PROJECT_NAME | 00-init-project | 01, 03, 05, 06 | ✅ |

### Also Check

1. **step_check / step_done** — every script that calls `step_done("X")` must also call `step_check("X")` at the top
2. **Function calls** — every function called in step scripts must be defined in `shared.sh`
3. **External tool dependencies** — tools used by step scripts (jq, node, gh, curl, openssl, npx) must be checked in the prerequisite step
4. **Workflow template variables** — `{{PLACEHOLDER}}` in .yml files must match the `sed` substitution patterns in the script that copies them
5. **Environment variable pre-checks** — the orchestrator must check ALL env vars needed by steps that will run, even when `ONLY` skips earlier steps

### Common Script Bugs

| Bug | Impact | Fix |
|-----|--------|-----|
| `step_done` without matching `step_check` | Re-runs waste time | Add `step_check` at top |
| `node -e "...'$VAR'..."` | Token with `'` breaks command | Use `process.env` pattern |
| Missing pre-check in standalone scripts | Cryptic errors when run alone | Add `check_env` at top |
| Orchestrator doesn't pre-check env vars | `ONLY=03` skips env check | Add `should_run_check()` pre-check |
| Workflow `{{VAR}}` not in `sed` substitution | Placeholder remains in deployed .yml | Add to sed command |

## Audit 4: Configuration Uniformity

**Goal**: Configuration files that should be identical across templates ARE identical.

### Procedure

```bash
# Compare tsconfig.json across templates
diff templates/cf-shop/tsconfig.json templates/cf-api/tsconfig.json
diff templates/cf-api/tsconfig.json templates/cf-tools/tsconfig.json

# Compare package.json dependencies
jq '.dependencies' templates/cf-shop/package.json > /tmp/a.json
jq '.dependencies' templates/cf-api/package.json > /tmp/b.json
diff /tmp/a.json /tmp/b.json

# Compare deploy scripts (should be identical)
diff templates/cf-shop/.deploy/shared.sh templates/cf-api/.deploy/shared.sh
```

### What Should Be Identical

| File | Should be identical? | Allowed differences |
|------|---------------------|-------------------|
| `tsconfig.json` | YES | None |
| `package.json` dependencies | YES | None |
| `.deploy/` scripts | YES | None (shared source, copied) |
| `.github/workflows/*.yml` | YES (after template substitution) | `{{WORKER_NAME}}` etc. |
| `wrangler.jsonc` structure | YES | `name`, `vars` values differ; structure must match |
| `package.json` scripts | MOSTLY | Template-specific scripts allowed; shared scripts must match |
| `src/bindings.ts` | NO | Project-specific fields expected |
| `src/db/schema.ts` | NO | Business tables differ |
| `src/config.ts` | NO | Domain-specific settings |

### wrangler.jsonc Structural Check

wrangler.jsonc files will have different `name` and `vars` values per template, but the **structure** must be consistent:

```bash
# Check that all Workers templates have the same top-level keys
for t in cf-shop cf-api cf-tools cf-form; do
  echo "=== $t ==="
  jq -r 'keys[]' "templates/$t/wrangler.jsonc" 2>/dev/null | sort
done

# Expected: all should have: assets, compatibility_date, main, name, observability, vars
# Missing "observability" in one template = structural drift
```

Key structural elements to verify:
- `"observability": { "enabled": true }` — present in ALL Workers templates
- `"assets"` block — same sub-keys (`directory`, `binding`, `html_handling`, `not_found_handling`, `run_worker_first`)
- `"compatibility_date"` — same date across all templates

### package.json Scripts Check

```bash
# Extract scripts from all templates side-by-side
for t in cf-shop cf-api cf-tools cf-static cf-form; do
  echo "=== $t ==="
  jq -r '.scripts | to_entries[] | "  \(.key): \(.value)"' "templates/$t/package.json"
done
```

Flag any script where the **interpreter doesn't match the file type**:
- `"node some-file.sh"` → ❌ should be `bash`
- `"bash some-file.mjs"` → ❌ should be `node`

## Audit 5: Documentation Accuracy

**Goal**: Documentation references to code must match actual code.

### Procedure

For each doc file, check:

1. **Import paths** — do the documented import paths match actual exports?
2. **Function signatures** — do the documented parameters match actual code?
3. **File references** — do referenced files still exist at those paths?
4. **Feature names** — are old names ("plugins") still used instead of current names ("features")?
5. **Token names** — do docs use the authoritative token names?

## Audit 6: CI/CD & Test File Completeness

**Goal**: Every template must have identical CI/CD workflows, shared test scripts, and deployment infrastructure.

### Procedure

```bash
# 1. List all workflow files across templates
for t in cf-shop cf-api cf-tools cf-static cf-form; do
  echo "=== $t ==="
  ls -la "templates/$t/.github/workflows/" 2>/dev/null || echo "  ❌ MISSING .github/workflows/"
done

# 2. List all .deploy/ test files
for t in cf-shop cf-api cf-tools cf-static cf-form; do
  echo "=== $t ==="
  ls -la "templates/$t/.deploy/tests/" 2>/dev/null || echo "  ❌ MISSING .deploy/tests/"
done

# 3. MD5 verify shared files are byte-identical
for file in shared.sh one-click.sh workflows/deploy.yml workflows/backup-daily.yml workflows/cleanup-schedule.yml; do
  echo "=== .deploy/$file ==="
  for t in cf-shop cf-api cf-tools cf-static cf-form; do
    path="templates/$t/.deploy/$file"
    [ -f "$path" ] && echo "  $t: $(md5 -q "$path")" || echo "  $t: ❌ MISSING"
  done
done

# 4. MD5 verify .github/workflows/*.yml
for yml in deploy.yml; do
  echo "=== .github/workflows/$yml ==="
  for t in cf-shop cf-api cf-tools cf-static cf-form; do
    path="templates/$t/.github/workflows/$yml"
    [ -f "$path" ] && echo "  $t: $(md5 -q "$path")" || echo "  $t: ❌ MISSING"
  done
done
```

### What to Check

| File | Must exist in all templates? | Must be identical? |
|------|----------------------------|-------------------|
| `.github/workflows/deploy.yml` | YES | YES (with `{{WORKER_NAME}}` placeholders) |
| `.deploy/shared.sh` | YES | YES (MD5 identical) |
| `.deploy/one-click.sh` | YES | YES (MD5 identical) |
| `.deploy/workflows/deploy.yml` | YES | YES (MD5 identical) |
| `.deploy/workflows/backup-daily.yml` | YES | YES (MD5 identical) |
| `.deploy/workflows/cleanup-schedule.yml` | YES | YES (MD5 identical) |
| `.deploy/tests/test-shared.sh` | YES | YES (MD5 identical) |

### Common Issues Found in This Audit

| Issue | Impact | Fix |
|-------|--------|-----|
| `.github/workflows/deploy.yml` missing in some templates | GitHub Actions CI/CD broken for those projects | Copy from `.deploy/workflows/deploy.yml` |
| `test-shared.sh` only in one template | Other templates can't run shared.sh unit tests | Copy to all `.deploy/tests/` |
| `smoke:readonly` uses `node` to call bash script | Script fails with "SyntaxError" | Rename to `smoke:shared`, use `bash` interpreter |
| `wrangler.jsonc` missing `observability` block | No metrics/logs in CF dashboard | Add `"observability": { "enabled": true }` |
| `dev` script has extra `--local` flag | Inconsistent dev experience | Align with other templates |

### MD5 Verification Technique

Using MD5 checksums is the fastest way to verify file identity across many templates:

```bash
# Single file, all templates
for t in cf-shop cf-api cf-tools cf-static cf-form; do
  echo -n "$t: "; md5 -q "templates/$t/.deploy/shared.sh"
done

# Expected output: all lines show the SAME hash
# cf-shop: 5411c21ac78e7dc6c0745c7fd0c0cd44
# cf-api:  5411c21ac78e7dc6c0745c7fd0c0cd44
# ...
```

**Any differing MD5 = bug.** All shared infrastructure files must be byte-identical.

## Severity Classification

When reporting findings, classify each issue:

| Severity | Definition | Action |
|----------|-----------|--------|
| **Fatal** | Silent runtime failure (wrong token name, undefined binding) | Fix immediately |
| **High** | Will fail in production but not in dev (missing exports, broken script closure) | Fix before release |
| **Medium** | Inconsistency that could cause future bugs (tsconfig drift, naming variants) | Fix soon |
| **Low** | Cosmetic or documentation drift | Fix when convenient |

## Fix Priority Order

1. **Fatal first** — token naming mismatches, bindings.ts vs deploy script conflicts
2. **High second** — missing exports, broken script data flow, missing pre-checks
3. **Medium third** — config uniformity, tsconfig consistency
4. **Low last** — documentation updates, naming polish

## Automation

After fixing all issues, verify with:

```bash
# 1. Run all tests
cd packages/cf-core && npx vitest run

# 2. Check exports completeness
grep -rh "from \"@eforge/cf-core" templates/*/src/ | \
  grep -oP '"@eforge/cf-core[^"]*' | sort -u | while read path; do
    pkg_path=$(echo "$path" | sed 's/@eforge\/cf-core//')
    jq -e ".exports[\".${pkg_path:-.}\"]" packages/cf-core/package.json > /dev/null 2>&1 || \
      echo "❌ Missing export: $path"
  done

# 3. Sync deploy scripts to all templates
for tpl in cf-shop cf-api cf-tools; do
  rm -rf "templates/$tpl/.deploy"
  cp -r templates/.deploy "templates/$tpl/.deploy"
done

# 4. Re-run tests after sync
cd packages/cf-core && npx vitest run
```

## Key Lessons Learned

1. **Token naming mismatches are the #1 silent killer** — `ENCRYPTION_KEY` vs `CREDENTIALS_ENCRYPTION_KEY` caused runtime `undefined` in 2 out of 3 templates, caught only by systematic audit
2. **Missing exports work in dev but break in prod** — tsconfig `paths` bypasses `exports` resolution during development, masking the bug until bundler time
3. **Script data flow gaps are invisible in unit tests** — only end-to-end audit of `cred_save` → `cred_load` chains catches them
4. **Configuration drift is inevitable** without explicit uniformity rules and periodic diff checks
5. **Run audits in parallel** — 3 agents reading different dimensions simultaneously is 3× faster than sequential
6. **The deploy scripts are the authoritative naming source** — everything else (bindings.ts, docs, workflows) must conform to them
7. **After fixing, always sync + re-test** — fixing in the source `.deploy/` without copying to templates leaves stale copies
8. **Create a Token Quick Reference doc** — `docs/070_Token速查表.md` prevents future naming drift by providing a single source of truth
9. **"Last added template" syndrome** — the most recently added template (e.g., cf-form) accumulates the most inconsistencies because it was created in a different context/time. Always audit the newest template extra carefully against the established patterns.
10. **MD5 checksums beat diff for N-template verification** — when comparing the same file across 5+ templates, MD5 hashes in a table are faster and more reliable than pairwise `diff` commands. One line per template, one hash per file — any difference jumps out immediately.
11. **CI/CD files are easy to forget** — `.github/workflows/deploy.yml` must be copied from `.deploy/workflows/` but this step is often missed. Always verify with `ls` across all templates.
12. **Script interpreter mismatches are silent** — `package.json` script `"smoke:readonly": "node .deploy/tests/test-shared.sh"` fails because `node` can't parse bash. Always verify that the interpreter (`node`, `bash`, `npx`) matches the file type.
13. **wrangler.jsonc structural drift** — not just content but structure matters. One template may have `"observability": { "enabled": true }` while another doesn't. Compare the full JSON structure, not just specific fields.
14. **Test file distribution is non-obvious** — shared test files (like `test-shared.sh` that tests `shared.sh`) must be distributed to ALL templates, not just the one where they were developed.

## References

- Audit findings from this project: `docs/047_cf-core共享内核实施记录_2026-05-29.md` (audit section)
- Token reference: `packages/cf-core/docs/070_Token速查表.md`
- Related skills: `extract-shared-library` (Step 11: exports completeness), `build-deploy-automation` (Step 8: token naming), `create-product-template` (Step 9: cross-template uniformity)
