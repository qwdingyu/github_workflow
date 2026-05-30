-- DTC 故障码查询服务 — 初始化表结构
-- 使用 CREATE TABLE IF NOT EXISTS，幂等执行
-- 注：数据导入脚本 scripts/import-data.mjs 会通过 Drizzle ORM 自动建表和导入数据
-- 此迁移文件供手动初始化使用

CREATE TABLE IF NOT EXISTS dtc_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  system TEXT NOT NULL DEFAULT '',
  system_short TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  description_zh TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT 'GENERIC',
  is_generic INTEGER NOT NULL DEFAULT 1,
  locale TEXT NOT NULL DEFAULT 'en',
  source TEXT NOT NULL DEFAULT '',
  cause TEXT NOT NULL DEFAULT '',
  remedy TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'medium',
  related_codes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS manufacturers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  brands TEXT NOT NULL DEFAULT '[]',
  code_count INTEGER NOT NULL DEFAULT 0,
  logo_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_dtc_codes_code ON dtc_codes(code);
CREATE INDEX IF NOT EXISTS idx_dtc_codes_manufacturer ON dtc_codes(manufacturer);
CREATE INDEX IF NOT EXISTS idx_dtc_codes_system_short ON dtc_codes(system_short);
CREATE INDEX IF NOT EXISTS idx_dtc_codes_code_mfr ON dtc_codes(code, manufacturer);