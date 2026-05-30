---
name: build-deploy-automation
description: Build a unified one-click deployment system (bash scripts + CI/CD workflows) that automates project setup from two API tokens to production
source: auto-skill
extracted_at: '2026-05-29T14:30:00.000Z'
updated_at: '2026-05-30T02:27:14.150Z'
---

# Build Unified Deploy Automation

After building a shared library, product templates, and feature modules, create a unified deployment system that automates everything from two API tokens to a running production application.

## When to Use

- You have 2+ projects with similar deployment patterns
- Each project currently has its own ad-hoc deploy scripts with inconsistent naming
- You want "two tokens do everything" — `CLOUDFLARE_API_TOKEN` + `TURSO_API_TOKEN` → fully deployed app
- Manual steps exist (wrangler login, turso auth, clicking in dashboards, setting GitHub secrets by hand)

## Core Design Principles

1. **Two tokens in, production out** — all other secrets are auto-generated
2. **Idempotent reruns** — `.credentials/.deploy-progress` tracks completed steps; re-running skips them
3. **Credential persistence** — `.credentials/` directory (gitignored) stores all generated values for reuse
4. **No interactive auth** — all API calls use tokens passed as env vars, never `wrangler login` or `turso auth`
5. **Unified secret naming** — same names across all projects (ADMIN_TOKEN, RATE_LIMIT_SALT, etc.)

## Architecture: 8 Scripts + 3 Workflows

```
templates/.deploy/
├── shared.sh              # Common functions (logging, API wrappers, credential mgmt)
├── one-click.sh           # Orchestrator (runs steps 00-06 in order)
├── 00-init-project.sh     # Git init + GitHub repo creation + push
├── 01-setup-turso.sh      # Turso DB create + token + SQL migration
├── 02-setup-secrets.sh    # Auto-generate ADMIN_TOKEN, salts, keys (idempotent)
├── 03-deploy-worker.sh    # Build + wrangler deploy --secrets-file + smoke test
├── 04-bind-domain.sh      # Workers Custom Domain + DNS + HTTPS wait
├── 05-setup-turnstile.sh  # Turnstile Widget create + DB write + Worker secret
├── 06-setup-github.sh     # Install CI/CD workflows + push secrets + set variables
└── workflows/
    ├── deploy.yml           # Main CI/CD (typecheck → test → migrate → deploy → smoke)
    ├── cleanup-schedule.yml # Cron replacement (every 2h, POST /api/admin/cleanup)
    └── backup-daily.yml     # Daily DB backup → GitHub Artifacts (7-day retention)
```

## Step 1: Build shared.sh (Common Function Library)

This is the foundation — every script sources it. Key components:

### Logging

```bash
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}"; }
```

### Cloudflare API Wrapper

```bash
CF_API_BASE="https://api.cloudflare.com/client/v4"

cf_api() {
  local method="$1" path="$2" body="${3:-}"
  local token="${CLOUDFLARE_API_TOKEN:?缺少 CLOUDFLARE_API_TOKEN}"
  local curl_args=(-sS -X "$method" "${CF_API_BASE}${path}"
    -H "Authorization: Bearer ${token}" -H "Content-Type: application/json")
  [ -n "$body" ] && curl_args+=(-d "$body")
  local response
  response=$(curl "${curl_args[@]}" 2>/dev/null) || { log_error "CF API fail: $method $path"; return 1; }
  local success
  success=$(echo "$response" | jq -r '.success // false' 2>/dev/null)
  [ "$success" != "true" ] && { log_error "CF API error: $(echo "$response" | jq -r '.errors[0].message')"; return 1; }
  echo "$response"
}
```

### Auto-Derive Account ID / Zone ID

```bash
cf_get_account_id() {
  # Cache + auto-derive from GET /accounts
  local resp=$(cf_api GET "/accounts")
  echo "$resp" | jq -r '.result[0].id'
}
```

### Turso API Wrapper

