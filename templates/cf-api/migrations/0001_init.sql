-- ═══════════════════════════════════════════════════════════════════════════════
-- cf-api 初始化迁移（0001_init）
--
-- 包含：
-- 1. 公共表（@eforge/cf-core）
-- 2. 业务表（cf-api 特有）
--
-- 执行方式：
--   turso db shell <db-name> < migrations/0001_init.sql
--   或 node scripts/migrate.mjs
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══ 公共表（@eforge/cf-core） ═══

-- 系统配置（KV 存储）
CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT ''
);

-- 管理员审计日志
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id            TEXT PRIMARY KEY,
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL DEFAULT '',
  target_id     TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT ''
);

-- 限流窗口
CREATE TABLE IF NOT EXISTS rate_limit_windows (
  action        TEXT NOT NULL,
  ip_hash       TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (action, ip_hash, window_start)
);

-- 幂等键
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key           TEXT NOT NULL,
  action        TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT ''
);

-- API Key
CREATE TABLE IF NOT EXISTS api_keys (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  key_hash        TEXT NOT NULL,
  user_id         TEXT NOT NULL DEFAULT '',
  tier            TEXT NOT NULL DEFAULT 'free',
  enabled         INTEGER NOT NULL DEFAULT 1,
  monthly_quota   INTEGER NOT NULL DEFAULT 0,
  monthly_usage   INTEGER NOT NULL DEFAULT 0,
  monthly_reset_at TEXT,
  last_used_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT '',
  updated_at      TEXT NOT NULL DEFAULT '',
  expires_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- ═══ 业务表 ═══

-- 凭证表（核心）
CREATE TABLE IF NOT EXISTS tokens (
  id                TEXT PRIMARY KEY,
  service_type      TEXT NOT NULL,
  channel_id        TEXT DEFAULT '',
  api_key_id        TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'unused',
  encrypted_payload TEXT NOT NULL DEFAULT '',
  result_json       TEXT NOT NULL DEFAULT '{}',
  external_id       TEXT DEFAULT '',
  error_message     TEXT DEFAULT '',
  ip_hash           TEXT NOT NULL DEFAULT '',
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);
CREATE INDEX IF NOT EXISTS idx_tokens_api_key ON tokens(api_key_id);
CREATE INDEX IF NOT EXISTS idx_tokens_service ON tokens(service_type);
CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_tokens_created ON tokens(created_at);

-- 渠道配置表
CREATE TABLE IF NOT EXISTS channels (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  type               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  priority           INTEGER NOT NULL DEFAULT 10,
  supported_services TEXT NOT NULL DEFAULT '[]',
  config_json        TEXT NOT NULL DEFAULT '{}',
  success_rate       INTEGER NOT NULL DEFAULT 100,
  today_calls        INTEGER NOT NULL DEFAULT 0,
  today_failures     INTEGER NOT NULL DEFAULT 0,
  last_used_at       TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type);
CREATE INDEX IF NOT EXISTS idx_channels_status ON channels(status);

-- 服务调用日志
CREATE TABLE IF NOT EXISTS service_logs (
  id             TEXT PRIMARY KEY,
  token_id       TEXT NOT NULL DEFAULT '',
  service_type   TEXT NOT NULL,
  channel_id     TEXT DEFAULT '',
  action         TEXT NOT NULL,
  result         TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  request_json   TEXT NOT NULL DEFAULT '{}',
  response_json  TEXT NOT NULL DEFAULT '{}',
  error_message  TEXT DEFAULT '',
  ip_hash        TEXT NOT NULL DEFAULT '',
  api_key_id     TEXT DEFAULT '',
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_token ON service_logs(token_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON service_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_action ON service_logs(action);

-- 价格变更记录
CREATE TABLE IF NOT EXISTS price_history (
  id           TEXT PRIMARY KEY,
  service_type TEXT NOT NULL,
  channel_id   TEXT DEFAULT '',
  old_price    INTEGER NOT NULL DEFAULT 0,
  new_price    INTEGER NOT NULL DEFAULT 0,
  reason       TEXT NOT NULL DEFAULT '',
  operator_id  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_service ON price_history(service_type);

-- 价格快照（每日统计）
CREATE TABLE IF NOT EXISTS price_snapshot (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL,
  service_type    TEXT NOT NULL,
  channel_id      TEXT NOT NULL DEFAULT '',
  call_count      INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  avg_duration_ms INTEGER NOT NULL DEFAULT 0,
  total_cost      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_date ON price_snapshot(date);
CREATE INDEX IF NOT EXISTS idx_snapshot_service ON price_snapshot(service_type);
