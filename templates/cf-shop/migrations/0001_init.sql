-- ============================================================
-- cf-shop 数据库初始化（幂等，全部 IF NOT EXISTS）
-- 公共表（system_config / admin_audit_logs / rate_limit_windows /
-- idempotency_keys / api_keys）+ 业务表
-- ============================================================

-- ═══ 公共表 ═══

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  action TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (action, ip_hash, window_start)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  response_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, action)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL DEFAULT 'free',
  enabled INTEGER NOT NULL DEFAULT 1,
  monthly_quota INTEGER NOT NULL DEFAULT 0,
  monthly_usage INTEGER NOT NULL DEFAULT 0,
  monthly_reset_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

-- ═══ 业务表 ═══

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'card',
  price_cents INTEGER NOT NULL DEFAULT 0,
  original_price_cents INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  instructions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_enabled_sort ON products(enabled, sort_order);

CREATE TABLE IF NOT EXISTS card_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  batch_id TEXT,
  card_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  locked_by_order_id TEXT,
  issued_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_product_status ON cards(product_id, status);
CREATE INDEX IF NOT EXISTS idx_cards_locked ON cards(locked_by_order_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  buyer_email TEXT NOT NULL,
  buyer_ip_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT '',
  payment_trade_no TEXT NOT NULL DEFAULT '',
  coupon_code TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_expires ON orders(expires_at);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value INTEGER NOT NULL DEFAULT 0,
  min_order_cents INTEGER NOT NULL DEFAULT 0,
  max_usage INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT NOT NULL DEFAULT '',
  order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_logs (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  action TEXT NOT NULL,
  operator TEXT NOT NULL DEFAULT 'system',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_card_logs_card ON card_logs(card_id);

-- ═══ 种子数据 ═══

INSERT OR IGNORE INTO system_config (key, value, updated_at) VALUES
  ('shop_name', '我的发卡商城', datetime('now')),
  ('order_expire_minutes', '30', datetime('now')),
  ('require_email', 'true', datetime('now'));
