/**
 * 上游社交 IdP 注册表（Identity Providers that federate INTO cf-auth）。
 *
 * 架构分层（切勿混淆）：
 * 1) 上游 Social IdP：Google / GitHub / … → 用户在 auth 域登录
 * 2) 本服务 OAuth Provider：cf-auth 作为 IdP → lottery 等 RP 用授权码接入
 *
 * 设计原则：
 * - 只启用「环境变量双密钥齐全」的 provider，未配置的不出现在 socialProviders
 * - 密钥只来自 env/secrets，不写死、不进 git
 * - 回调路径统一由 Better Auth 生成：{baseURL}/api/auth/callback/{providerId}
 * - 账号合并策略在 createAuth 的 account.accountLinking 中统一配置
 *
 * 官方内置列表见 better-auth/social-providers；此处只收录「我们计划支持」的子集，
 * 避免一次打开几十个未运营的登录按钮。
 */

export type SocialProviderId =
  | "google"
  | "github"
  | "apple"
  | "microsoft"
  | "discord"
  | "gitlab";

export type SocialProviderDef = {
  /** Better Auth socialProviders 键名 / providerId */
  id: SocialProviderId;
  /** 登录页展示名 */
  label: string;
  /** 图标（emoji / 单字符），管理 UI 与 RP 前端展示用 */
  icon: string;
  /** Client ID 环境变量名 */
  clientIdEnv: string;
  /** Client Secret 环境变量名 */
  clientSecretEnv: string;
  /**
   * 生产环境建议的 Authorized redirect URI 后缀说明（文档用）。
   * 完整：`${BETTER_AUTH_URL}/api/auth/callback/${id}`
   */
  notes?: string;
};

/**
 * 有序注册表：登录页按钮顺序 = 数组顺序。
 * 扩展新 IdP：加一项 + 配 env，无需改 createAuth 分支逻辑。
 */
export const SOCIAL_PROVIDER_REGISTRY: readonly SocialProviderDef[] = [
  {
    id: "google",
    label: "Google",
    icon: "🇬",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    notes: "Google Cloud OAuth Web client；需 consent screen",
  },
  {
    id: "github",
    label: "GitHub",
    icon: "🐙",
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    notes: "GitHub OAuth App（非 GitHub App 也可）；Callback URL 必须精确匹配",
  },
  {
    id: "microsoft",
    label: "Microsoft",
    icon: "⊞",
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
    notes: "Entra ID 应用注册；多租户需额外 tenant 配置时再扩展",
  },
  {
    id: "apple",
    label: "Apple",
    icon: "🍎",
    clientIdEnv: "APPLE_CLIENT_ID",
    clientSecretEnv: "APPLE_CLIENT_SECRET",
    notes: "Apple 常需 JWT client secret 轮换，生产前单独验证",
  },
  {
    id: "discord",
    label: "Discord",
    icon: "💬",
    clientIdEnv: "DISCORD_CLIENT_ID",
    clientSecretEnv: "DISCORD_CLIENT_SECRET",
  },
  {
    id: "gitlab",
    label: "GitLab",
    icon: "🦊",
    clientIdEnv: "GITLAB_CLIENT_ID",
    clientSecretEnv: "GITLAB_CLIENT_SECRET",
    notes: "自建 GitLab 可能需要 issuer/baseURL 扩展，默认官方 gitlab.com",
  },
] as const;

export type SocialCredentials = {
  clientId: string;
  clientSecret: string;
};

export type ResolvedSocialProviders = {
  /** 传给 betterAuth({ socialProviders }) 的对象 */
  socialProviders: Partial<
    Record<SocialProviderId, SocialCredentials & Record<string, unknown>>
  >;
  /** 已启用的 id 列表（登录页 / health / trustedProviders） */
  enabledIds: SocialProviderId[];
  /** 登录页用元数据 */
  enabledMeta: Array<{ id: SocialProviderId; label: string }>;
};

/**
 * 从任意 env 字典解析已配置的社交登录。
 * 缺 clientId 或 clientSecret 任一则跳过该 provider（不半开）。
 */
export function resolveSocialProviders(
  env: Record<string, string | undefined>,
  options?: {
    /** 仅启用白名单（例如 ENABLED_SOCIAL_PROVIDERS=google,github） */
    allowlist?: string[] | null;
  },
): ResolvedSocialProviders {
  const allow = options?.allowlist
    ? new Set(options.allowlist.map((s) => s.trim().toLowerCase()).filter(Boolean))
    : null;

  const socialProviders: ResolvedSocialProviders["socialProviders"] = {};
  const enabledIds: SocialProviderId[] = [];
  const enabledMeta: ResolvedSocialProviders["enabledMeta"] = [];

  for (const def of SOCIAL_PROVIDER_REGISTRY) {
    if (allow && !allow.has(def.id)) continue;

    const clientId = env[def.clientIdEnv]?.trim();
    const clientSecret = env[def.clientSecretEnv]?.trim();
    if (!clientId || !clientSecret) continue;

    socialProviders[def.id] = { clientId, clientSecret };
    enabledIds.push(def.id);
    enabledMeta.push({ id: def.id, label: def.label });
  }

  return { socialProviders, enabledIds, enabledMeta };
}

/** 解析 ENABLED_SOCIAL_PROVIDERS=google,github；空/未设 = 不限制（凡配齐密钥即开） */
export function parseSocialAllowlist(raw: string | undefined): string[] | null {
  if (raw == null || !raw.trim()) return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function callbackPathFor(providerId: SocialProviderId): string {
  return `/api/auth/callback/${providerId}`;
}

export function callbackUrlFor(baseURL: string, providerId: SocialProviderId): string {
  return `${baseURL.replace(/\/$/, "")}${callbackPathFor(providerId)}`;
}
