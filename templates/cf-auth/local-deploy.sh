#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# local-deploy.sh — cf-auth 从本地 .env 同步 secrets 并部署到 Cloudflare Workers
#
# 前提：npx wrangler login
# 用法：bash local-deploy.sh
#
# 流程：
#   0. 登录与 .env 检查
#   1. 校验 ADMIN_* / 核心 secrets（不打印明文）
#   2. 可选 verify（VERIFY=0 跳过）
#   3. 构建 Admin SPA → public/
#   4. 从 .env 生成临时 secrets-file → wrangler deploy
#   5. 生产 health / adminConfigured 冒烟
#
# 安全：
#   - 不把 BETTER_AUTH_URL / APP_ORIGIN / TRUSTED_ORIGINS 从本地 .env 写入 secret
#     （本地常为 localhost，会覆盖生产；这些用 wrangler.jsonc vars）
#   - secrets-file 用 mktemp + trap 删除，日志只打印 key 名
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[cf-auth deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[cf-auth deploy]${NC} $*"; }
err()   { echo -e "${RED}[cf-auth deploy]${NC} $*" >&2; }

ENV_FILE="${ENV_FILE:-$ROOT/.env}"
PROD_BASE="${PROD_BASE_URL:-https://auth.eforge.xyz}"
# 设 VERIFY=0 可跳过 tsc+vitest（紧急热修）
DO_VERIFY="${VERIFY:-1}"

# ── 从 .env 读值（不 export 全部，避免污染）──
cred_load() {
  local name="$1" line val
  [ -f "$ENV_FILE" ] || return 1
  # 去掉 \r，避免 CRLF 被当成「值内换行」
  line="$(grep -E "^${name}=" "$ENV_FILE" | head -1 | tr -d '\r' || true)"
  [ -n "$line" ] || return 1
  val="${line#*=}"
  # 去首尾空白与成对引号
  val="$(printf '%s' "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  printf '%s' "$val"
}

# ── 0. 前置 ──
if ! npx wrangler whoami &>/dev/null; then
  err "请先执行: npx wrangler login"
  exit 1
fi
info "Wrangler 已登录"

if [ ! -f "$ENV_FILE" ]; then
  err "缺少 $ENV_FILE（参考 .env.example）"
  exit 1
fi
info "使用凭证文件: $ENV_FILE"

# ── 1. 校验 ──
info "步骤 1/5：校验 .env 关键项（不打印明文）…"

require_secret() {
  local name="$1" min_len="${2:-1}" val
  val="$(cred_load "$name" 2>/dev/null || true)"
  if [ -z "$val" ]; then
    err "缺少 $name"
    exit 1
  fi
  if [ "${#val}" -lt "$min_len" ]; then
    err "$name 长度 ${#val} < $min_len"
    exit 1
  fi
  info "  OK $name (len=${#val})"
}

require_secret BETTER_AUTH_SECRET 32
require_secret TURSO_URL 8
require_secret TURSO_TOKEN 16
require_secret DATABASE_URL 8
require_secret GOOGLE_CLIENT_ID 8
require_secret GOOGLE_CLIENT_SECRET 8
require_secret GITHUB_CLIENT_ID 8
require_secret GITHUB_CLIENT_SECRET 8

# 平台 Admin（M7）：至少配齐其一；本脚本要求 EMAILS + API_KEY 都有（治理 + 脚本）
ADMIN_EMAILS_VAL="$(cred_load ADMIN_EMAILS 2>/dev/null || true)"
ADMIN_API_KEY_VAL="$(cred_load ADMIN_API_KEY 2>/dev/null || true)"
ADMIN_USER_IDS_VAL="$(cred_load ADMIN_USER_IDS 2>/dev/null || true)"

if [ -z "$ADMIN_EMAILS_VAL" ] && [ -z "$ADMIN_USER_IDS_VAL" ] && [ -z "$ADMIN_API_KEY_VAL" ]; then
  err "未配置 ADMIN_EMAILS / ADMIN_USER_IDS / ADMIN_API_KEY：部署后管理面与 create-client 将 503"
  exit 1
fi

if [ -n "$ADMIN_EMAILS_VAL" ]; then
  if ! printf '%s' "$ADMIN_EMAILS_VAL" | grep -q '@'; then
    err "ADMIN_EMAILS 看起来不像邮箱:（已隐藏）"
    exit 1
  fi
  # 统计逗号分隔个数
  _n=0
  IFS=',' read -ra _parts <<< "$ADMIN_EMAILS_VAL"
  for _e in "${_parts[@]}"; do
    _t="$(echo "$_e" | xargs)"
    [ -n "$_t" ] && _n=$((_n + 1))
  done
  info "  OK ADMIN_EMAILS (emails≈${_n})"
else
  warn "  ADMIN_EMAILS 未设（将仅依赖 API Key / USER_IDS）"
fi

if [ -n "$ADMIN_API_KEY_VAL" ]; then
  if [ "${#ADMIN_API_KEY_VAL}" -lt 24 ]; then
    err "ADMIN_API_KEY 过短（建议 ≥24，当前 ${#ADMIN_API_KEY_VAL}）"
    exit 1
  fi
  case "$(printf '%s' "$ADMIN_API_KEY_VAL" | tr '[:upper:]' '[:lower:]')" in
    changeme|secret|password|replace-with-long-random-string)
      err "ADMIN_API_KEY 为占位弱口令"
      exit 1
      ;;
  esac
  info "  OK ADMIN_API_KEY (len=${#ADMIN_API_KEY_VAL})"
