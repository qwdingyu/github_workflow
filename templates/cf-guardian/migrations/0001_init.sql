-- SEO Guardian Turso (LibSQL) Database Schema
-- Migration 0001: Core tables for MVP

-- Users (email + password auth, SHA-256 salted hash)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  plan TEXT DEFAULT 'free',  -- free | starter | pro | agency
  trial_ends_at TEXT,
  token TEXT UNIQUE NOT NULL,  -- simple auth token
  password_hash TEXT  -- salt$sha256 hash
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);

-- Add password_hash column if not present (migration for existing databases)
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- Monitored sites
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  url TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'active',  -- active | paused | error
  last_scan_at TEXT,
  last_score INTEGER,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status);

-- Scan results (one row per scan per site)
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  score INTEGER,
  status TEXT DEFAULT 'running',  -- running | completed | failed
  http_status INTEGER,
  load_time_ms INTEGER,
  page_size_bytes INTEGER,
  request_count INTEGER,
  title TEXT,
  title_length INTEGER,
  meta_description TEXT,
  meta_description_length INTEGER,
  h1_count INTEGER,
  h2_count INTEGER,
  image_count INTEGER,
  image_missing_alt INTEGER,
  internal_link_count INTEGER,
  external_link_count INTEGER,
  broken_link_count INTEGER,
  has_canonical INTEGER DEFAULT 0,
  has_hreflang INTEGER DEFAULT 0,
  has_robots_txt INTEGER DEFAULT 0,
  has_sitemap INTEGER DEFAULT 0,
  has_schema INTEGER DEFAULT 0,
  is_mobile_friendly INTEGER DEFAULT 0,
  is_https INTEGER DEFAULT 0,
  issues_json TEXT,  -- JSON array of detected issues
  ai_summary TEXT,   -- AI-generated summary
  ai_recommendations TEXT,  -- AI-generated recommendations (JSON)
  scanned_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_scans_site ON scans(site_id);
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans(scanned_at);

-- Alerts (triggered when issues are detected)
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  scan_id TEXT REFERENCES scans(id),
  severity TEXT NOT NULL,  -- critical | warning | info
  category TEXT NOT NULL,  -- technical | content | performance | links
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  ai_explanation TEXT,
  resolved INTEGER DEFAULT 0,
  notified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_site ON alerts(site_id);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_notified ON alerts(notified);

-- Competitors (sites being monitored for comparison)
CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  url TEXT NOT NULL,
  name TEXT,
  last_crawled_at TEXT,
  page_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_competitors_user ON competitors(user_id);

-- GEO score column for sites
ALTER TABLE sites ADD COLUMN last_geo_score INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_sites_geo_score ON sites(last_geo_score);

-- GEO checks (Generative Engine Optimization audit results)
CREATE TABLE IF NOT EXISTS geo_checks (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  scan_id TEXT REFERENCES scans(id),
  check_type TEXT NOT NULL,  -- llms_txt | schema_product | schema_offer | schema_review | schema_faq | robots_ai_crawl | og_tags | twitter_cards | json_ld | content_depth
  status TEXT NOT NULL,       -- pass | warn | fail
  details_json TEXT,          -- JSON with specific details
  score INTEGER NOT NULL,     -- 0-100, higher is better
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_geo_checks_site ON geo_checks(site_id);
CREATE INDEX IF NOT EXISTS idx_geo_checks_scan ON geo_checks(scan_id);
CREATE INDEX IF NOT EXISTS idx_geo_checks_type ON geo_checks(check_type);

-- GEO score on scans table (for trend tracking)
ALTER TABLE scans ADD COLUMN geo_score INTEGER DEFAULT 0;
ALTER TABLE scans ADD COLUMN geo_band TEXT DEFAULT '';
ALTER TABLE scans ADD COLUMN geo_breakdown_json TEXT;  -- JSON: {"robots":18,"llms":14,...}
CREATE INDEX IF NOT EXISTS idx_scans_geo_score ON scans(geo_score);

-- Optimization history (tracks user-applied fixes)
CREATE TABLE IF NOT EXISTS optimizations (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  optimization_type TEXT NOT NULL,  -- schema | llms_txt | robots_txt | og_tags | content
  generated_code TEXT NOT NULL,
  applied INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_optimizations_site ON optimizations(site_id);

-- API usage tracking (for rate limiting free tier)
CREATE TABLE IF NOT EXISTS api_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  used_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_api_usage_user ON api_usage(user_id, used_at);

-- Tracked keywords (for keyword ranking monitoring)
CREATE TABLE IF NOT EXISTS tracked_keywords (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  keyword TEXT NOT NULL,
  search_volume INTEGER DEFAULT 0,
  difficulty INTEGER DEFAULT 0,
  current_rank INTEGER,
  previous_rank INTEGER,
  best_rank INTEGER,
  last_checked TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tracked_keywords_user ON tracked_keywords(user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_keywords_site ON tracked_keywords(site_id);

-- competitor_sites removed: duplicate of competitors table. Use competitors instead.