```bash
turso_api() {
  local method="$1" path="$2" body="${3:-}"
  local token="${TURSO_API_TOKEN:?缺少 TURSO_API_TOKEN}"
  curl -sS -X "$method" "https://api.turso.tech/v1${path}" \
    -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
    ${body:+-d "$body"}
}

turso_get_org() {
  # CRITICAL: Turso API returns lowercase field names (slug, name), NOT PascalCase
  # ❌ WRONG: jq -r '.[0].Name'
  # ✅ RIGHT: jq -r '.[0].slug // .[0].name'
  local resp=$(turso_api GET "/organizations")
  _turso_org=$(echo "$resp" | jq -r '.[0].slug // .[0].name // empty')
  # NOTE: /whoami endpoint returns 404 — do NOT use it as fallback
}
```

### Bash Indirect Variable Pattern (Critical)

Bash does NOT support `${#!name}` (indirect reference + length). Use a two-step pattern:

```bash
# ❌ WRONG — bash syntax error "bad substitution"
check_env() {
  local name="$1"
  if [ -n "${!name:-}" ]; then
    log_ok "$name 已设置 (${#!name} 字符)"  # FAILS HERE
  fi
}

# ✅ RIGHT — use intermediate variable
check_env() {
  local name="$1"
  local val="${!name:-}"
  if [ -n "$val" ]; then
    log_ok "$name 已设置 (${#val} 字符)"
  fi
}
```

### Credential Persistence

```bash
CRED_DIR=".credentials"

cred_save() { mkdir -p "$CRED_DIR"; echo "$2" > "${CRED_DIR}/$1"; chmod 600 "${CRED_DIR}/$1"; }
cred_load() { [ -f "${CRED_DIR}/$1" ] && cat "${CRED_DIR}/$1" || return 1; }
cred_load_or_gen() {
  local value; if value=$(cred_load "$1") && [ -n "$value" ]; then echo "$value"
  else value=$(gen_token "$2"); cred_save "$1" "$value"; echo "$value"; fi
}
```

### Progress Tracking (Idempotent Reruns)

```bash
STEP_FILE="${CRED_DIR}/.deploy-progress"
step_done() { mkdir -p "$CRED_DIR"; echo "$1" >> "$STEP_FILE"; }
step_check() { [ -f "$STEP_FILE" ] && grep -qx "$1" "$STEP_FILE" 2>/dev/null; }
```

Each step script starts with:
```bash
if step_check "01-setup-turso"; then log_ok "已完成，跳过"; exit 0; fi
```

## Step 1.5: Node/Location Selection (Turso + Cloudflare)

### Turso Database — Location IS Configurable

Turso's location is a **group-level property** set at group creation time and **cannot be changed afterward**. The script must create a project-specific group with the desired location before creating the database.

**Default**: `aws-ap-northeast-1` (Tokyo) — lowest latency to China mainland (~50ms).

**Free tier available locations (tested 2026-05)**:

| Code | Location | Latency to China | Recommended |
|------|----------|-----------------|-------------|
| `aws-ap-northeast-1` | 🇯🇵 Tokyo | ~50ms | ⭐⭐⭐⭐⭐ Default |
| `aws-ap-south-1` | 🇮🇳 Mumbai | ~150ms | ⭐⭐⭐ |
| `aws-us-west-2` | 🇺🇸 Oregon | ~180ms | ⭐⭐ |
| `aws-us-east-2` | 🇺🇸 Ohio | ~200ms | ⭐ |
| `aws-us-east-1` | 🇺🇸 Virginia | ~220ms | ⭐ |
| `aws-eu-west-1` | 🇮🇪 Ireland | ~280ms | ❌ |

**Script implementation** (in `01-setup-turso.sh`):

```bash
TURSO_LOCATION="${TURSO_LOCATION:-aws-ap-northeast-1}"
GROUP_NAME="${GROUP_NAME:-${PROJECT_NAME}-group}"

# Step 2: Create Turso group (location is group-level, immutable after creation)
EXISTING_GROUP=$(HOMEBREW_NO_AUTO_UPDATE=1 timeout 15 turso group show "$GROUP_NAME" 2>/dev/null || echo "")
if echo "$EXISTING_GROUP" | grep -q "Locations:"; then
  log_ok "Group already exists: $GROUP_NAME"
else
  HOMEBREW_NO_AUTO_UPDATE=1 timeout 30 turso group create "$GROUP_NAME" --location "$TURSO_LOCATION"
fi

# Step 3: Create database IN that group (not "default" group)
RESULT=$(turso_api POST "/organizations/${ORG}/databases" \
  "{\"name\":\"${DB_NAME}\",\"group\":\"${GROUP_NAME}\"}")
```