else
  warn "  ADMIN_API_KEY 未设（脚本/CI 无法用 X-Admin-Api-Key）"
fi

# 本地 .env 的 BETTER_AUTH_URL 常为 localhost — 禁止当 secret 上传
LOCAL_BA_URL="$(cred_load BETTER_AUTH_URL 2>/dev/null || true)"
if [ -n "${LOCAL_BA_URL}" ]; then
  case "${LOCAL_BA_URL}" in
    *localhost*|*127.0.0.1*)
      warn "  .env BETTER_AUTH_URL is local (len=${#LOCAL_BA_URL}); not uploaded as secret; prod uses wrangler.jsonc vars"
      ;;
  esac
fi

# ── 2. verify ──
if [ "$DO_VERIFY" = "1" ]; then
  info "步骤 2/5：npm run verify…"
  npm run verify
else
  warn "步骤 2/5：跳过 verify（VERIFY=0）"
fi

# ── 3. 前端 ──
info "步骤 3/5：构建 Admin SPA…"
if [ ! -d frontend/node_modules ]; then
  npm install --prefix frontend --legacy-peer-deps
fi
npm run build:frontend
if [ ! -f public/index.html ]; then
  err "public/index.html 未生成"
  exit 1
fi
info "  public/ 已就绪"

# ── 4. secrets + deploy ──
info "步骤 4/5：同步 secrets 并 wrangler deploy…"

SECRETS_FILE="$(mktemp -t cf-auth-secrets.XXXXXX)"
chmod 600 "$SECRETS_FILE"
cleanup() { rm -f "$SECRETS_FILE"; }
trap cleanup EXIT

append_secret() {
  local name="$1" value
  value="$(cred_load "$name" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    # wrangler secrets-file：KEY=VALUE 每行一个；值内换行不支持
    # 勿用 grep $'\n'（管道单行时易误报）；用 case / 参数展开
    case "$value" in
      *$'\n'*|*$'\r'*)
        err "$name 含换行，无法写入 secrets-file"
        exit 1
        ;;
    esac
    printf '%s=%s\n' "$name" "$value" >> "$SECRETS_FILE"
    info "  will-set secret: $name"
  fi
}

# 仅「真 secret」；不要把 localhost 的 URL / origins 塞进来
for name in \
  BETTER_AUTH_SECRET \
  DATABASE_URL \
  TURSO_URL \
  TURSO_TOKEN \
  GOOGLE_CLIENT_ID \
  GOOGLE_CLIENT_SECRET \
  GITHUB_CLIENT_ID \
  GITHUB_CLIENT_SECRET \
  ADMIN_EMAILS \
  ADMIN_API_KEY \
  ADMIN_USER_IDS
do
  append_secret "$name"
done

if [ ! -s "$SECRETS_FILE" ]; then
  err "secrets-file 为空"
  exit 1
fi

SECRET_COUNT="$(grep -c '=' "$SECRETS_FILE" || true)"
info "  secrets-file 条目数: $SECRET_COUNT"
info "  执行: npx wrangler deploy --secrets-file=…"

npx wrangler deploy --secrets-file="$SECRETS_FILE"

# 立刻擦除
cleanup
trap - EXIT

info "✅ Worker 已部署"

# ── 5. 冒烟（变量一律 ${VAR}，避免 macOS bash3 + 中文邻接触发 set -u 误解析）──
info "步骤 5/5：生产冒烟 ${PROD_BASE}"
sleep 2

