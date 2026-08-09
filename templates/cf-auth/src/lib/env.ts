/**
 * 从 Bindings 解析 auth 运行配置。
 * 集中校验，避免 betterAuth 工厂散落默认值魔法。
 */
import type { Bindings } from "../bindings";
import { DEFAULT_LOCAL_ORIGINS, parseTrustedOrigins } from "./platform";
import {
  parseSocialAllowlist,
  resolveSocialProviders,
  type ResolvedSocialProviders,
  type SocialProviderId,
} from "./social-providers";

export type AuthRuntimeConfig = {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  databaseUrl: string;
  databaseAuthToken?: string;
  /** 已解析的上游社交登录（多 IdP） */
  social: ResolvedSocialProviders;
  /**
   * 是否启用邮箱密码。
   * 生产参与端可关，仅保留社交；本地调试默认开。
   */
  emailAndPasswordEnabled: boolean;
};

function envBag(env: Bindings): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  // Node 回退：测试/server 可能只传部分 Bindings（Workers 上 process 可能不存在或为空）
  try {
    const pe = typeof process !== "undefined" ? process.env : undefined;
    if (pe) {
      for (const [k, v] of Object.entries(pe)) {
        if (out[k] === undefined && typeof v === "string") out[k] = v;
      }
    }
  } catch {
    /* Workers 无 process 时忽略 */
  }
  return out;
}

/**
 * 解析配置。测试可传入完整 Bindings；社交可用 defaults.social 覆盖。
 */
export function resolveAuthConfig(
  env: Bindings,
  defaults?: Partial<AuthRuntimeConfig> & {
    /** 测试注入：强制某个 social 集合 */
    socialOverride?: ResolvedSocialProviders;
  },
): AuthRuntimeConfig {
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

  try {
    const origin = new URL(baseURL).origin;
    if (!trustedOrigins.includes(origin)) {
      trustedOrigins.push(origin);
    }
  } catch {
    /* baseURL 非法时由 better-auth 再报错 */
  }

  const bag = envBag(env);
  const social =
    defaults?.socialOverride ||
    defaults?.social ||
    resolveSocialProviders(bag, {
      allowlist: parseSocialAllowlist(env.ENABLED_SOCIAL_PROVIDERS ?? bag.ENABLED_SOCIAL_PROVIDERS),
    });

  const emailFlag = env.EMAIL_PASSWORD_ENABLED ?? bag.EMAIL_PASSWORD_ENABLED;
  const emailAndPasswordEnabled =
    defaults?.emailAndPasswordEnabled ??
    (emailFlag == null || emailFlag === ""
      ? true
      : emailFlag === "true" || emailFlag === "1");

  return {
    baseURL,
    secret,
    trustedOrigins,
    databaseUrl,
    databaseAuthToken,
    social,
    emailAndPasswordEnabled,
  };
}

/** 便于测试构造「仅某几个 social」 */
export function socialFixture(
  ids: Partial<Record<SocialProviderId, { clientId: string; clientSecret: string }>>,
): ResolvedSocialProviders {
  const socialProviders = { ...ids };
  const enabledIds = Object.keys(ids) as SocialProviderId[];
  const enabledMeta = enabledIds.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
  }));
  return { socialProviders, enabledIds, enabledMeta };
}