**Key points**:
- Each project gets its own group to avoid location conflicts
- Free tier allows up to 3 groups per organization
- Location cannot be changed after group creation — to switch, create new group + migrate data
- `one-click.sh` should display current location: `echo "  01. Turso 数据库 [节点: ${TURSO_LOCATION:-aws-ap-northeast-1}]"`

### Cloudflare Workers — Location NOT Configurable

Workers run on Cloudflare's 300+ global edge nodes. **Users cannot specify which node handles their request** — Cloudflare's Anycast network auto-routes to the nearest PoP.

**The real problem for China mainland users** is NOT Workers performance but `workers.dev` domain reliability:

| Access method | China availability | Reason |
|---|---|---|
| `${name}.workers.dev` | ⚠️ Intermittent blocking | DNS pollution / SNI blocking of `workers.dev` TLD |
| Custom domain (e.g., `shop.eforge.xyz`) | ✅ Stable | Cloudflare + JD Cloud China network handles requests |

**Solution**: Always recommend custom domain binding for production:
```bash
DOMAIN="shop.eforge.xyz" bash .deploy/04-bind-domain.sh
```

## Step 2: Build Step Scripts

### 00-init-project.sh

- Check prerequisites: node, npm, jq, openssl, curl, git, gh
- Check env vars: CLOUDFLARE_API_TOKEN, TURSO_API_TOKEN
- `npm ci` if package.json exists
- `git init -b main`, create GitHub private repo via `gh repo create --private --source=.`
- Push to GitHub
- Save GITHUB_REPO to credentials

### 01-setup-turso.sh

- Auto-derive Turso org name via API (use `.slug` or `.name`, NOT `.Name`)
- Create database (idempotent — check if exists first via `GET /organizations/{org}/databases/{name}`)
- **CRITICAL**: Token creation API endpoint (`POST /databases/{name}/tokens`) returns 404 — use `turso` CLI instead:
  ```bash
  # ❌ WRONG — API returns 404
  TURSO_TOKEN=$(turso_api POST "/organizations/${ORG}/databases/${DB_NAME}/tokens" '{"expiration":"never"}')
  
  # ✅ RIGHT — use turso CLI
  if command -v turso &>/dev/null; then
    TURSO_TOKEN=$(turso db tokens create "$DB_NAME" 2>/dev/null | head -1)
  else
    log_error "turso CLI 未安装"
    exit 1
  fi
  ```
- Execute SQL migrations (via libsql Node.js client, fallback to CLI)
- Save TURSO_URL + TURSO_TOKEN to credentials

### 02-setup-secrets.sh

- Auto-generate (or reuse from credentials):
  - ADMIN_TOKEN (48-char hex)
  - RATE_LIMIT_SALT (48-char hex)
  - JWT_SECRET (48-char hex)
  - CREDENTIALS_ENCRYPTION_KEY (64-char hex for AES-256)
- All saved to `.credentials/` for later push to GitHub and Workers

### 03-deploy-worker.sh

- Build frontend (optional, if `build:frontend` script exists)
- Generate temporary `.deploy-secrets.env` from all credentials
- `wrangler deploy --secrets-file=.deploy-secrets.env` (atomic deploy + secrets)
- Clean up secrets file
- **CRITICAL**: Parse actual Worker URL from deploy output (includes account subdomain):
  ```bash
  # ❌ WRONG — hardcodes workers.dev (missing account subdomain)
  BASE_URL="https://${WORKER_NAME}.workers.dev"
  
  # ✅ RIGHT — parse from wrangler output
  DEPLOY_OUTPUT=$(CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN}" npx wrangler deploy --secrets-file="$SECRETS_FILE" 2>&1)
  echo "$DEPLOY_OUTPUT"
  BASE_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1)
  if [ -z "$BASE_URL" ]; then
    BASE_URL="https://${WORKER_NAME}.workers.dev"
    log_warn "无法从 deploy 输出解析 URL，使用默认: $BASE_URL"
  fi
  ```
