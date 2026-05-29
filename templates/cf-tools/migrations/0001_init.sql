-- ═══════════════════════════════════════════════════════════════════════════════
-- cf-tools — 初始化迁移（0001_init.sql）
--
-- 包含：
--   1. cf-core 公共表（system_config / admin_audit_logs / rate_limit_windows /
--      idempotency_keys / api_keys）
--   2. 业务表（users / tools / tool_usage_logs）
--   3. 种子数据（系统配置 + 示例工具）
--
-- 执行方式：
--   node scripts/migrate.mjs
--   或通过 Turso CLI：turso db shell <dbname> < migrations/0001_init.sql
--
-- 注意：管理员用户由 scripts/migrate.mjs 动态创建（含密码哈希）
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══ 1. cf-core 公共表 ═══════════════════════════════════════════════════════

-- 系统配置表（KV 存储，热生效）
CREATE TABLE IF NOT EXISTS system_config (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT ''
);

-- 管理员审计日志表
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id            TEXT PRIMARY KEY,
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL DEFAULT '',
  target_id     TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT ''
);

-- 限流窗口表（DB 版限流 — 原子 upsert）
CREATE TABLE IF NOT EXISTS rate_limit_windows (
  action         TEXT    NOT NULL,
  ip_hash        TEXT    NOT NULL,
  window_start   INTEGER NOT NULL,
  request_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (action, ip_hash, window_start)
);

-- 幂等键表（防重复提交）
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            TEXT NOT NULL,
  action         TEXT NOT NULL,
  resource_id    TEXT NOT NULL,
  response_json  TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT ''
);

-- API Key 表（可选启用）
CREATE TABLE IF NOT EXISTS api_keys (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  key_hash         TEXT NOT NULL,
  user_id          TEXT NOT NULL DEFAULT '',
  tier             TEXT NOT NULL DEFAULT 'free',
  enabled          INTEGER NOT NULL DEFAULT 1,
  monthly_quota    INTEGER NOT NULL DEFAULT 0,
  monthly_usage    INTEGER NOT NULL DEFAULT 0,
  monthly_reset_at TEXT,
  last_used_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT '',
  expires_at       TEXT
);

-- ═══ 2. 业务表 ═══════════════════════════════════════════════════════════════

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT '',
  role           TEXT NOT NULL DEFAULT 'user',
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 工具注册表
CREATE TABLE IF NOT EXISTS tools (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  icon         TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT '其他',
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_slug ON tools(slug);
CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category);
CREATE INDEX IF NOT EXISTS idx_tools_enabled ON tools(enabled);

-- 工具使用日志表
CREATE TABLE IF NOT EXISTS tool_usage_logs (
  id             TEXT PRIMARY KEY,
  tool_slug      TEXT NOT NULL,
  user_id        TEXT,
  ip_hash        TEXT NOT NULL DEFAULT '',
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'success',
  error_message  TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_tool_slug ON tool_usage_logs(tool_slug);
CREATE INDEX IF NOT EXISTS idx_usage_user_id ON tool_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON tool_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_status ON tool_usage_logs(status);

-- 限流窗口时间索引（方便定期清理过期数据）
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit_windows(window_start);

-- ═══ 3. 种子数据 ═════════════════════════════════════════════════════════════

-- 系统配置
INSERT OR IGNORE INTO system_config (key, value, updated_at) VALUES
  ('site_name', 'CF Tools', datetime('now')),
  ('site_description', '在线工具箱 — 快速、安全、免费', datetime('now')),
  ('enable_registration', 'true', datetime('now'));

-- 示例工具：文本哈希生成器
INSERT OR IGNORE INTO tools (id, name, slug, description, icon, category, enabled, sort_order, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '文本哈希生成器',
  'text-hash',
  '支持 SHA-256 / SHA-1 / MD5 等多种哈希算法',
  '#',
  '编码',
  1,
  100,
  datetime('now'),
  datetime('now')
);

-- 注意：管理员用户由 scripts/migrate.mjs 动态创建（含密码哈希计算）
-- 默认管理员邮箱: admin@cf-tools.local
-- 默认密码: changeme123（部署后请立即修改！）
