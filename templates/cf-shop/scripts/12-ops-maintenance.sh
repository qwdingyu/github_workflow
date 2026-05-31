#!/usr/bin/env bash
set -euo pipefail

# eshop 维护脚本。支持 D1/Turso 双引擎切换。
#
# 用途：
# - 备份远程数据库（D1: wrangler d1 export / Turso: turso db dump）。
# - 导出管理端常用数据表。
# - 轮换 ADMIN_TOKEN，并写入 Cloudflare Worker secret。
# - 清理过期幂等键记录。
#
# 环境变量：
# - CLOUDFLARE_API_TOKEN：D1 export 和 secret 写入时必需。
# - DATABASE_PROVIDER：数据库引擎 "d1" 或 "turso"（默认 "d1"）。
# - TURSO_URL：Turso 数据库 URL（DATABASE_PROVIDER=turso 时必需）。
# - TURSO_AUTH_TOKEN：Turso 认证 Token（DATABASE_PROVIDER=turso 时必需）。
# - ESHOP_D1_DATABASE：D1 数据库名，默认 eshop-db。
# - ESHOP_WORKER_NAME：Worker 名称，默认 eshop。
# - BACKUP_DIR：备份目录，默认 ./backups。
# - EXPORT_DIR：管理数据导出目录，默认 ./exports。
# - ADMIN_TOKEN：rotate-admin-token 时可指定新 token；不指定则自动生成。
#
# 常用命令：
# - D1 远程完整备份：
#   CLOUDFLARE_API_TOKEN="<token>" bash scripts/12-ops-maintenance.sh backup-remote
# - Turso 远程完整备份：
#   DATABASE_PROVIDER=turso TURSO_URL="<url>" TURSO_AUTH_TOKEN="<token>" bash scripts/12-ops-maintenance.sh backup-remote
# - 导出管理端相关数据：
#   CLOUDFLARE_API_TOKEN="<token>" bash scripts/12-ops-maintenance.sh export-admin
# - 轮换管理端 token：
#   CLOUDFLARE_API_TOKEN="<token>" bash scripts/12-ops-maintenance.sh rotate-admin-token
# - 清理过期幂等键：
#   bash scripts/12-ops-maintenance.sh cleanup-idempotency-keys
#
# 安全边界：
# - 本脚本生成的 backups/ 和 exports/ 已加入 .gitignore。
# - 导出的 SQL 可能包含卡密、订单、联系方式，不能提交到 Git。
# - rotate-admin-token 会把新 token 打印一次，用户需要保存到自己的密码管理器。

DB_PROVIDER="${DATABASE_PROVIDER:-d1}"
DB_NAME="${ESHOP_D1_DATABASE:-eshop-db}"
WORKER_NAME="${ESHOP_WORKER_NAME:-eshop}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
EXPORT_DIR="${EXPORT_DIR:-exports}"
ACTION="${1:-}"
STAMP="$(date +%Y%m%d_%H%M%S)"

require_cloudflare_token() {
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "缺少 CLOUDFLARE_API_TOKEN" >&2
    exit 1
  fi
}

require_turso_vars() {
  if [[ -z "${TURSO_URL:-}" ]]; then
    echo "DATABASE_PROVIDER=turso 但缺少 TURSO_URL" >&2
    exit 1
  fi
  if [[ -z "${TURSO_AUTH_TOKEN:-}" ]]; then
    echo "DATABASE_PROVIDER=turso 但缺少 TURSO_AUTH_TOKEN" >&2
    exit 1
  fi
}

make_dir() {
  mkdir -p "$1"
}

backup_remote() {
  make_dir "$BACKUP_DIR"
  if [[ "$DB_PROVIDER" == "turso" ]]; then
    require_turso_vars
    local output="${BACKUP_DIR}/turso_${STAMP}_full.sql"
    echo "开始导出远程 Turso 完整备份：${output}"
    turso db dump --url "$TURSO_URL" --auth-token "$TURSO_AUTH_TOKEN" --output "$output"
    echo "备份完成：${output}"
  else
    require_cloudflare_token
    local output="${BACKUP_DIR}/${DB_NAME}_${STAMP}_full.sql"
    echo "开始导出远程 D1 完整备份：${output}"
    npx wrangler d1 export "$DB_NAME" --remote --skip-confirmation --output "$output"
    echo "备份完成：${output}"
  fi
  echo "注意：该文件可能包含卡密和联系方式，不能提交到 Git。"
}