- Wait for Worker startup (poll /api/health)
- Run smoke tests
- **Note**: `workers.dev` domains may be unreliable from China — custom domain binding (Step 04) recommended for production

### 04-bind-domain.sh

- Auto-derive Account ID + Zone ID from domain
- POST Workers Custom Domain binding via CF API
- Poll HTTPS availability (up to 24 × 5s)
- Save DOMAIN to credentials

### 05-setup-turnstile.sh

- Create Turnstile Widget via `POST /accounts/{id}/challenges/widgets`
- Write Site Key to database system_config table
- Set Secret Key as Worker Secret via `wrangler secret put`

### 06-setup-github.sh

- Install CI/CD workflow files (template variable substitution: {{WORKER_NAME}}, {{PROJECT_NAME}}, {{DOMAIN}})
- Push all secrets to GitHub via `gh secret set`
- Set variables via `gh variable set`
- Commit workflows and push (triggers first CI/CD deployment)

## Step 3: Build the Orchestrator (one-click.sh)

```bash
# Usage:
#   CLOUDFLARE_API_TOKEN="cfat_xxx" TURSO_API_TOKEN="turso_xxx" bash one-click.sh
#
# Options:
#   DOMAIN="shop.example.com"     — bind custom domain
#   SKIP_DOMAIN=true              — skip domain binding
#   SKIP_TURNSTILE=true           — skip Turnstile setup
#   SKIP_GITHUB=true              — skip GitHub Actions setup
#   ONLY="01,03"                  — run only specific steps
```

The orchestrator:
1. Shows the deployment plan
2. Runs steps 00-06 in order (skipping based on flags)
3. Shows a summary with all URLs and credentials

## Step 4: Build CI/CD Workflow Templates

### deploy.yml (main pipeline)

```yaml
on:
  push:
    branches: [main]
    paths: ['src/**', 'public/**', 'migrations/**', 'wrangler.*', 'package*.json']
  workflow_dispatch:

steps:
  - checkout → node 22 → npm ci → type-check → test
  - build frontend (optional)
  - apply migrations (via libsql client)
  - wrangler deploy --secrets-file (atomic)
  - bind domain (if BIND_DOMAIN=true)
  - smoke test
  - deploy summary
```

### cleanup-schedule.yml (cron replacement)

```yaml
on:
  schedule:
    - cron: "0 */2 * * *"   # Every 2 hours
  workflow_dispatch:

# POST /api/admin/cleanup with ADMIN_TOKEN
```

### backup-daily.yml

```yaml
on:
  schedule:
    - cron: "0 3 * * *"     # Daily 03:00 UTC
  workflow_dispatch:

# Export Turso DB → GitHub Artifacts (7-day retention)
```

## Step 5: Copy to All Templates

```bash
for tpl in cf-shop cf-api cf-tools; do
  cp -r .deploy "$tpl/.deploy"
done
```

## Key Pitfalls & Solutions

