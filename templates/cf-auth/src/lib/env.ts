/**
 * 从 Bindings 解析 auth 运行配置。
 * 集中校验，避免 betterAuth 工厂散落默认值魔法。
 */
import type { Bindings } from "../bindings";
import { parseTrustedOrigins } from "./platform";

export type AuthRuntimeConfig = {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  databaseUrl: string;
  databaseAuthToken?: string;
  google?: { clientId: string; clientSecret: string };
};

const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:8788",
  "http://localhost:8787",
  "https://auth.eforge.xyz",
  "https://lucky.eforge.xyz",
];

/**
 * 解析配置。测试可传入完整 Bindings，不读 process.env。
 */
export function resolveAuthConfig(env: Bindings, defaults?: Partial<AuthRuntimeConfig>): AuthRuntimeConfig {
  const baseURL =
    defaults?.baseURL ||
    env.BETTER_AUTH_URL ||
    env.BASE_URL ||
    env.APP_ORIGIN ||
    "http://localhost:8788";

  const secret =
    defaults?.secret ||
    env.BETTER_AUTH_SECRET ||
    // 仅本地/测试兜底；生产必须显式配置
    "local-dev-better-auth-secret-at-least-32-chars";

  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET 长度必须 ≥ 32");
  }

  const databaseUrl =
    defaults?.databaseUrl ||
    env.DATABASE_URL ||
    env.TURSO_URL ||
    "file:./data/local.db";

  const databaseAuthToken = defaults?.databaseAuthToken ?? env.TURSO_TOKEN;

  const trustedOrigins =
    defaults?.trustedOrigins ||
    parseTrustedOrigins(env.TRUSTED_ORIGINS, DEFAULT_LOCAL_ORIGINS);

  // 确保 baseURL origin 在信任列表中
  try {
    const origin = new URL(baseURL).origin;
    if (!trustedOrigins.includes(origin)) {
      trustedOrigins.push(origin);
    }
  } catch {
    /* baseURL 非法时由 better-auth 再报错 */
  }

  let google = defaults?.google;
  if (!google && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }

  return {
    baseURL,
    secret,
    trustedOrigins,
    databaseUrl,
    databaseAuthToken,
    google,
  };
}
