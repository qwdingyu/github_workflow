#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# eshop GitHub Actions 一键配置
# 用法:
#   ./scripts/09-configure-github.sh                          # 交互式输入 token
#   CLOUDFLARE_API_TOKEN=cfat_xxx ./scripts/09-configure-github.sh  # 直接传参
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
REPO="qwdingyu/eshop"
cd "$(dirname "$0")/.."

echo "╔══════════════════════════════════════════╗"
echo "║   eshop GitHub Actions 一键配置          ║"
echo "╚══════════════════════════════════════════╝"

# ── Cloudflare API Token ─────────────────────────────────────────────────────
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo ""; echo "需要 Cloudflare API Token"
  echo "  https://dash.cloudflare.com/profile/api-tokens"
  open "https://dash.cloudflare.com/profile/api-tokens" 2>/dev/null || true
  read -rsp "🔑 Token: " CLOUDFLARE_API_TOKEN; echo ""
  [ -z "$CLOUDFLARE_API_TOKEN" ] && echo "❌ 不能为空" && exit 1
fi

# ── ADMIN_TOKEN ──────────────────────────────────────────────────────────────
if [ -f .env.local ]; then
  ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' .env.local | cut -d= -f2-)
  echo "✅ 从 .env.local 读取 ADMIN_TOKEN"
else
  ADMIN_TOKEN=$(openssl rand -hex 24)
  echo "⚠️  自动生成 ADMIN_TOKEN: $ADMIN_TOKEN"
fi

# ── Secrets ──────────────────────────────────────────────────────────────────
echo ""; echo "── Secrets ──"
echo "$CLOUDFLARE_API_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN --repo "$REPO"
echo "  ✅ CLOUDFLARE_API_TOKEN"
echo "$ADMIN_TOKEN" | gh secret set ADMIN_TOKEN --repo "$REPO"
echo "  ✅ ADMIN_TOKEN"

# ── Variables ────────────────────────────────────────────────────────────────
echo ""; echo "── Variables ──"
gh variable set DATABASE_PROVIDER   --repo "$REPO" --body "d1"
echo "  ✅ DATABASE_PROVIDER = d1"
gh variable set ESHOP_D1_DATABASE   --repo "$REPO" --body "${ESHOP_D1_DATABASE:-eshop-db}"
echo "  ✅ ESHOP_D1_DATABASE = ${ESHOP_D1_DATABASE:-eshop-db}"
gh variable set ESHOP_WORKER_NAME   --repo "$REPO" --body "${ESHOP_WORKER_NAME:-eshop}"
echo "  ✅ ESHOP_WORKER_NAME = ${ESHOP_WORKER_NAME:-eshop}"
gh variable set ESHOP_CUSTOM_DOMAIN --repo "$REPO" --body "${ESHOP_CUSTOM_DOMAIN:-eshop.eforge.xyz}"
echo "  ✅ ESHOP_CUSTOM_DOMAIN = ${ESHOP_CUSTOM_DOMAIN:-eshop.eforge.xyz}"
gh variable set ESHOP_BIND_DOMAIN   --repo "$REPO" --body "${ESHOP_BIND_DOMAIN:-false}"
echo "  ✅ ESHOP_BIND_DOMAIN = ${ESHOP_BIND_DOMAIN:-false}"
gh variable set ESHOP_SEED_REMOTE   --repo "$REPO" --body "${ESHOP_SEED_REMOTE:-true}"
echo "  ✅ ESHOP_SEED_REMOTE = ${ESHOP_SEED_REMOTE:-true}"

echo ""; echo "✅ 配置完成！"