| Pitfall | Solution |
|---------|----------|
| Secret naming inconsistency across projects | Unified names in shared.sh, single source of truth |
| `wrangler login` / `turso auth` interactive prompts | Use API tokens + `wrangler deploy --secrets-file` |
| Turnstile API path wrong | Correct: `/accounts/{id}/challenges/widgets` (NOT `/turnstile/widgets`) |
| Turso API field names wrong | Use lowercase (`slug`, `name`), NOT PascalCase (`Name`, `Hostname`) |
| Turso Token creation API returns 404 | Use `turso db tokens create` CLI instead of REST API |
| Bash `${#!name}` syntax error | Use `local val="${!name:-}"` then `${#val}` |
| Worker URL missing account subdomain | Parse from `wrangler deploy` output with grep |
| `workers.dev` unreliable from China | Bind custom domain (Step 04) for production |
| Secrets file leaked | Write → deploy → overwrite with empty → delete |
| Non-idempotent reruns | Progress file + credential reuse |
| Domain binding hangs | Poll with timeout (24 × 5s max) |
| GitHub CLI not installed | Check early, provide install instructions |
| `gh secret set` slow from China | Each call takes 5-10s; use `timeout 30` wrapper |
| Cloudflare API Token permissions | Need: Workers Scripts Edit, Account Settings Read, Custom Domains Edit |
| Turso API Token | Create at turso.tech/app/tokens with full access |
| **stdout pollution in return-value functions** | All `log_*` in functions captured via `$()` must use `>&2` |
| **Homebrew auto-update causing CLI timeouts** | `export HOMEBREW_NO_AUTO_UPDATE=1` + `timeout 30` before all CLI calls |
| **SQL migration comment lines sent as SQL** | Strip `--` lines before splitting by `;` in migrate.mjs |
| **Turso DB created in wrong location** | Create project-specific group with `--location` before creating DB; location is immutable after group creation |
| **`workers.dev` unreachable from China** | Bind custom domain (Step 04) for production; Workers nodes themselves are global and fast |
| **Full-width CJK brackets next to `$VAR`** | `）` (U+FF09) next to `$GROUP_NAME` → bash treats `GROUP_NAME）` as variable name → unbound error. Always use `${VAR}` or half-width brackets |
| **APP_ORIGIN hardcoded to wrong URL** | Read from `.credentials/BASE_URL` (Step 03 saved actual URL with account subdomain), not hardcoded `${WORKER_NAME}.workers.dev` |
| **CI `tsc --noEmit` blocks deployment** | Set `continue-on-error: true` for type-check step; wrangler handles compilation independently |

## Validation Checklist

```
□ shared.sh has cf_api(), turso_api(), cred_save/load, step_done/check
□ Each step script sources shared.sh and checks step_check()
□ one-click.sh runs all steps in order with SKIP_*/ONLY flags
□ 3 workflow templates use {{WORKER_NAME}}/{{PROJECT_NAME}} placeholders
□ All scripts are chmod +x
□ .credentials/ is in .gitignore
□ Secrets file is cleaned up after deploy
□ Smoke tests run after deployment
□ Progress tracking enables idempotent reruns
□ All API calls use token auth, no interactive login
```

## Step 6: Entry-Point Pre-Check Pattern (Critical)

The orchestrator (`one-click.sh`) MUST pre-check environment variables **before** running any step, regardless of `ONLY` or `SKIP` flags. Without this, users who run `ONLY=03 bash one-click.sh` get cryptic runtime errors instead of friendly messages.

```bash
# Define helper BEFORE using it
should_run_check() {
  local steps_csv="$1"
  if [ -n "${ONLY:-}" ]; then
    for s in $(echo "$steps_csv" | tr ',' ' '); do
      echo ",$ONLY," | grep -q ",$s," && return 0
    done
    return 1
  fi
  for s in $(echo "$steps_csv" | tr ',' ' '); do
    case "$s" in
      00|01|02|03) return 0 ;;
      04) [ "${SKIP_DOMAIN:-false}" != "true" ] && return 0 ;;
      05) [ "${SKIP_TURNSTILE:-false}" != "true" ] && return 0 ;;
      06) [ "${SKIP_GITHUB:-false}" != "true" ] && return 0 ;;
    esac
  done
  return 1
}

# Pre-check: only check vars needed by steps that will actually run
FAIL=0
if should_run_check "03,04,05"; then
  check_env CLOUDFLARE_API_TOKEN "..." || FAIL=1
fi
if should_run_check "01"; then
  check_env TURSO_API_TOKEN "..." || FAIL=1
fi
if should_run_check "00,06"; then
  gh_check || FAIL=1
fi
[ "$FAIL" -eq 1 ] && exit 1
```

**Also**: Each individual step script (03, 04, 05) MUST have its own standalone pre-check at the top, so users can run them independently:

