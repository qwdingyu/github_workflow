/**
 * 应用 auth 所需表结构（幂等 CREATE IF NOT EXISTS）。
 *
 * ── 两段式迁移 ──
 * ① STATEMENTS：CREATE TABLE IF NOT EXISTS（新库建表，幂等安全）
 * ② ALTER_STATEMENTS：增量列变更（旧库升级，try-catch 容错）
 *
 * ── 维护约定 ──
 * 每次升级 better-auth / 新增插件后，检查 BA 的 Drizzle schema 变化：
 * 1. 新表 → 加到 STATEMENTS
 * 2. 新列 → 加到 ALTER_STATEMENTS（含 description 标注来源）
 * 3. 启动时 validateSchema() 检测遗漏并告警
 *
 * 正式演进可再引入 drizzle-kit；MVP 用明确 SQL，避免 generate 与插件字段漂移时无据可查。
 */
import type { Client } from "@libsql/client";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL,
    image TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    twoFactorEnabled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS "session" (
    id TEXT PRIMARY KEY NOT NULL,
    expiresAt INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS session_userId_idx ON "session" (userId)`,
  `CREATE TABLE IF NOT EXISTS "account" (
    id TEXT PRIMARY KEY NOT NULL,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS account_userId_idx ON "account" (userId)`,
  `CREATE TABLE IF NOT EXISTS "verification" (
    id TEXT PRIMARY KEY NOT NULL,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification" (identifier)`,
  `CREATE TABLE IF NOT EXISTS "jwks" (
    id TEXT PRIMARY KEY NOT NULL,
    publicKey TEXT NOT NULL,
    privateKey TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS "oauthClient" (
    id TEXT PRIMARY KEY NOT NULL,
    clientId TEXT NOT NULL UNIQUE,
    clientSecret TEXT,
    disabled INTEGER,
    skipConsent INTEGER,
    enableEndSession INTEGER,
    subjectType TEXT,
    scopes TEXT,
    userId TEXT,
    createdAt INTEGER,
    updatedAt INTEGER,
    name TEXT,
    uri TEXT,
    icon TEXT,
    contacts TEXT,
    tos TEXT,
    policy TEXT,
    softwareId TEXT,
    softwareVersion TEXT,
    softwareStatement TEXT,
    redirectUris TEXT NOT NULL,
    postLogoutRedirectUris TEXT,
    tokenEndpointAuthMethod TEXT,
    grantTypes TEXT,
    responseTypes TEXT,
    public INTEGER,
    type TEXT,
    requirePKCE INTEGER,
    referenceId TEXT,
    metadata TEXT,
    FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS oauthClient_userId_idx ON "oauthClient" (userId)`,
  `CREATE TABLE IF NOT EXISTS "oauthRefreshToken" (
    id TEXT PRIMARY KEY NOT NULL,
    token TEXT NOT NULL UNIQUE,
    clientId TEXT NOT NULL,
    sessionId TEXT,
    userId TEXT NOT NULL,
    referenceId TEXT,
    expiresAt INTEGER,
    createdAt INTEGER,
    revoked INTEGER,
    authTime INTEGER,
    scopes TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS oauthRefreshToken_clientId_idx ON "oauthRefreshToken" (clientId)`,
  `CREATE INDEX IF NOT EXISTS oauthRefreshToken_userId_idx ON "oauthRefreshToken" (userId)`,
  `CREATE INDEX IF NOT EXISTS oauthRefreshToken_sessionId_idx ON "oauthRefreshToken" (sessionId)`,
  `CREATE TABLE IF NOT EXISTS "oauthAccessToken" (
    id TEXT PRIMARY KEY NOT NULL,
    token TEXT NOT NULL UNIQUE,
    clientId TEXT NOT NULL,
    sessionId TEXT,
    userId TEXT,
    referenceId TEXT,
    refreshId TEXT,
    expiresAt INTEGER,
    createdAt INTEGER,
    scopes TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS oauthAccessToken_clientId_idx ON "oauthAccessToken" (clientId)`,
  `CREATE INDEX IF NOT EXISTS oauthAccessToken_userId_idx ON "oauthAccessToken" (userId)`,
  `CREATE INDEX IF NOT EXISTS oauthAccessToken_sessionId_idx ON "oauthAccessToken" (sessionId)`,
  `CREATE INDEX IF NOT EXISTS oauthAccessToken_refreshId_idx ON "oauthAccessToken" (refreshId)`,
  `CREATE TABLE IF NOT EXISTS "oauthConsent" (
    id TEXT PRIMARY KEY NOT NULL,
    clientId TEXT NOT NULL,
    userId TEXT,
    referenceId TEXT,
    scopes TEXT NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER,
    FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS oauthConsent_clientId_idx ON "oauthConsent" (clientId)`,
  `CREATE INDEX IF NOT EXISTS oauthConsent_userId_idx ON "oauthConsent" (userId)`,
  // 平台运维（docs/013 M7）
  `CREATE TABLE IF NOT EXISTS "admin_audit_log" (
    id TEXT PRIMARY KEY NOT NULL,
    actor_user_id TEXT,
    actor_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    meta TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON "admin_audit_log" (created_at)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON "admin_audit_log" (action)`,
  `CREATE TABLE IF NOT EXISTS "rate_limit_log" (
    id TEXT PRIMARY KEY NOT NULL,
    key TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS rate_limit_log_key_created_idx ON "rate_limit_log" (key, created_at)`,
  // 平台登录黑名单（docs/020 P0；不进 BA adapter）
  `CREATE TABLE IF NOT EXISTS "auth_blocklist" (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT,
    created_by_user_id TEXT,
    created_by_email TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS auth_blocklist_type_value_idx ON "auth_blocklist" (type, value)`,
  // 幂等写入靠应用层先查后写；唯一索引降低并发双插（已有库 IF NOT EXISTS 可补）
  `CREATE UNIQUE INDEX IF NOT EXISTS auth_blocklist_type_value_uniq ON "auth_blocklist" (type, value)`,
  `CREATE INDEX IF NOT EXISTS auth_blocklist_created_at_idx ON "auth_blocklist" (created_at)`,
  // 上游社交运营开关（docs/026 Phase A；无 secret 列）
  `CREATE TABLE IF NOT EXISTS "social_provider_config" (
    provider_id TEXT PRIMARY KEY NOT NULL,
    enabled INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    display_label TEXT,
    updated_at INTEGER NOT NULL,
    updated_by_email TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS social_provider_config_sort_idx ON "social_provider_config" (sort_order)`,
  // 信任域运营扩展（docs/029；env 部署锚 ∪ DB 运营扩展）
  `CREATE TABLE IF NOT EXISTS "trusted_origin" (
    id TEXT PRIMARY KEY NOT NULL,
    origin TEXT NOT NULL,
    purpose TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    created_by_email TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS trusted_origin_purpose_origin_uniq ON "trusted_origin" (purpose, origin)`,
  `CREATE INDEX IF NOT EXISTS trusted_origin_enabled_idx ON "trusted_origin" (enabled)`,
  // 邮件发送配置（docs/030；Resend/SMTP 多通道容错链）
  `CREATE TABLE IF NOT EXISTS "email_config" (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    name TEXT,
    priority INTEGER NOT NULL,
    enabled INTEGER NOT NULL,
    host TEXT,
    port INTEGER,
    username TEXT,
    tls_mode TEXT NOT NULL DEFAULT 'starttls',
    encrypted_secret TEXT NOT NULL,
    created_by_email TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS email_config_priority_idx ON "email_config" (priority)`,
  // 邮件发送日志（docs/030；三态）
  `CREATE TABLE IF NOT EXISTS "email_log" (
    id TEXT PRIMARY KEY NOT NULL,
    order_id TEXT,
    client_id TEXT,
    to_addr TEXT NOT NULL,
    subject TEXT,
    status TEXT NOT NULL,
    provider TEXT,
    error TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS email_log_status_idx ON "email_log" (status)`,
  `CREATE INDEX IF NOT EXISTS email_log_client_id_idx ON "email_log" (client_id)`,
];

// ── 增量变更（ALTER TABLE，幂等执行：列已存在时忽略错误）──

const ALTER_STATEMENTS: { sql: string; description: string }[] = [
  {
    sql: `ALTER TABLE "email_log" ADD COLUMN order_id TEXT`,
    description: "email_log.order_id cf-core standard optional business reference",
  },
  {
    sql: `ALTER TABLE "email_log" ADD COLUMN client_id TEXT`,
    description: "email_log.client_id cf-auth email gateway client identifier",
  },
  {
    sql: `ALTER TABLE oauthClient ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 0`,
    description: "docs/093 邮件网关：client 邮件发送开关",
  },
  {
    sql: `ALTER TABLE user ADD COLUMN twoFactorEnabled INTEGER NOT NULL DEFAULT 0`,
    description: "twoFactor 插件：TOTP 两步验证开关（BA 自动管理，旧库需手动加列）",
  },
  {
    sql: `ALTER TABLE email_log ADD COLUMN client_id TEXT`,
    description: "邮件日志关联 OAuth client（邮件网关调用方）",
  },
];

// ── 系统配置表（幂等 CREATE）──
const SYSTEM_CONFIG_SQL = `CREATE TABLE IF NOT EXISTS "system_config" (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
)`;

const SYSTEM_CONFIG_DEFAULTS = [
  // 邮件策略
  "INSERT OR IGNORE INTO system_config(key,value,description,updated_at) VALUES('email.block_gmail_plus_alias','true','禁止Gmail加号别名注册（如user+tag@gmail.com）',unixepoch())",
  "INSERT OR IGNORE INTO system_config(key,value,description,updated_at) VALUES('email.block_plus_alias','true','禁止所有邮箱+别名注册（如user+tag@anydomain.com）',unixepoch())",
  "INSERT OR IGNORE INTO system_config(key,value,description,updated_at) VALUES('email.signup_verification_required','false','邮箱密码注册后必须通过邮箱验证码验证，未验证账号不能登录',unixepoch())",
  "INSERT OR IGNORE INTO system_config(key,value,description,updated_at) VALUES('email.domain_restriction_enabled','false','启用邮箱域名白名单（仅允许白名单域名注册）',unixepoch())",
  "INSERT OR IGNORE INTO system_config(key,value,description,updated_at) VALUES('email.domain_whitelist','qq.com\ngmail.com','邮箱域名白名单（每行一个，启用domain_restriction时生效）',unixepoch())",
  "INSERT OR IGNORE INTO system_config(key,value,description,updated_at) VALUES('ui.show_non_admin_logout','false','普通用户登录后是否在首页显示退出按钮',unixepoch())",
];

export async function applyAuthMigrations(client: Client): Promise<void> {
  // libSQL 支持 batch；逐条 execute 兼容性更好
  // 先执行 CREATE（幂等），再执行 ALTER（需容错：列已存在时忽略）
  for (const sql of STATEMENTS) {
    await client.execute(sql);
  }
  for (const alter of ALTER_STATEMENTS) {
    try {
      await client.execute(alter.sql);
    } catch (err) {
      // 列已存在时 SQLite 抛 "duplicate column name"，幂等忽略
      if (!(err instanceof Error && /duplicate column/i.test(err.message))) throw err;
    }
  }
  // 系统配置表 + 默认值（幂等）
  await client.execute(SYSTEM_CONFIG_SQL);
  for (const sql of SYSTEM_CONFIG_DEFAULTS) {
    await client.execute(sql).catch(() => {});
  }
}

/**
 * 启动时 schema 健康检查：尝试 SELECT 所有已知列，缺失时告警。
 * 不阻塞启动（BA 本身会报更精确的错误），仅提前告警运维。
 */
export async function validateSchema(client: Client): Promise<string[]> {
  const checks: { table: string; column: string }[] = [
    { table: "user", column: "twoFactorEnabled" },
    { table: "oauthClient", column: "email_enabled" },
    { table: "email_log", column: "client_id" },
  ];
  const missing: string[] = [];
  for (const { table, column } of checks) {
    try {
      await client.execute(`SELECT "${column}" FROM "${table}" LIMIT 0`);
    } catch {
      missing.push(`${table}.${column}`);
    }
  }
  if (missing.length > 0) {
    console.warn(`[schema] 以下列缺失，请运行 ALTER TABLE 或重启服务以触发自动迁移: ${missing.join(", ")}`);
  }
  return missing;
}
