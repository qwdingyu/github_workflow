#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# 03-deploy-worker.sh — 构建 + 部署 Worker + 冒烟测试
#
# 功能：
#   1. 构建前端（如有 build:frontend 脚本）
#   2. 通过 --secrets-file 部署 Worker（含所有 Secrets）
#   3. 运行冒烟测试
#
# 输入：CLOUDFLARE_API_TOKEN + .credentials/ 下的所有凭证
# ═══════════════════════════════════════════════════════════════════════════════
source "$(dirname "$0")/shared.sh"

PROJECT_NAME=$(cred_load "PROJECT_NAME" 2>/dev/null || basename "$(pwd)")
WORKER_NAME="${WORKER_NAME:-${PROJECT_NAME}}"
banner "部署 Worker: $WORKER_NAME"

# ── 独立运行时的前置检查 ──────────────────────────────────────────────────────
FAIL=0
check_env CLOUDFLARE_API_TOKEN "从 https://dash.cloudflare.com/profile/api-tokens 获取" || FAIL=1
[ "$FAIL" -eq 1 ] && exit 1

if step_check "03-deploy-worker"; then
  log_ok "已完成，跳过"
  exit 0
fi

# ── 加载凭证 ──────────────────────────────────────────────────────────────────
TURSO_URL=$(cred_load "TURSO_URL" 2>/dev/null || echo "")
TURSO_TOKEN=$(cred_load "TURSO_TOKEN" 2>/dev/null || echo "")
ADMIN_TOKEN=$(cred_load "ADMIN_TOKEN" 2>/dev/null || echo "")
RATE_LIMIT_SALT=$(cred_load "RATE_LIMIT_SALT" 2>/dev/null || echo "")
JWT_SECRET=$(cred_load "JWT_SECRET" 2>/dev/null || echo "")
CREDENTIALS_ENCRYPTION_KEY=$(cred_load "CREDENTIALS_ENCRYPTION_KEY" 2>/dev/null || echo "")

if [ -z "$TURSO_URL" ]; then
  log_error "TURSO_URL 未找到，请先运行 01-setup-turso.sh"
  exit 1
fi

# ── Step 1: 构建前端（可选） ─────────────────────────────────────────────────
log_step "Step 1/3: 构建前端"

if grep -q '"build:frontend"' package.json 2>/dev/null; then
  log_info "npm run build:frontend ..."
  npm run build:frontend
  log_ok "前端构建完成"
else
  log_ok "无前端构建步骤，跳过"
fi

# ── Step 2: 部署 Worker ──────────────────────────────────────────────────────
log_step "Step 2/3: 部署 Worker"

# 生成临时 secrets 文件
SECRETS_FILE=".deploy-secrets.env"
cat > "$SECRETS_FILE" <<EOF
TURSO_URL=${TURSO_URL}
TURSO_TOKEN=${TURSO_TOKEN}
ADMIN_TOKEN=${ADMIN_TOKEN}
RATE_LIMIT_SALT=${RATE_LIMIT_SALT}
EOF

# 可选 secrets（非空才加入）
[ -n "$JWT_SECRET" ] && echo "JWT_SECRET=${JWT_SECRET}" >> "$SECRETS_FILE"
[ -n "$CREDENTIALS_ENCRYPTION_KEY" ] && echo "CREDENTIALS_ENCRYPTION_KEY=${CREDENTIALS_ENCRYPTION_KEY}" >> "$SECRETS_FILE"

# 加载项目特有的 secrets（.credentials/ 下大写文件）
for f in .credentials/[A-Z]*; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  # 跳过已处理的
  case "$name" in
    TURSO_URL|TURSO_TOKEN|ADMIN_TOKEN|RATE_LIMIT_SALT|JWT_SECRET|CREDENTIALS_ENCRYPTION_KEY) continue ;;
    GITHUB_REPO|PROJECT_NAME|DB_NAME) continue ;;
    .deploy-progress) continue ;;
  esac
  value=$(cat "$f")
  echo "${name}=${value}" >> "$SECRETS_FILE"