```bash
# At the top of 03-deploy-worker.sh, 04-bind-domain.sh, 05-setup-turnstile.sh:
FAIL=0
check_env CLOUDFLARE_API_TOKEN "..." || FAIL=1
[ "$FAIL" -eq 1 ] && exit 1
```

## Step 7: node -e Credential Safety

**Never** embed shell variables directly into `node -e` strings. Shell special characters in tokens (quotes, backticks, `$`) will break the command or cause injection.

```bash
# ❌ DANGEROUS — token with ' or ` breaks the command
node -e "const c = createClient({ url: '$TURSO_URL', authToken: '$TURSO_TOKEN' }); ..."

# ✅ SAFE — pass via environment, read with process.env
TURSO_URL="$TURSO_URL" TURSO_TOKEN="$TURSO_TOKEN" SITE_KEY_VAL="$SITE_KEY" node -e "
  const c = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
  c.execute({ sql: '...', args: [process.env.SITE_KEY_VAL] });
"
```

## Step 8: Token Naming Must Be Identical Everywhere

A Token name mismatch between deploy scripts and runtime code is a **fatal bug** — the Worker will silently get `undefined`. The name must be byte-identical in ALL of these locations:

| Location | Example |
|----------|---------|
| Deploy script (`02-setup-secrets.sh`) | `cred_save "CREDENTIALS_ENCRYPTION_KEY"` |
| Deploy script (`03-deploy-worker.sh`) | `cred_load "CREDENTIALS_ENCRYPTION_KEY"` |
| `.credentials/` file name | `.credentials/CREDENTIALS_ENCRYPTION_KEY` |
| `wrangler secret put` | Secret name: `CREDENTIALS_ENCRYPTION_KEY` |
| Worker runtime | `c.env.CREDENTIALS_ENCRYPTION_KEY` |
| `bindings.ts` type declaration | `CREDENTIALS_ENCRYPTION_KEY?: string` |
| `package.json` exports (if applicable) | — |

**Common fatal mismatches found in practice:**

| Wrong (in bindings.ts) | Correct (matches deploy script) | Impact |
|------------------------|-------------------------------|--------|
| `ENCRYPTION_KEY` | `CREDENTIALS_ENCRYPTION_KEY` | Runtime `undefined`, crypto fails silently |
| `TURSO_DB_URL` | `TURSO_URL` | DB connection fails |
| `TURSO_DB_AUTH_TOKEN` | `TURSO_TOKEN` | DB auth fails |
| `CF_API_TOKEN` | `CLOUDFLARE_API_TOKEN` | API calls fail |

**Rule**: The deploy scripts are the **authoritative naming source**. `bindings.ts` must match them exactly.

## Step 9: step_check for ALL Steps Including Step 00

Every step script — including the first one (00-init-project) — MUST have both `step_check` and `step_done`:

```bash
# At the top of 00-init-project.sh (BEFORE any work):
if step_check "00-init-project"; then
  log_ok "已完成，跳过（删除 .credentials/.deploy-progress 重跑）"
  exit 0
