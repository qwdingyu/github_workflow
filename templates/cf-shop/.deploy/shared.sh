#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# shared.sh — 统一部署函数库
#
# 所有部署脚本 source 此文件获取公共函数。
# 用法: source "$(dirname "$0")/shared.sh"
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── 颜色 ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── 日志函数 ──────────────────────────────────────────────────────────────────
log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}"; }

# ── 前置条件检查 ──────────────────────────────────────────────────────────────
check_cmd() {
  local cmd="$1" hint="${2:-}"
  if command -v "$cmd" &>/dev/null; then
    log_ok "$cmd ($(command -v "$cmd"))"
    return 0
  else
    log_error "$cmd 未安装${hint:+ — $hint}"
    return 1
  fi
}

check_env() {
  local name="$1" hint="${2:-}"
  local val="${!name:-}"
  if [ -n "$val" ]; then
    log_ok "$name 已设置 (${#val} 字符)"
    return 0
  else
    log_error "$name 未设置${hint:+ — $hint}"
    return 1
  fi
}

# ── 自动生成安全 Token ────────────────────────────────────────────────────────
gen_token() {
  local prefix="${1:-tok}"
  echo "${prefix}-$(openssl rand -hex 24)"
}

gen_hex() {
  local bytes="${1:-32}"
  openssl rand -hex "$bytes"
}

# ── Cloudflare API 封装 ───────────────────────────────────────────────────────
CF_API_BASE="https://api.cloudflare.com/client/v4"

cf_api() {
  local method="$1" path="$2" body="${3:-}"
  local token="${CLOUDFLARE_API_TOKEN:?缺少 CLOUDFLARE_API_TOKEN}"

  local curl_args=(
    -sS -X "$method"
    "${CF_API_BASE}${path}"
    -H "Authorization: Bearer ${token}"
    -H "Content-Type: application/json"
  )

  if [ -n "$body" ]; then
    curl_args+=(-d "$body")
  fi

  local response
  response=$(curl "${curl_args[@]}" 2>/dev/null) || {
    log_error "Cloudflare API 请求失败: $method $path"
    return 1
  }

  local success
  success=$(echo "$response" | jq -r '.success // false' 2>/dev/null)
  if [ "$success" != "true" ]; then
    local errors
    errors=$(echo "$response" | jq -r '.errors[0].message // "unknown error"' 2>/dev/null)
    log_error "Cloudflare API $method $path: $errors"
    return 1
  fi

  echo "$response"
}

# ── Cloudflare Account ID 自动推导 ───────────────────────────────────────────
_cf_account_id=""
cf_get_account_id() {
  if [ -n "$_cf_account_id" ]; then
    echo "$_cf_account_id"
    return
  fi
  local resp
  resp=$(cf_api GET "/accounts")
  _cf_account_id=$(echo "$resp" | jq -r '.result[0].id')
  if [ -z "$_cf_account_id" ] || [ "$_cf_account_id" = "null" ]; then
    log_error "无法获取 Cloudflare Account ID"
    return 1
  fi
  local name
  name=$(echo "$resp" | jq -r '.result[0].name')
  log_ok "Account: $name ($_cf_account_id)" >&2
  echo "$_cf_account_id"
}

# ── Turso API 封装 ────────────────────────────────────────────────────────────
TURSO_API_BASE="https://api.turso.tech/v1"

turso_api() {
  local method="$1" path="$2" body="${3:-}"
  local token="${TURSO_API_TOKEN:?缺少 TURSO_API_TOKEN}"

  local curl_args=(
    -sS -X "$method"
    "${TURSO_API_BASE}${path}"
    -H "Authorization: Bearer ${token}"
    -H "Content-Type: application/json"
  )

  if [ -n "$body" ]; then
    curl_args+=(-d "$body")
  fi

  local response
  response=$(curl "${curl_args[@]}" 2>/dev/null) || {
    log_error "Turso API 请求失败: $method $path"
    return 1
  }

  echo "$response"
}

# ── Turso 组织名自动推导 ──────────────────────────────────────────────────────
_turso_org=""
turso_get_org() {
  if [ -n "$_turso_org" ]; then
    echo "$_turso_org"
    return
  fi
  local resp
  resp=$(turso_api GET "/organizations")
  _turso_org=$(echo "$resp" | jq -r '.[0].slug // .[0].name // empty')
  if [ -z "$_turso_org" ]; then
    log_error "无法从 Turso /organizations 响应中提取组织名"
    log_error "响应内容: $(echo "$resp" | head -c 200)"
    return 1
  fi
  log_ok "Turso 组织: $_turso_org" >&2
  echo "$_turso_org"
}

# ── GitHub CLI 封装 ───────────────────────────────────────────────────────────
gh_check() {
  if ! command -v gh &>/dev/null; then
    log_error "gh CLI 未安装 — brew install gh"
    return 1
  fi
  if ! gh auth status &>/dev/null 2>&1; then
    log_error "gh CLI 未登录 — gh auth login"
    return 1
  fi
  log_ok "gh CLI 已登录 ($(gh auth status 2>&1 | head -1))"
}

gh_set_secret() {
  local repo="$1" name="$2" value="$3"
  if timeout 30 bash -c "echo '$value' | gh secret set '$name' --repo '$repo'" 2>/dev/null; then
    log_ok "Secret: $name"
  else
    log_warn "Secret: $name 设置超时或失败（30s），稍后重试"
  fi
}

gh_set_variable() {
  local repo="$1" name="$2" value="$3"
  if timeout 30 bash -c "gh variable set '$name' --repo '$repo' --body '$value'" 2>/dev/null; then
    log_ok "Variable: $name = $value"
  else
    log_warn "Variable: $name 设置超时或失败（30s），稍后重试"
  fi
}

# ── 凭证持久化（.credentials/ 目录） ─────────────────────────────────────────
CRED_DIR=".credentials"

cred_save() {
  mkdir -p "$CRED_DIR"
  local name="$1" value="$2"
  echo "$value" > "${CRED_DIR}/${name}"
  chmod 600 "${CRED_DIR}/${name}"
  log_ok "凭证已保存: ${CRED_DIR}/${name}"
}

cred_load() {
  local name="$1"
  local file="${CRED_DIR}/${name}"
  if [ -f "$file" ]; then
    cat "$file"
    return 0
  fi
  return 1
}

cred_load_or_gen() {
  local name="$1" prefix="${2:-tok}"
  local value
  if value=$(cred_load "$name") && [ -n "$value" ]; then
    echo "$value"
  else
    value=$(gen_token "$prefix")
    cred_save "$name" "$value"
    echo "$value"
  fi
}

# ── 进度跟踪 ──────────────────────────────────────────────────────────────────
STEP_FILE="${CRED_DIR}/.deploy-progress"

step_done() {
  mkdir -p "$CRED_DIR"
  echo "$1" >> "$STEP_FILE"
}

step_check() {
  [ -f "$STEP_FILE" ] && grep -qx "$1" "$STEP_FILE" 2>/dev/null
}

# ── 横幅 ──────────────────────────────────────────────────────────────────────
banner() {
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║  $1${NC}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
}
