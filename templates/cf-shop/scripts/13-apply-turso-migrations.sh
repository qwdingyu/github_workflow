#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────
#  apply-turso-migrations.sh
#
#  用途：将 migrations/*.sql 逐一应用到 Turso 远程数据库。
#
#  环境变量：
#  - TURSO_URL      — Turso 数据库 URL（必需）
#  - TURSO_AUTH_TOKEN — Turso 认证 Token（必需）
#  - MIGRATIONS_DIR — 迁移文件目录（默认 ./migrations）
#
#  用法：
#    TURSO_URL="libsql://xxx.turso.io" TURSO_AUTH_TOKEN="eyJ..." bash scripts/13-apply-turso-migrations.sh
#    # 或通过 npm script：
#    npm run db:migrate:turso
# ──────────────────────────────────────────────────────

MIGRATIONS_DIR="${MIGRATIONS_DIR:-migrations}"

if [[ -z "${TURSO_URL:-}" ]]; then
  echo "❌ 缺少 TURSO_URL 环境变量" >&2
  echo "用法：TURSO_URL=\"libsql://xxx.turso.io\" TURSO_AUTH_TOKEN=\"eyJ...\" bash scripts/13-apply-turso-migrations.sh" >&2
  exit 1
fi

if [[ -z "${TURSO_AUTH_TOKEN:-}" ]]; then
  echo "❌ 缺少 TURSO_AUTH_TOKEN 环境变量" >&2
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "❌ 迁移目录不存在：${MIGRATIONS_DIR}" >&2
  exit 1
fi

# 按文件名排序，确保顺序执行
applied=0
skipped=0
failed=0

for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  filename=$(basename "$f")
  echo "📦 应用迁移：${filename}"
  
  if turso db shell "$TURSO_URL" --auth-token "$TURSO_AUTH_TOKEN" < "$f"; then
    echo "  ✅ ${filename} 成功"
    ((applied++))
  else
    echo "  ❌ ${filename} 失败（可能已应用）"
    ((failed++))
  fi
done

echo ""
echo "━━━ 迁移完成 ━━━"
echo "  成功: ${applied}"
echo "  失败/跳过: ${failed}"