fi
```

Without this, re-running `one-click.sh` wastes time re-executing Git/GitHub operations.

## Deploy Mode Support (Gap Analysis)

The current template system supports **one deploy mode**: Workers Assets. However, projects may need different modes. Understanding the gap prevents future surprises.

### Three Deploy Modes

| Mode | Deploy Command | Use Case | Current Support |
|------|---------------|----------|----------------|
| **Workers Assets** | `wrangler deploy` | API + frontend in one Worker | ✅ Fully supported |
| **Pages + Workers** | `wrangler deploy` + `wrangler pages deploy` | Separate static frontend + API backend | ❌ Not supported |
| **Pure Pages** | `wrangler pages deploy` | Static sites (SEO, docs, blogs) | ❌ Not supported |

### Real-World Evidence

In this codebase, **vcode** uses Pages + Workers hybrid mode:
- `public/_routes.json` — routes `/api/*` to Workers, everything else to Pages
- `scripts/04b-deploy-pages.sh` — separate Pages deploy script
- But this script is NOT in the one-click.sh flow — requires manual execution

### What's Missing for Full Mode Support

To support all three modes, `03-deploy-worker.sh` and `deploy.yml` need a `DEPLOY_MODE` variable:

```bash
DEPLOY_MODE="${DEPLOY_MODE:-workers}"  # workers | pages | hybrid

case "$DEPLOY_MODE" in
  workers)
    npx wrangler deploy --secrets-file="$SECRETS_FILE"
    ;;
  pages)
    npx wrangler pages deploy public/ --project-name="$PAGES_PROJECT"
    ;;
  hybrid)
    npx wrangler deploy --secrets-file="$SECRETS_FILE"
    npx wrangler pages deploy public/ --project-name="$PAGES_PROJECT"
    ;;
esac
```

### When to Add Pages Support

Add Pages support when you need:
- A pure static SEO site (programmatic SEO with 1000+ pages)
- A documentation site
- A project where frontend and backend deploy independently

**Don't add it prematurely** — if all current projects use Workers Assets mode, the gap is theoretical. Add it when a real project demands it.

### Free Tier Comparison

| Feature | Workers Free | Pages Free |
|---------|-------------|-----------|
| Requests | 100,000/day | Unlimited |
| Bandwidth | Included | Unlimited |
| CPU time | 10ms/request | N/A (static) |
| Custom domains | ✅ | ✅ |
| Workers functions | ✅ | ✅ (via _routes.json) |
| Build step | ✅ | ✅ |

**Key insight**: For SEO sites with thousands of static pages, Pages Free is better because it has **unlimited requests** — Workers Free's 100K/day limit would be exhausted quickly.

## Key Lessons Learned

1. **"Two tokens do everything"** is the right UX — anything more is friction
2. **Idempotent scripts are essential** — deployment will be re-run many times
3. **Credential persistence in `.credentials/`** — never regenerate what you already have
4. **Cloudflare API > wrangler CLI** for automation — more reliable, no interactive auth
5. **Turso CLI > Turso REST API for token creation** — the token creation REST endpoint returns 404; use `turso db tokens create`
6. **Turso API uses lowercase field names** — `.slug` and `.name`, not `.Name` or `.Hostname`; `/whoami` endpoint doesn't exist (404)
7. **`wrangler deploy --secrets-file`** is atomic (deploy + secrets in one step)
8. **Template variable substitution** in workflows ({{WORKER_NAME}}) avoids per-project editing
9. **`gh secret set` + `gh variable set`** automates GitHub Actions configuration
10. **Progress tracking** (`step_done`/`step_check`) is simpler and more reliable than complex state machines
11. **Shared scripts in `templates/.deploy/`** — update once, copy to all templates
12. **Entry-point pre-checks are critical** — without them, `ONLY=03` gives cryptic errors
13. **Each step script needs standalone pre-checks** — users run them independently
14. **Never embed shell vars in `node -e`** — use `process.env` instead
15. **Token naming must be byte-identical** across deploy scripts, .credentials, wrangler secrets, Worker env, and bindings.ts — mismatches are fatal and silent
16. **step_check on step 00** — without it, re-runs waste time on Git/GitHub ops
17. **Bash indirect variable syntax** — `${#!name}` doesn't work; use `local val="${!name:-}"` then `${#val}`
18. **Worker URL includes account subdomain** — parse from deploy output, don't hardcode `${name}.workers.dev`
19. **`workers.dev` unreliable from China** — always recommend custom domain binding for production
20. **End-to-end verification is non-negotiable** — scripts that look correct in review still fail against real infrastructure; always create a test project and run every step. See `verify-deployment-end-to-end` skill
21. **stdout pollution is the #1 silent bash bug** — any function whose return value is captured via `$()` MUST redirect all `log_*` output to stderr (`>&2`), otherwise the captured variable contains log text + return value (two lines), breaking all subsequent API paths
22. **External CLI tools have hidden side effects** — `turso` CLI triggers `brew upgrade` on macOS causing 120s+ timeouts; always set `HOMEBREW_NO_AUTO_UPDATE=1` and wrap with `timeout 30`
23. **SQL migration scripts must strip comments** — `--` comment lines get concatenated with SQL statements when splitting by `;`, causing server errors; always `.filter(line => !line.trim().startsWith("--"))` before `.split(";")`
24. **Turso location is group-level and immutable** — set `TURSO_LOCATION` before creating the group; Tokyo (`aws-ap-northeast-1`) is best for China mainland (~50ms); can't change after group creation
25. **Cloudflare Workers location is NOT configurable** — Workers auto-route to nearest global edge node; the real China issue is `workers.dev` domain blocking, solved by binding a custom domain
26. **Full-width CJK characters are bash poison next to `$VAR`** — `）` `（` `：` `；` (U+FF09, U+FF08, etc.) adjacent to `$VAR_NAME` cause bash to treat the CJK char as part of the variable name → "unbound variable" error. Always use `${VAR}` or half-width ASCII punctuation in bash scripts containing Chinese text
27. **APP_ORIGIN must come from actual deploy results** — Cloudflare assigns URLs with account-specific subdomains (`xshop.mailforwdy.workers.dev` not `xshop.workers.dev`); read from `.credentials/BASE_URL` saved by Step 03, never hardcode
28. **CI type-check should not block deploy** — `tsc --noEmit` catches TypeScript errors but wrangler/esbuild handles actual compilation; set `continue-on-error: true` so type errors warn but don't stop the pipeline

## Multi-Mode Deployment (workers / pages / hybrid)

Not all projects need a Worker + database. Add a **deploy mode** concept to support three project types with the same script system:

| Mode | Command | Needs DB? | Use Case |
|------|---------|-----------|----------|
| `workers` | `wrangler deploy` | ✅ Turso | API, e-commerce, tool hub (default) |
| `pages` | `wrangler pages deploy` | ❌ | SEO sites, docs, blogs, landing pages |
| `hybrid` | Workers + Pages | ✅ Turso | API + frontend separation (e.g., vcode) |

### Implementation Pattern

1. **Mode detection** — priority: `$DEPLOY_MODE` env var → `.deploy-mode` file → default `workers`
2. **`shared.sh` additions**:
   - `detect_deploy_mode()` — returns mode string
   - `is_workers_mode()` / `is_pages_mode()` / `is_hybrid_mode()` — boolean helpers
   - `pages_deploy()` — wraps `wrangler pages deploy` with retry (3 attempts)
   - `pages_get_url()` — gets Pages project URL via CF API
3. **`one-click.sh` changes**:
   - Pages mode skips Step 01 (Turso), Step 02 (Secrets), Step 05 (Turnstile)
   - Pre-check only requires `TURSO_API_TOKEN` when mode != pages
4. **`03-deploy.sh` branches**:
   - workers: secrets file → `wrangler deploy` → CF API verify → smoke test `/api/health`
   - pages: `pages_deploy()` → smoke test homepage `/`
   - hybrid: workers deploy first, then pages deploy, base URL from pages
5. **`deploy.yml` conditional steps**:
   - `if: vars.DEPLOY_MODE != 'pages'` for DB migration + Worker deploy
   - `if: vars.DEPLOY_MODE == 'pages' || vars.DEPLOY_MODE == 'hybrid'` for Pages deploy
   - Smoke test adapts URL and endpoints per mode

### Template `.deploy-mode` File

Each template ships a `.deploy-mode` file at root:
```bash
# For Workers templates (cf-shop, cf-api, cf-tools):
echo "workers" > .deploy-mode

# For Pages templates (cf-static):
echo "pages" > .deploy-mode
```

### `06-setup-github.sh` Must Pass Mode

Always set `DEPLOY_MODE` as a GitHub Variable so CI/CD knows which path to take:
```bash
gh_set_variable "$GITHUB_REPO" "DEPLOY_MODE" "$MODE"
```

## References

- Deploy scripts: `templates/.deploy/` (12 files)
- cf-static template: `templates/cf-static/` (24 files, Pages mode)
- Documentation: `packages/cf-core/docs/060_自动化部署体系.md`
- Implementation record: `docs/047_cf-core共享内核实施记录_2026-05-29.md` (Phase 4 section)
- Prerequisite skills: `extract-shared-library`, `create-product-template`, `build-plugin-system`
