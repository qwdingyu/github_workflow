/**
 * Better Auth + OAuth Provider 的 Drizzle schema。
 *
 * 核心四表对齐 lottery docs/056 已跑通结构（camelCase 列名 + drizzleAdapter camelCase: true）。
 * OAuth 表字段来自 @better-auth/oauth-provider@1.6.25 的 schema 类型定义，
 * 用 SQLite 可表达的方式存储（数组/JSON 用 TEXT，boolean 用 INTEGER）。
 *
 * 为什么不手写业务 users 表：auth 库只服务身份与 OAuth client，业务映射在各 RP。
 */
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// ── Better Auth 核心 ──────────────────────────────────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_userId_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("account_userId_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ── JWT 插件（oauth-provider 官方示例依赖 jwt()）常用表 ──────
// 字段名采用 Better Auth jwt 插件常见约定；migrate 与 smoke 会验证可写。

export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("publicKey").notNull(),
  privateKey: text("privateKey").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }),
});

// ── OAuth Provider 插件表 ────────────────────────────────────
// 数组字段以 JSON 字符串存储，由 adapter/插件读写。

export const oauthClient = sqliteTable(
  "oauthClient",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId").notNull().unique(),
    clientSecret: text("clientSecret"),
    disabled: integer("disabled", { mode: "boolean" }),
    skipConsent: integer("skipConsent", { mode: "boolean" }),
    enableEndSession: integer("enableEndSession", { mode: "boolean" }),
    subjectType: text("subjectType"),
    scopes: text("scopes"),
    userId: text("userId").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("createdAt", { mode: "timestamp" }),
    updatedAt: integer("updatedAt", { mode: "timestamp" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("softwareId"),
    softwareVersion: text("softwareVersion"),
    softwareStatement: text("softwareStatement"),
    redirectUris: text("redirectUris").notNull(),
    postLogoutRedirectUris: text("postLogoutRedirectUris"),
    tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
    grantTypes: text("grantTypes"),
    responseTypes: text("responseTypes"),
    public: integer("public", { mode: "boolean" }),
    type: text("type"),
    requirePKCE: integer("requirePKCE", { mode: "boolean" }),
    referenceId: text("referenceId"),
    metadata: text("metadata"),
  },
  (t) => [index("oauthClient_userId_idx").on(t.userId)],
);

export const oauthRefreshToken = sqliteTable(
  "oauthRefreshToken",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("clientId").notNull(),
    sessionId: text("sessionId"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    expiresAt: integer("expiresAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" }),
    revoked: integer("revoked", { mode: "timestamp" }),
    authTime: integer("authTime", { mode: "timestamp" }),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("oauthRefreshToken_clientId_idx").on(t.clientId),
    index("oauthRefreshToken_userId_idx").on(t.userId),
    index("oauthRefreshToken_sessionId_idx").on(t.sessionId),
  ],
);

export const oauthAccessToken = sqliteTable(
  "oauthAccessToken",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("clientId").notNull(),
    sessionId: text("sessionId"),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    refreshId: text("refreshId"),
    expiresAt: integer("expiresAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" }),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("oauthAccessToken_clientId_idx").on(t.clientId),
    index("oauthAccessToken_userId_idx").on(t.userId),
    index("oauthAccessToken_sessionId_idx").on(t.sessionId),
    index("oauthAccessToken_refreshId_idx").on(t.refreshId),
  ],
);

export const oauthConsent = sqliteTable(
  "oauthConsent",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId").notNull(),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    scopes: text("scopes").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }),
    updatedAt: integer("updatedAt", { mode: "timestamp" }),
  },
  (t) => [
    index("oauthConsent_clientId_idx").on(t.clientId),
    index("oauthConsent_userId_idx").on(t.userId),
  ],
);

/** 供 drizzleAdapter 使用的 schema 对象 */
export const authSchema = {
  user,
  session,
  account,
  verification,
  jwks,
  oauthClient,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
};

export type AuthSchema = typeof authSchema;
