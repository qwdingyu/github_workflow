#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# cf-tools 一键部署脚本
#
# 流程：检查依赖 → 类型检查 → 测试 → 迁移 → 部署 → 冒烟测试
#
# 用法：
#   CLOUDFLARE_API_TOKEN=xxx ./scripts/deploy.sh
#
# 首次部署前请确保：
#   1. 已安装 wrangler 并登录（wrangler login）
#   2. 已在 Cloudflare 设置 Secrets（JWT_SECRET, ADMIN_TOKEN 等）
#   3. 已创建 Turso 数据库并设置 TURSO_URL / TURSO_TOKEN
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "  cf-tools 部署"
echo "  ==============="
echo ""

# 1. 安装依赖
echo "  [1/6] 安装依赖..."
cd "$PROJECT_DIR"
npm ci --silent 2>/dev/null || npm install --silent

# 2. 类型检查
echo "  [2/6] 类型检查..."
npm run type-check

# 3. 运行测试
echo "  [3/6] 运行测试..."
npm test

# 4. 数据库迁移
echo "  [4/6] 数据库迁移..."
if [ -n "${TURSO_URL:-}" ]; then
  npm run db:migrate
else
  echo "         跳过（未设置 TURSO_URL）"
fi

# 5. 部署到 Cloudflare Workers
echo "  [5/6] 部署到 Cloudflare..."
npx wrangler deploy

# 6. 冒烟测试
echo "  [6/6] 冒烟测试..."
npm run smoke:readonly || echo "  [!] 冒烟测试未通过（非阻塞）"

echo ""
echo "  部署完成！"
echo ""
