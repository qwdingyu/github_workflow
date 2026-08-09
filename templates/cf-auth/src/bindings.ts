/**
 * cf-auth 运行时绑定类型。
 *
 * Workers：wrangler bindings + secrets
 * Node：server.ts 把 process.env 注入 c.env
 *
 * 社交登录密钥：按 provider 成对配置；未配齐的 provider 不会启用。
 * 完整列表见 src/lib/social-providers.ts 注册表。
 */
export type Bindings = {
  /** Better Auth 签名/加密密钥（≥32 字符） */
  BETTER_AUTH_SECRET?: string;
  /** 对外 base URL，如 https://auth.eforge.xyz 或 http://localhost:8788 */
  BETTER_AUTH_URL?: string;
  BASE_URL?: string;
  APP_ORIGIN?: string;
  /** 逗号分隔的 trustedOrigins */
  TRUSTED_ORIGINS?: string;
  /** libSQL：file:./data/local.db 或 libsql://... */
  DATABASE_URL?: string;
  TURSO_URL?: string;
  TURSO_TOKEN?: string;

  /** 可选：限制启用的社交登录，如 google,github；空=凡密钥齐全即启用 */
  ENABLED_SOCIAL_PROVIDERS?: string;
  /** true/false；默认 true（本地）；生产参与端可 false 仅社交 */
  EMAIL_PASSWORD_ENABLED?: string;

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  GITLAB_CLIENT_ID?: string;
  GITLAB_CLIENT_SECRET?: string;

  TRUST_PROXY_HEADERS?: string;

  /**
   * 平台管理员白名单（docs/013 §5.4）。
   * 逗号分隔；未配置且无 ADMIN_API_KEY 时管理 API 返回 503。
   */
  ADMIN_EMAILS?: string;
  ADMIN_USER_IDS?: string;
  /** 仅 CI/脚本；Header: X-Admin-Api-Key 或 Authorization: Bearer */
  ADMIN_API_KEY?: string;
  /**
   * Admin 写请求 CSRF 信任域（逗号分隔 origin；docs/013 §5.6）。
   * 默认仅同源（Admin SPA 由本站托管，运行时解析）；此变量用于显式扩展
   * 管理入口（内网管理域名、dev 代理、独立管理域）。
   * 与业务 TRUSTED_ORIGINS 解耦——业务 RP 域不会自动获得管理写权限。
   */
  ADMIN_TRUSTED_ORIGINS?: string;
  /**
   * 邮件加密密钥（AES-256-GCM，≥32 字节，hex 或 utf8）。
   * DB email_config.encrypted_secret 的加密/解密 key；不配则邮箱验证不可用。
   */
  EMAIL_ENCRYPTION_KEY?: string;

  /**
   * skip_consent 允许的 redirect 主机名（逗号分隔，小写）。
   * 未配置时默认 localhost,127.0.0.1,lucky.eforge.xyz,auth.eforge.xyz
   */
  FIRST_PARTY_REDIRECT_HOSTS?: string;

  /** Cloudflare D1（候选；M4 实测前业务不依赖） */
  DB?: D1Database;
  AUTH_KV?: KVNamespace;
  /** Workers 静态资源（Admin SPA，见 wrangler assets） */
  ASSETS?: Fetcher;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    executionCtx?: ExecutionContext;
    /** requirePlatformAdmin 注入 */
    adminActor?: import("./lib/admin-auth").AdminActor;
  };
};
