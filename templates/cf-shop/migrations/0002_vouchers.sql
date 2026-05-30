-- ============================================================
-- 0002 充值码 & 用户余额表 + orders 扩展 paid_at
-- ============================================================

-- ═══ 充值码表 ═══
-- 充值码是"预付费凭证"：管理员先批量生成，用户通过兑换码获取余额。
CREATE TABLE IF NOT EXISTS voucher_codes (
  code TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',   -- active / used / expired / revoked
  used_by_email TEXT NOT NULL DEFAULT '',
  used_at TEXT,
  expires_at TEXT,
  batch_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voucher_codes_status ON voucher_codes(status);
CREATE INDEX IF NOT EXISTS idx_voucher_codes_batch ON voucher_codes(batch_id);

-- ═══ 用户余额表 ═══
-- 充值码兑换后的余额按邮箱聚合，支持余额支付。
CREATE TABLE IF NOT EXISTS user_balances (
  email TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  total_deposited_cents INTEGER NOT NULL DEFAULT 0,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══ orders 扩展 ═══
-- SQLite ALTER TABLE 只支持 ADD COLUMN，不支持 IF NOT EXISTS，
-- 此处如果重复执行会报 "duplicate column name"，迁移脚本会捕获并忽略。
ALTER TABLE orders ADD COLUMN paid_at TEXT;
