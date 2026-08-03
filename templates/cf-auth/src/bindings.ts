/**
 * cf-auth 运行时绑定类型。
 *
 * Workers：wrangler bindings + secrets
 * Node：server.ts 把 process.env 注入 c.env
 *
 * 为什么把 DB 标可选：本地/测试主路径是 libSQL（DATABASE_URL），
 * D1 是 M4 候选，未实测前不强制存在。
 */
export type Bindings = {
  /** Better Auth 签名/加密密钥（≥32 字符） */
  BETTER_AUTH_SECRET?: string;
  /** 对外 base URL，如 https://auth.eforge.xyz 或 http://localhost:8788 */
  BETTER_AUTH_URL?: string;
  /** 兼容命名 */
  BASE_URL?: string;
  APP_ORIGIN?: string;
  /** 逗号分隔的 trustedOrigins */
  TRUSTED_ORIGINS?: string;
  /** libSQL：file:./data/local.db 或 libsql://... */
  DATABASE_URL?: string;
  TURSO_URL?: string;
  TURSO_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** 仅 Node 可信反代场景 */
  TRUST_PROXY_HEADERS?: string;
  /** Cloudflare D1（候选；M4 实测前业务不依赖） */
  DB?: D1Database;
  /** 可选 KV secondary storage */
  AUTH_KV?: KVNamespace;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    executionCtx?: ExecutionContext;
  };
};