export_admin() {
  if [[ "$DB_PROVIDER" == "turso" ]]; then
    require_turso_vars
    make_dir "$EXPORT_DIR"
    local output="${EXPORT_DIR}/turso_${STAMP}_admin.sql"
    echo "开始导出 Turso 管理端核心数据：${output}"
    # Turso 没有按表导出的快捷命令，导出全量后由用户筛选
    turso db dump --url "$TURSO_URL" --auth-token "$TURSO_AUTH_TOKEN" --output "$output"
    echo "导出完成（全量）：${output}"
    echo "注意：该文件包含全量数据，可能包含卡密和联系方式，不能提交到 Git。"
  else
    require_cloudflare_token
    make_dir "$EXPORT_DIR"
    local output="${EXPORT_DIR}/${DB_NAME}_${STAMP}_admin.sql"
    echo "开始导出管理端核心数据：${output}"
    npx wrangler d1 export "$DB_NAME" \
      --remote \
      --skip-confirmation \
      --output "$output" \
      --table products \
      --table cards \
      --table card_batches \
      --table orders \
      --table order_events \
      --table campaigns \
      --table referral_codes \
      --table referral_events \
      --table coupons \
      --table admin_audit_logs \
      --table email_logs
    echo "导出完成：${output}"
    echo "注意：该文件包含管理数据和可能的卡密，不能提交到 Git。"
  fi
}

rotate_admin_token() {
  require_cloudflare_token
  local token="${ADMIN_TOKEN:-}"
  if [[ -z "$token" ]]; then
    token="$(openssl rand -hex 32)"
  fi
  echo "开始轮换 ${WORKER_NAME} 的 ADMIN_TOKEN secret"
  printf '%s' "$token" | npx wrangler secret put ADMIN_TOKEN --name "$WORKER_NAME"
  echo "ADMIN_TOKEN 已轮换。请立即保存下面的新 token 到密码管理器，后续不会再显示："
  echo "$token"
}

cleanup_idempotency_keys() {
  local sql="DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-30 days')"
  if [[ "$DB_PROVIDER" == "turso" ]]; then
    require_turso_vars
    echo "清理 30 天前过期的幂等键记录（Turso）..."
    echo "$sql" | turso db shell "$TURSO_URL" --auth-token "$TURSO_AUTH_TOKEN"
    echo "清理完成。"
  else
    require_cloudflare_token
    echo "清理 30 天前过期的幂等键记录：${DB_NAME}"
    npx wrangler d1 execute "$DB_NAME" \
      --remote \
      --yes \
      --command="$sql"
    echo "清理完成。"
  fi
}

case "$ACTION" in
  backup-remote)
    backup_remote
    ;;
  export-admin)
    export_admin
    ;;
  rotate-admin-token)
    rotate_admin_token
    ;;
  cleanup-idempotency-keys)
    cleanup_idempotency_keys
    ;;
  *)
    cat >&2 <<'USAGE'
用法：
  bash scripts/12-ops-maintenance.sh backup-remote
  bash scripts/12-ops-maintenance.sh export-admin
  bash scripts/12-ops-maintenance.sh rotate-admin-token
  bash scripts/12-ops-maintenance.sh cleanup-idempotency-keys

引擎切换（通过 DATABASE_PROVIDER 环境变量）：
  DATABASE_PROVIDER=d1    （默认）使用 D1 引擎
  DATABASE_PROVIDER=turso 使用 Turso/libSQL 引擎（需同时设置 TURSO_URL 和 TURSO_AUTH_TOKEN）

示例：
  CLOUDFLARE_API_TOKEN="<token>" bash scripts/12-ops-maintenance.sh backup-remote
  DATABASE_PROVIDER=turso TURSO_URL="<url>" TURSO_AUTH_TOKEN="<token>" bash scripts/12-ops-maintenance.sh backup-remote
  CLOUDFLARE_API_TOKEN="<token>" bash scripts/12-ops-maintenance.sh export-admin
  CLOUDFLARE_API_TOKEN="<token>" bash scripts/12-ops-maintenance.sh rotate-admin-token
  DATABASE_PROVIDER=turso TURSO_URL="<url>" TURSO_AUTH_TOKEN="<token>" bash scripts/12-ops-maintenance.sh cleanup-idempotency-keys
USAGE
    exit 1
    ;;
esac
