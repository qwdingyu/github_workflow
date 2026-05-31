#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# eshop GitHub Actions 一键配置脚本
#
# 用途：
#   通过 gh CLI 自动配置仓库 Secrets 和 Variables，使 GitHub Actions
#   deploy.yml 和 backup-daily.yml 能全自动运行，无需人工干预。
#
# 前置条件：
#   - gh CLI 已安装且已登录 (gh auth status)
#   - 有仓库 qwdingyu/eshop 的写入权限
#
# 环境变量：
#   - REPO            — GitHub 仓库，默认 qwdingyu/eshop
#   - CLOUDFLARE_API_TOKEN — 必须，Cloudflare API Token
#   - ADMIN_TOKEN     — 必须，管理后台 Token
#
# 使用：
#   CLOUDFLARE_API_TOKEN="xxx" ADMIN_TOKEN="yyy" bash scripts/10-setup-github.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="${REPO:-qwdingyu/eshop}"

echo "=========================================="
echo "  eshop GitHub Actions 配置"
echo "  仓库: $REPO"
echo "=========================================="

# ── 检查 gh CLI ──────────────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "❌ 未找到 gh 命令，请先安装 GitHub CLI"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "❌ gh 未登录，请运行 gh auth login"
  exit 1
fi

# ── 检查必填环境变量 ─────────────────────────────────────────────────────────
MISSING=0

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "❌ 缺少 CLOUDFLARE_API_TOKEN"
  MISSING=1
fi

if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "❌ 缺少 ADMIN_TOKEN"
  MISSING=1
fi

if [ -z "${TURSO_DB_URL:-}" ]; then
  echo "❌ 缺少 TURSO_DB_URL"
  MISSING=1
fi

if [ -z "${TURSO_DB_AUTH_TOKEN:-}" ]; then
  echo "❌ 缺少 TURSO_DB_AUTH_TOKEN"
  MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "用法:"
  echo "  CLOUDFLARE_API_TOKEN=\"<token>\" ADMIN_TOKEN=\"<token>\" \\"
  echo "  TURSO_DB_URL=\"libsql://xxx.turso.io\" TURSO_DB_AUTH_TOKEN=\"<token>\" \\"
  echo "  bash scripts/10-setup-github.sh"
  echo ""
  echo "可选:"
  echo "  REPO=qwdingyu/eshop  # 自定义仓库"
  echo "  PAYJS_MCHID=xxx      # PayJS 商户号（线上支付）"
  echo "  PAYJS_KEY=xxx        # PayJS 密钥"
  echo "  TURNSTILE_SECRET_KEY=xxx  # Cloudflare Turnstile 密钥"
  echo "  RESEND_API_KEY=xxx   # Resend 邮件 API 密钥"
  exit 1
fi

# ── 设置 Secrets ─────────────────────────────────────────────────────────────
echo ""
echo "── 配置 Secrets ──"

echo "  → CLOUDFLARE_API_TOKEN ..."
echo "$CLOUDFLARE_API_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN --repo "$REPO"
echo "  ✅ CLOUDFLARE_API_TOKEN"

echo "  → ADMIN_TOKEN ..."
echo "$ADMIN_TOKEN" | gh secret set ADMIN_TOKEN --repo "$REPO"
echo "  ✅ ADMIN_TOKEN"

echo "  → TURSO_DB_URL ..."
echo "$TURSO_DB_URL" | gh secret set TURSO_DB_URL --repo "$REPO"
echo "  ✅ TURSO_DB_URL"

echo "  → TURSO_DB_AUTH_TOKEN ..."
echo "$TURSO_DB_AUTH_TOKEN" | gh secret set TURSO_DB_AUTH_TOKEN --repo "$REPO"
echo "  ✅ TURSO_DB_AUTH_TOKEN"

# ── 可选 Secrets ─────────────────────────────────────────────────────────────
for SECRET_NAME in PAYJS_MCHID PAYJS_KEY TURNSTILE_SECRET_KEY RESEND_API_KEY CF_AUTH_EMAIL CF_GLOBAL_API_KEY; do
  if [ -n "${!SECRET_NAME:-}" ]; then
    echo "  → $SECRET_NAME ..."
    echo "${!SECRET_NAME}" | gh secret set "$SECRET_NAME" --repo "$REPO"
    echo "  ✅ $SECRET_NAME"
  else
    echo "  ⊘ $SECRET_NAME (跳过，未设置)"
  fi
done

# ── 设置 Variables ───────────────────────────────────────────────────────────
echo ""
echo "── 配置 Variables ──"

# 删除旧的 DATABASE_PROVIDER 变量（项目已迁移到纯 Turso）
gh variable delete DATABASE_PROVIDER --repo "$REPO" 2>/dev/null || true

gh variable set ESHOP_WORKER_NAME --repo "$REPO" --body "${ESHOP_WORKER_NAME:-eshop}"
echo "  ✅ ESHOP_WORKER_NAME = ${ESHOP_WORKER_NAME:-eshop}"

gh variable set ESHOP_CUSTOM_DOMAIN --repo "$REPO" --body "${ESHOP_CUSTOM_DOMAIN:-eshop.eforge.xyz}"
echo "  ✅ ESHOP_CUSTOM_DOMAIN = ${ESHOP_CUSTOM_DOMAIN:-eshop.eforge.xyz}"

# ── 验证 ─────────────────────────────────────────────────────────────────────
echo ""
echo "── 当前配置 ──"
echo ""
echo "Secrets:"
gh secret list --repo "$REPO" 2>/dev/null || echo "  (无法列出 secrets)"
echo ""
echo "Variables:"
gh variable list --repo "$REPO" 2>/dev/null || echo "  (无法列出 variables)"

# ── 总结 ─────────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  ✅ GitHub Actions 配置完成！"
echo "=========================================="
echo ""
echo "下一步："
echo "  1. push 代码到 main 分支，deploy.yml 将自动触发"
echo "  2. 或手动触发: gh workflow run deploy.yml --repo $REPO"
echo "  3. 查看运行:   gh run watch --repo $REPO"
echo ""
echo "⚠️  注意："
echo "  - 首次部署会自动应用 Turso 数据库迁移"
echo "  - 管理后台 Token 已通过 Worker secret 配置"
