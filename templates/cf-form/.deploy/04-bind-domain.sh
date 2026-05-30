#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# 04-bind-domain.sh — 域名绑定 + DNS + SSL
#
# 功能：
#   1. 通过 Cloudflare API 绑定 Workers Custom Domain
#   2. 自动推导 Account ID / Zone ID
#   3. 等待 HTTPS 可用
#
# 输入：
#   CLOUDFLARE_API_TOKEN — 必填
#   DOMAIN               — 要绑定的域名（如 shop.eforge.xyz）
#   WORKER_NAME          — Worker 名称（默认从 .credentials 读取）
# ═══════════════════════════════════════════════════════════════════════════════
source "$(dirname "$0")/shared.sh"

# ── 独立运行时的前置检查 ──────────────────────────────────────────────────────
FAIL=0
check_env CLOUDFLARE_API_TOKEN "从 https://dash.cloudflare.com/profile/api-tokens 获取" || FAIL=1
[ "$FAIL" -eq 1 ] && exit 1

WORKER_NAME=$(cred_load "WORKER_NAME" 2>/dev/null || echo "")
DOMAIN="${DOMAIN:-}"

if [ -z "$DOMAIN" ]; then
  echo "用法: DOMAIN=\"shop.eforge.xyz\" bash 04-bind-domain.sh"
  echo ""
  echo "请输入要绑定的域名:"
  read -rp "域名: " DOMAIN
fi

if [ -z "$DOMAIN" ]; then
  log_error "域名不能为空"
  exit 1
fi

if [ -z "$WORKER_NAME" ]; then
  log_error "WORKER_NAME 未找到，请先运行 03-deploy-worker.sh"
  exit 1
fi

banner "域名绑定: $DOMAIN → $WORKER_NAME"

if step_check "04-bind-domain-${DOMAIN}"; then
  log_ok "已完成，跳过"
  exit 0
fi

# ── Step 1: 获取 Account ID ──────────────────────────────────────────────────
log_step "Step 1/4: 获取 Cloudflare Account ID"
ACCOUNT_ID=$(cf_get_account_id)

# ── Step 2: 推导 Zone ID ─────────────────────────────────────────────────────
log_step "Step 2/4: 推导 Zone ID"

# 从域名提取 zone name（取最后两段）
ZONE_NAME=$(echo "$DOMAIN" | awk -F. '{print $(NF-1)"."$NF}')
log_info "Zone name: $ZONE_NAME"

ZONE_RESP=$(cf_api GET "/zones?name=${ZONE_NAME}")
ZONE_ID=$(echo "$ZONE_RESP" | jq -r '.result[0].id // empty')

if [ -z "$ZONE_ID" ]; then
  log_error "未找到 Zone: $ZONE_NAME"
  log_info "请确认域名 $DOMAIN 已托管在 Cloudflare"
  exit 1
fi
log_ok "Zone ID: $ZONE_ID"

# ── Step 3: 绑定 Workers Custom Domain ───────────────────────────────────────
log_step "Step 3/4: 绑定 Workers Custom Domain"

# 检查是否已绑定
EXISTING=$(cf_api GET "/accounts/${ACCOUNT_ID}/workers/domains" 2>/dev/null || echo '{"result":[]}')
EXISTING_ID=$(echo "$EXISTING" | jq -r ".result[] | select(.hostname==\"${DOMAIN}\") | .id" 2>/dev/null)

if [ -n "$EXISTING_ID" ] && [ "$EXISTING_ID" != "null" ]; then
  log_ok "域名已绑定 ($EXISTING_ID)，更新绑定..."
  cf_api PUT "/accounts/${ACCOUNT_ID}/workers/domains/${EXISTING_ID}" \
    "{\"service\":\"${WORKER_NAME}\",\"environment\":\"production\"}" > /dev/null
else
  log_info "创建新绑定..."
  cf_api POST "/accounts/${ACCOUNT_ID}/workers/domains" \
    "{\"service\":\"${WORKER_NAME}\",\"hostname\":\"${DOMAIN}\",\"zone_id\":\"${ZONE_ID}\",\"environment\":\"production\"}" > /dev/null
fi
log_ok "域名绑定成功: $DOMAIN → $WORKER_NAME"

# ── Step 4: 等待 HTTPS 可用 ──────────────────────────────────────────────────
log_step "Step 4/4: 等待 HTTPS 证书签发"

log_info "轮询 https://${DOMAIN}/api/health ..."
for i in $(seq 1 24); do
  STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "https://${DOMAIN}/api/health" 2>/dev/null || echo "000")
  if [ "$STATUS" != "000" ] && [ "$STATUS" != "521" ] && [ "$STATUS" != "522" ]; then
    log_ok "HTTPS 已就绪 (HTTP $STATUS, 第 ${i} 次检查)"
    break
  fi
  echo -n "  ⏳ 第 ${i}/24 次: HTTP $STATUS, 等待 5s..."
  sleep 5
  echo ""
done

cred_save "DOMAIN" "$DOMAIN"
cred_save "BASE_URL" "https://${DOMAIN}"
step_done "04-bind-domain-${DOMAIN}"

echo ""
log_ok "✅ 域名绑定完成"
echo "  URL: https://${DOMAIN}"
echo "  Admin: https://${DOMAIN}/admin"
echo ""
log_info "验证: curl -I https://${DOMAIN}/api/health"
