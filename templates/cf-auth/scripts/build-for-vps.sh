#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# build-for-vps.sh —— cf-auth VPS/云服务器 编译打包脚本
#
# 用法：
#   bash scripts/build-for-vps.sh                # 编译 + minify
#   bash scripts/build-for-vps.sh --obfuscate    # 编译 + minify + 混淆
#   bash scripts/build-for-vps.sh --package      # 编译 + 打包 tar.gz
#   bash scripts/build-for-vps.sh --obfuscate --package  # 全部
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DO_OBFUSCATE=false
DO_PACKAGE=false
for arg in "$@"; do
  case "$arg" in
    --obfuscate) DO_OBFUSCATE=true ;;
    --package)   DO_PACKAGE=true ;;
  esac
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[build]${NC} $*"; }
warn()  { echo -e "${YELLOW}[build]${NC} $*"; }

rm -rf dist && mkdir -p dist
info "步骤 1/3：TypeScript 类型检查..."
npx tsc --noEmit
info "tsc 通过"

info "步骤 2/3：前端构建..."
npm run build:frontend
info "前端构建完成 → public/"

info "步骤 3/3：esbuild 编译打包..."
npx esbuild src/server.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --minify \
  --external:@libsql/client \
  --external:better-auth \
  --external:dotenv \
  --external:nodemailer \
  --external:@usethink/cf-core \
  --outfile=dist/server.js

RAW_SIZE=$(stat -f%z dist/server.js 2>/dev/null || stat -c%s dist/server.js 2>/dev/null || echo 0)
info "后端编译完成 → dist/server.js ($(echo "scale=1; $RAW_SIZE/1024" | bc 2>/dev/null || echo -n "?")KB)"

# ── 可选混淆 ──
if [ "$DO_OBFUSCATE" = true ]; then
  info "javascript-obfuscator 混淆..."
  npx javascript-obfuscator dist/server.js \
    --output dist/server.js \
    --string-array-encoding rc4 \
    --compact true \
    --simplify true \
    --rename-globals false \
    --control-flow-flattening false \
    --dead-code-injection false 2>&1 || {
      warn "混淆失败，跳过"
    }
fi

# ── 可选打包 ──
if [ "$DO_PACKAGE" = true ]; then
  info "打包部署包..."
  PACKAGE="cf-auth-deploy-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar -czf "$PACKAGE" dist/server.js public/ ecosystem.config.json package.json
  # 故意排除 package-lock.json：跨环境 lock 文件冲突（macOS→Debian npm 版本差异）
  info "打包完成 → $PACKAGE ($(du -h "$PACKAGE" | cut -f1))"
fi

echo ""
info "✅ cf-auth VPS 构建完成"
echo "   后端: dist/server.js"
echo "   前端: public/"
if [ "$DO_PACKAGE" = true ]; then
  echo "   部署包: $PACKAGE"
fi
echo "   运行: PORT=8788 node dist/server.js"
