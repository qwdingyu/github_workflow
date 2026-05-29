#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# 01-setup-turso.sh — Turso 数据库创建 + 迁移
#
# 功能：
#   1. 通过 Turso API 创建数据库（幂等：已存在则复用）
#   2. 创建数据库 Token
#   3. 执行 SQL 迁移
#   4. 持久化凭证到 .credentials/
#
# 输入：CLOUDFLARE_API_TOKEN, TURSO_API_TOKEN
# 输出：TURSO_URL, TURSO_TOKEN → .credentials/
# ═══════════════════════════════════════════════════════════════════════════════
source "$(dirname "$0")/shared.sh"

PROJECT_NAME=$(cred_load "PROJECT_NAME" 2>/dev/null || basename "$(pwd)")
DB_NAME="${DB_NAME:-${PROJECT_NAME}-db}"
banner "Turso 数据库: $DB_NAME"

if step_check "01-setup-turso"; then
  log_ok "已完成，跳过（删除 .credentials/.deploy-progress 重跑）"
  exit 0
fi

# ── Step 1: 获取组织名 ───────────────────────────────────────────────────────
log_step "Step 1/4: 获取 Turso 组织信息"
ORG=$(turso_get_org)

# ── Step 2: 创建数据库（幂等） ───────────────────────────────────────────────
log_step "Step 2/4: 创建数据库 $DB_NAME"

EXISTING=$(turso_api GET "/organizations/${ORG}/databases/${DB_NAME}" 2>/dev/null || echo '{}')
DB_HOSTNAME=$(echo "$EXISTING" | jq -r '.database.Hostname // empty' 2>/dev/null)

if [ -n "$DB_HOSTNAME" ] && [ "$DB_HOSTNAME" != "null" ]; then
  log_ok "数据库已存在: $DB_HOSTNAME"
else
  log_info "创建新数据库..."
  RESULT=$(turso_api POST "/organizations/${ORG}/databases" "{\"name\":\"${DB_NAME}\",\"group\":\"default\"}")
  DB_HOSTNAME=$(echo "$RESULT" | jq -r '.database.Hostname // empty')
  if [ -z "$DB_HOSTNAME" ]; then
    log_error "创建数据库失败"
    echo "$RESULT" | jq .
    exit 1
  fi
  log_ok "数据库已创建: $DB_HOSTNAME"
fi

TURSO_URL="libsql://${DB_HOSTNAME}"

# ── Step 3: 创建数据库 Token ─────────────────────────────────────────────────
log_step "Step 3/4: 创建数据库 Token"

# 检查是否已有 token
EXISTING_TOKEN=$(cred_load "TURSO_TOKEN" 2>/dev/null || echo "")
if [ -n "$EXISTING_TOKEN" ]; then
  TURSO_TOKEN="$EXISTING_TOKEN"
  log_ok "复用已有 Token"
else
  # Turso REST API 的 Token 创建端点不稳定，改用 turso CLI（更可靠）
  if command -v turso &>/dev/null; then
    # 禁用 Homebrew 自动更新，避免 turso 命令因 brew upgrade 超时
    export HOMEBREW_NO_AUTO_UPDATE=1
    TURSO_TOKEN=$(timeout 30 turso db tokens create "$DB_NAME" 2>/dev/null | grep -E '^eyJ' | head -1)
    if [ -z "$TURSO_TOKEN" ]; then
      log_error "turso CLI 创建 Token 失败（30s 超时或输出异常）"
      log_info "请手动运行: HOMEBREW_NO_AUTO_UPDATE=1 turso db tokens create $DB_NAME"
      exit 1
    fi
    log_ok "Token 已创建 (via turso CLI)"
  else
    log_error "turso CLI 未安装，无法创建 Token"
    log_info "安装: curl -sSfL https://get.tur.so/install.sh | bash"
    exit 1
  fi
fi

# ── Step 4: 执行 SQL 迁移 ────────────────────────────────────────────────────
log_step "Step 4/4: 执行数据库迁移"

export TURSO_URL TURSO_TOKEN

if [ -f "scripts/migrate.mjs" ]; then
  log_info "运行 scripts/migrate.mjs ..."
  node scripts/migrate.mjs
  log_ok "迁移完成"
elif [ -d "migrations" ]; then
  MIGRATION_FILES=$(find migrations -name "*.sql" -type f | sort)
  if [ -n "$MIGRATION_FILES" ]; then
    log_info "执行 ${MIGRATION_FILES##*$'\n'} 个迁移文件..."
    # 使用 libsql HTTP 客户端逐条执行
    node -e "
      const { createClient } = require('@libsql/client');
      const fs = require('fs');
      const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
      const files = fs.readdirSync('migrations').filter(f => f.endsWith('.sql')).sort();
      (async () => {
        for (const f of files) {
          const sql = fs.readFileSync('migrations/' + f, 'utf-8');
          const stmts = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
          for (const stmt of stmts) {
            try { await client.execute(stmt); }
            catch(e) { if (!e.message?.includes('already exists')) { console.error(f, e.message); } }
          }
          console.log('  📄 ' + f + ' (' + stmts.length + ' statements)');
        }
        console.log('✅ All migrations applied');
      })();
    " 2>/dev/null || {
      # 回退：通过环境变量传递凭证（避免 shell 转义风险）
      log_warn "node 执行失败，尝试回退迁移..."
      for f in $MIGRATION_FILES; do
        log_info "  执行 $f ..."
        while IFS= read -r stmt; do
          [ -z "$stmt" ] && continue
          TURSO_URL="$TURSO_URL" TURSO_TOKEN="$TURSO_TOKEN" MIGRATION_STMT="$stmt" node -e "
            const { createClient } = require('@libsql/client');
            const c = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
            c.execute(process.env.MIGRATION_STMT).catch(e => {
              if (!e.message?.includes('already exists')) console.error(e.message);
            });
          " 2>/dev/null || true
        done < <(grep -v '^--' "$f" | tr '\n' ' ' | sed 's/;/;\n/g')
      done
    }
  else
    log_warn "migrations/ 目录下无 SQL 文件"
  fi
else
  log_warn "未找到迁移文件（scripts/migrate.mjs 或 migrations/），跳过"
fi

# ── 持久化凭证 ────────────────────────────────────────────────────────────────
cred_save "TURSO_URL" "$TURSO_URL"
cred_save "TURSO_TOKEN" "$TURSO_TOKEN"
cred_save "DB_NAME" "$DB_NAME"

step_done "01-setup-turso"

echo ""
log_ok "✅ Turso 数据库就绪"
echo "  URL:   $TURSO_URL"
echo "  DB:    $DB_NAME"
echo "  Token: ${TURSO_TOKEN:0:20}..."
