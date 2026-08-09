/**
 * Better Auth + OAuth Provider 的 Drizzle schema。
 *
 * 核心四表对齐 lottery docs/056 已跑通结构（camelCase 列名 + drizzleAdapter camelCase: true）。
 * OAuth 表字段来自 @better-auth/oauth-provider@1.6.25 的 schema 类型定义，
 * 用 SQLite 可表达的方式存储（数组/JSON 用 TEXT，boolean 用 INTEGER）。
 *
 * 为什么不手写业务 users 表：auth 库只服务身份与 OAuth client，业务映射在各 RP。
 */
import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/** 邮件发送日志（cf-core 标准字段 + cf-auth 邮件网关 client_id 溯源列） */
const emailLog = sqliteTable(
  "email_log",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id"),
    clientId: text("client_id"),
    toAddr: text("to_addr").notNull(),
    subject: text("subject"),
    status: text("status").notNull(),
    provider: text("provider"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("email_log_status_idx").on(t.status),
    index("email_log_client_id_idx").on(t.clientId),
  ],
);

// ── Better Auth 核心 ──────────────────────────────────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  // better-auth twoFactor 插件必需字段（缺失会导致 422 Failed to create user）
  twoFactorEnabled: integer("twoFactorEnabled", { mode: "boolean" }).notNull().default(false),
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
    /** 邮件发送开关（docs/093 邮件网关，仅允许已开启的 client 调用 /api/email/send） */
    emailEnabled: integer("email_enabled", { mode: "boolean" }).notNull().default(false),
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

// ── 平台运维表（docs/013 M7；不进 Better Auth adapter，业务自管） ──

/**
 * 管理审计：谁对哪个 client/user/session 做了什么。
 * 只追加；secret 永不写入 meta。
 */
export const adminAuditLog = sqliteTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: text("meta"),
    ip: text("ip"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("admin_audit_log_created_at_idx").on(t.createdAt),
    index("admin_audit_log_action_idx").on(t.action),
  ],
);

/**
 * 限流日志：对齐 lottery rate_limit_log 原子 INSERT 模式。
 * created_at 用 ISO 字符串，便于与 lottery SQL 一致。
 */
export const rateLimitLog = sqliteTable(
  "rate_limit_log",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    action: text("action").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("rate_limit_log_key_created_idx").on(t.key, t.createdAt)],
);

/**
 * 平台登录黑名单（docs/020；不进 Better Auth adapter）。
 * type: email | user_id | email_domain；value 已规范化。
 */
export const authBlocklist = sqliteTable(
  "auth_blocklist",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    value: text("value").notNull(),
    reason: text("reason"),
    createdByUserId: text("created_by_user_id"),
    createdByEmail: text("created_by_email"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
  },
  (t) => [
    index("auth_blocklist_type_value_idx").on(t.type, t.value),
    index("auth_blocklist_created_at_idx").on(t.createdAt),
  ],
);

/**
 * 上游社交登录运营策略（docs/026 Phase A）。
 * 密钥仍在 env/Cloudflare secrets；本表只存启用/排序/展示名。
 * 不进 Better Auth adapter。
 */
export const socialProviderConfig = sqliteTable(
  "social_provider_config",
  {
    providerId: text("provider_id").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    displayLabel: text("display_label"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    updatedByEmail: text("updated_by_email"),
  },
  (t) => [index("social_provider_config_sort_idx").on(t.sortOrder)],
);

/**
 * 信任域运营扩展（docs/029；不进 Better Auth adapter）。
 * purpose: cors（业务 RP 跨域）/ admin（管理写请求 CSRF）。
 * env（TRUSTED_ORIGINS / ADMIN_TRUSTED_ORIGINS）是部署锚，永远生效；
 * 本表是运营态扩展，Admin 页面热增删，解析时 env ∪ DB(enabled) 合并。
 * origin 已规范化（scheme://host[:port]，小写，无路径/query/凭据）。
 */
export const trustedOrigin = sqliteTable(
  "trusted_origin",
  {
    id: text("id").primaryKey(),
    origin: text("origin").notNull(),
    purpose: text("purpose").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    createdByEmail: text("created_by_email"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("trusted_origin_purpose_origin_uniq")
      .on(t.purpose, t.origin),
    index("trusted_origin_enabled_idx").on(t.enabled),
  ],
);

/**
 * 邮件发送配置（docs/030；Resend / SMTP 多通道容错链）。
 * encrypted_secret = AES-256-GCM 加密（key 来自 EMAIL_ENCRYPTION_KEY env）。
 * 列表/详情永不回传明文；编辑时可换密码。priority 越小越优先。
 */
export const emailConfig = sqliteTable(
  "email_config",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(), // resend | smtp
    name: text("name"),
    priority: integer("priority").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    host: text("host"),                  // SMTP only
    port: integer("port"),               // SMTP only
    username: text("username"),          // SMTP user / Resend sender
    /** SMTP TLS 模式：ssl（465）| starttls（587/25）| none（内网） */
    tlsMode: text("tls_mode").notNull().default("starttls"),
    encryptedSecret: text("encrypted_secret").notNull(),
    createdByEmail: text("created_by_email"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("email_config_priority_idx").on(t.priority)],
);

/** 邮件发送日志 —— cf-core 标准 schema */
export { emailLog };

/** 系统配置（key-value，Admin 页面管理，避免频繁改 env） */
export const systemConfig = sqliteTable(
  "system_config",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    description: text("description"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    updatedBy: text("updated_by"),
  },
);

/** 供 drizzleAdapter 使用的 schema 对象（仅 BA 表） */
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