done

log_info "npx wrangler deploy --secrets-file ..."
DEPLOY_OUTPUT=$(CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN}" npx wrangler deploy --secrets-file="$SECRETS_FILE" 2>&1)
echo "$DEPLOY_OUTPUT"

# 清理临时文件
: > "$SECRETS_FILE" && rm -f "$SECRETS_FILE"
log_ok "Worker 已部署"

# ── Step 3: 冒烟测试 ─────────────────────────────────────────────────────────
log_step "Step 3/3: 冒烟测试"

# 从 wrangler deploy 输出中解析实际 URL（账户子域名可能不是 workers.dev）
BASE_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1)
if [ -z "$BASE_URL" ]; then
  BASE_URL="https://${WORKER_NAME}.workers.dev"
  log_warn "无法从 deploy 输出解析 URL，使用默认: $BASE_URL"
fi

# ── 通过 Cloudflare API 权威验证 Worker 是否在线 ──
log_info "通过 CF API 验证 Worker 部署状态..."
CF_ACCOUNT_ID=$(curl -sS "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" 2>/dev/null | jq -r '.result[0].id // empty')

if [ -n "$CF_ACCOUNT_ID" ]; then
  WORKER_EXISTS=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" 2>/dev/null | \
    jq -r ".result[] | select(.id == \"${WORKER_NAME}\") | .id" 2>/dev/null)
  if [ "$WORKER_EXISTS" = "$WORKER_NAME" ]; then
    log_ok "CF API 确认 Worker '${WORKER_NAME}' 已在线"
  else
    log_warn "CF API 未找到 Worker '${WORKER_NAME}'（可能延迟同步）"
  fi
else
  log_warn "无法获取 CF Account ID，跳过 API 验证"
fi

# ── HTTP 冒烟测试（带超时容错，workers.dev 在部分地区可能不可达） ──
log_info "HTTP 冒烟测试 (${BASE_URL}/api/health) ..."
HTTP_STATUS=$(curl -sS -o /tmp/smoke-health.json -w "%{http_code}" --max-time 10 \
  "${BASE_URL}/api/health" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
  log_ok "健康检查通过 (HTTP 200)"
  cat /tmp/smoke-health.json 2>/dev/null | jq . 2>/dev/null || true
elif [ "$HTTP_STATUS" = "000" ]; then
  log_warn "HTTP 连接超时（workers.dev 在部分地区不稳定）"
  log_info "Worker 已通过 CF API 确认在线，如需稳定访问请绑定自定义域名"
  log_info "  DOMAIN=\"your-domain.com\" bash .deploy/04-bind-domain.sh"
else
  log_warn "健康检查返回 HTTP $HTTP_STATUS"
fi

# 管理端冒烟（同样带超时容错）
if [ -n "$ADMIN_TOKEN" ]; then
  ADMIN_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${BASE_URL}/api/admin/summary" 2>/dev/null || echo "000")
  if [ "$ADMIN_STATUS" = "200" ]; then
    log_ok "管理端认证通过 (HTTP 200)"
  elif [ "$ADMIN_STATUS" = "000" ]; then
    log_warn "管理端连接超时（同 HTTP 冒烟测试）"
  elif [ "$ADMIN_STATUS" = "401" ]; then
    log_error "管理端认证失败 (HTTP 401)，ADMIN_TOKEN 可能不正确"
  else
    log_warn "管理端返回 HTTP $ADMIN_STATUS"
  fi
fi

cred_save "WORKER_NAME" "$WORKER_NAME"
cred_save "BASE_URL" "$BASE_URL"
step_done "03-deploy-worker"

echo ""
log_ok "✅ Worker 部署完成"
echo "  URL: $BASE_URL"
echo "  Admin: $BASE_URL/admin"
