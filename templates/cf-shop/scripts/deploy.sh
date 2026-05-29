#!/usr/bin/env bash
# ============================================================
# 一键部署脚本（所有模板共用结构）
#
# 流程：检查依赖 → 类型检查 → 测试 → 部署 → 冒烟测试
#
# 用法：
#   CLOUDFLARE_API_TOKEN=xxx ./scripts/deploy.sh
# ============================================================
set -euo pipefail

echo "🚀 Starting deployment..."

# 1. 检查依赖
echo "📦 Checking dependencies..."
npm ci --silent

# 2. 类型检查
echo "🔍 Type checking..."
npm run type-check

# 3. 运行测试
echo "🧪 Running tests..."
npm test

# 4. 部署
echo "☁️  Deploying to Cloudflare Workers..."
npx wrangler deploy

# 5. 冒烟测试
echo "🔬 Smoke testing..."
npm run smoke:readonly || echo "⚠️  Smoke test failed (non-blocking)"

echo ""
echo "✅ Deployment complete!"
