#!/usr/bin/env node
/**
 * 对 DATABASE_URL / TURSO_URL 指向的库执行 auth 表迁移。
 * 用法：node scripts/migrate.mjs
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// 内联 SQL 与 src/db/migrate.ts 保持同步（docs/029 信任域表）
// 注意：Worker 启动走 applyAuthMigrations（src/db/migrate.ts），本文件仅作手动/Node 初始化用
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL,
    image TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
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
  // 平台运维（docs/013 M7；对齐 src/db/migrate.ts）
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
  `CREATE UNIQUE INDEX IF NOT EXISTS auth_blocklist_type_value_uniq ON "auth_blocklist" (type, value)`,
  `CREATE INDEX IF NOT EXISTS auth_blocklist_type_value_idx ON "auth_blocklist" (type, value)`,
  `CREATE INDEX IF NOT EXISTS auth_blocklist_created_at_idx ON "auth_blocklist" (created_at)`,
  `CREATE TABLE IF NOT EXISTS "social_provider_config" (
    provider_id TEXT PRIMARY KEY NOT NULL,
    enabled INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    display_label TEXT,
    updated_at INTEGER NOT NULL,
    updated_by_email TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS social_provider_config_sort_idx ON "social_provider_config" (sort_order)`,
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
  `CREATE TABLE IF NOT EXISTS "email_log" (
    id TEXT PRIMARY KEY NOT NULL,
    to_addr TEXT NOT NULL,
    subject TEXT,
    status TEXT NOT NULL,
    provider TEXT,
    error TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS email_log_status_idx ON "email_log" (status)`,
];

const url = process.env.DATABASE_URL || process.env.TURSO_URL || "file:./data/local.db";
const authToken = process.env.TURSO_TOKEN;

if (url.startsWith("file:")) {
  const filePath = url.replace(/^file:/, "");
  const abs = filePath.startsWith("/") ? filePath : join(process.cwd(), filePath);
  mkdirSync(dirname(abs), { recursive: true });
}

const client = createClient({ url, authToken });
for (const sql of STATEMENTS) {
  await client.execute(sql);
}
await client.close();
console.log(`[migrate] ok → ${url}`);

// 避免未使用 import 警告
void pathToFileURL;