HEALTH_JSON="$(curl -sS --max-time 30 "${PROD_BASE}/api/health" || true)"
if ! printf '%s' "${HEALTH_JSON}" | grep -q '"ok":true'; then
  err "health not ok: $(printf '%s' "${HEALTH_JSON}" | head -c 200)"
  exit 1
fi
info "  health ok"

if printf '%s' "${HEALTH_JSON}" | grep -q '"adminConfigured":true'; then
  info "  adminConfigured=true (ADMIN_* active)"
elif printf '%s' "${HEALTH_JSON}" | grep -q '"adminConfigured":false'; then
  err "adminConfigured=false: secrets may not be bound"
  exit 1
elif ! printf '%s' "${HEALTH_JSON}" | grep -q 'adminConfigured'; then
  warn "  no adminConfigured field (old worker build?)"
else
  warn "  adminConfigured unknown"
fi

# 无凭证：已配置 ADMIN_* 期望 401；未配置期望 503
ADMIN_STATUS="$(curl -sS -o /tmp/cf-auth-admin-health.body -w '%{http_code}' --max-time 20 \
  "${PROD_BASE}/api/admin/health" || echo 000)"
info "  GET /api/admin/health (no cred) -> HTTP ${ADMIN_STATUS}"
if [ "${ADMIN_STATUS}" = "503" ]; then
  err "admin still 503 (ADMIN_* not recognized)"
  exit 1
fi
if [ "${ADMIN_STATUS}" != "401" ] && [ "${ADMIN_STATUS}" != "403" ]; then
  warn "  expected 401/403, got ${ADMIN_STATUS}"
fi

if [ -n "${ADMIN_API_KEY_VAL}" ]; then
  KEY_STATUS="$(curl -sS -o /tmp/cf-auth-admin-key.body -w '%{http_code}' --max-time 20 \
    -H "X-Admin-Api-Key: ${ADMIN_API_KEY_VAL}" \
    "${PROD_BASE}/api/admin/health" || echo 000)"
  info "  GET /api/admin/health (API Key) -> HTTP ${KEY_STATUS}"
  if [ "${KEY_STATUS}" != "200" ]; then
    err "API Key auth failed status=${KEY_STATUS} body=$(head -c 200 /tmp/cf-auth-admin-key.body 2>/dev/null || true)"
    exit 1
  fi
  info "  Admin API Key OK"
fi

CC_STATUS="$(curl -sS -o /tmp/cf-auth-cc.body -w '%{http_code}' --max-time 20 \
  -X POST -H 'Content-Type: application/json' \
  -d '{"name":"deploy-smoke-deny","redirect_uris":["https://example.com/cb"]}' \
  "${PROD_BASE}/api/auth/oauth2/create-client" || echo 000)"
info "  POST create-client (no cred) -> HTTP ${CC_STATUS}"
case "${CC_STATUS}" in
  401|403|503) info "  create-client locked OK" ;;
  *) warn "  create-client unexpected ${CC_STATUS}" ;;
esac

curl -sS -o /tmp/cf-auth-home.html --max-time 20 "${PROD_BASE}/" >/dev/null || true
if grep -qiE 'cf-auth|sign-in|登录' /tmp/cf-auth-home.html 2>/dev/null; then
  info "  GET / protocol page OK"
else
  warn "  GET / may be wrong"
fi

# 裸 /admin 与 /admin/ 都应 200 HTML（wrangler run_worker_first 含 /admin）
ADMIN_PAGE="$(curl -sS -o /tmp/cf-auth-admin.html -w '%{http_code}' --max-time 20 \
  "${PROD_BASE}/admin" || echo 000)"
ADMIN_SLASH="$(curl -sS -o /tmp/cf-auth-admin-slash.html -w '%{http_code}' --max-time 20 \
  "${PROD_BASE}/admin/" || echo 000)"
info "  GET /admin -> HTTP ${ADMIN_PAGE}; GET /admin/ -> HTTP ${ADMIN_SLASH}"
if [ "${ADMIN_PAGE}" != "200" ] && [ "${ADMIN_SLASH}" != "200" ]; then
  err "Admin SPA not reachable"
  exit 1
fi
if [ "${ADMIN_PAGE}" != "200" ]; then
  warn "  bare /admin is ${ADMIN_PAGE} (use /admin/ or fix run_worker_first)"
fi

info "========================================"
info "Deploy done: ${PROD_BASE}"
info "Admin UI: ${PROD_BASE}/admin/"
info "Full smoke: npm run smoke:prod"
info "========================================"
