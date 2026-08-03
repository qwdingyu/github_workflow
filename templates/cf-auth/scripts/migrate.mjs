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

// 动态 import TS 迁移逻辑需 tsx；此处内联 SQL 与 src/db/migrate.ts 保持同步
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
