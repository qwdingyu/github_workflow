/**
 * Better Auth 工厂：身份服务 + OAuth 2.1 Provider。
 *
 * ── 双层 OAuth 架构（不可混淆）──
 * ① Inbound：用户通过 Google/GitHub 等社交 IdP 登录本域（上游社交登录）
 * ② Outbound：业务 RP（cf-lottery/cf-shop）用授权码 + PKCE 接入本服务（OAuth Provider）
 *    业务方拿到自己的 session/JWT，不共享 cf-auth cookie。
 *
 * ── 设计原则 ──
 * - 使用官方 better-auth + drizzleAdapter + @better-auth/oauth-provider，不自研 OAuth 协议
 * - Auth session 仅存在于本域（auth.eforge.xyz）；业务 RP 必须走授权码 + PKCE
 * - 上游社交 IdP（Google/GitHub/…）由 social-providers 注册表按 env 密钥动态启用
 * - 动态 client 注册默认关闭（allowDynamicClientRegistration=false），
 *   首批 RP client 由 Admin 页面或管理脚本写入
 * - databaseHooks.session.create：平台 blocklist 拒绝被封禁用户建 session
 *   （对齐 BA admin 插件 ban 钩子，但不引入完整 admin 插件与 role 字段）
 * - emailOTP 插件可选启用：仅在配置了邮件发送器（sendVerificationOTP 参数）时生效，
 *   未配置或不提供邮件通道时 BA 仍生成 OTP 但用户无法收到邮件通知
 */
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { twoFactor } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";
import type { AuthDb } from "../db/client";
import { authSchema, user } from "../db/schema";
import { BLOCKED_USER_MESSAGE, isBlocked } from "./blocklist";
import {
  findEmailPolicyViolation,
  loadEmailPolicy,
} from "./email-policy";
import type { AuthRuntimeConfig } from "./env";

export type CreateAuthOptions = {
  config: AuthRuntimeConfig;
  db: AuthDb;
  /** 是否挂载 OAuth Provider（测试可拆分，单元测试 disable 避免副作用） */
  enableOAuthProvider?: boolean;
  /**
   * 可选：启用邮箱 OTP 验证码插件。
   *
   * 由 app.ts 构造 createEmailSender(db) 后传入。
   * BA emailOTP 插件生成 6 位数字 OTP（5 分钟有效期），通过此回调发送邮件。
   * 未传入时 email-password 注册仍可用，但不做邮箱验证（emailVerified 字段恒为 false）。
   *
   * type 枚举：
   *   "email-verification" — 注册后验证邮箱
   *   "sign-in"            — 邮箱验证码登录
   *   "forget-password"    — 找回密码（暂未实现 UI）
   *   "change-email"       — 换绑邮箱（暂未实现 UI）
   */
  sendVerificationOTP?: (
    data: { email: string; otp: string; type: "email-verification" | "sign-in" | "forget-password" | "change-email" },
  ) => Promise<void>;
};

export function createAuth(options: CreateAuthOptions) {
  const { config, db } = options;
  const enableOAuthProvider = options.enableOAuthProvider !== false;

  const socialProviders =
    Object.keys(config.social.socialProviders).length > 0
      ? config.social.socialProviders
      : undefined;

  /**
   * 账号关联：同一邮箱在可信社交源之间可隐式关联到同一 user。
   * trustedProviders = 当前已启用的社交 id + email-password（若开启）。
   * 不把未配置的 provider 放进 trusted 列表，避免空配置被当成信任面。
   */
  const trustedProviders = [
    ...config.social.enabledIds,
    ...(config.emailAndPasswordEnabled ? (["email-password"] as const) : []),
  ];

  /**
   * 插件列表（按顺序注册）：
   *
   * ① jwt()            — OAuth Provider 依赖 JWT 签发/暴露 JWKS 端点（/.well-known/jwks.json）
   * ② oauthProvider()  — OAuth 2.1 授权服务器（authorize/token/userinfo 等端点）
   * ③ emailOTP()      — 邮箱 OTP 验证码（仅在 sendVerificationOTP 参数传入时注册）
   * ④ twoFactor()     — TOTP 两步验证（Admin 安全增强；可选启用，不影响普通用户）
   *    用户自行前往 /api/auth/two-factor/enable 开启；登录时 BA 自动校验 TOTP 码。
   */
  const plugins = [
    jwt(),
    ...(enableOAuthProvider
      ? [
          oauthProvider({
            loginPage: "/sign-in",
            consentPage: "/consent",
            allowDynamicClientRegistration: false,
            allowUnauthenticatedClientRegistration: false,
            grantTypes: ["authorization_code", "refresh_token"],
            silenceWarnings: { oauthAuthServerConfig: true },
          }),
        ]
      : []),
    /**
     * 邮箱验证码插件：email-password 开启时**强制**启用。
     * 若 sendVerificationOTP 未配置（EMAIL_ENCRYPTION_KEY 缺失）→ 日志告警，
     * 但不注册插件（用户可用社交登录，不可用邮箱注册——避免假邮箱注册无验证）。
     */
    ...(config.emailAndPasswordEnabled && options.sendVerificationOTP
      ? [
          emailOTP({
            sendVerificationOTP: options.sendVerificationOTP,
            overrideDefaultEmailVerification: true,
            disableSignUp: true,
          }),
        ]
      : []),
    twoFactor({ issuer: "cf-auth" }),
  ];

  return betterAuth({
    baseURL: config.baseURL,                 // 对外 issuer（https://auth.eforge.xyz），用于 JWKS / OIDC discovery
    secret: config.secret,                   // BETTER_AUTH_SECRET，≥32 字节；一旦上线勿改（改=所有 session 失效 + JWK 变更）
    trustedOrigins: config.trustedOrigins,   // CORS + CSRF 白名单（含 baseURL + 各 RP origin）
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"],
        trustedProxies: ["127.0.0.1", "::1"],
      },
    },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,                   // 仅 BA 核心表（user/session/account 等），运维表不在此
      camelCase: true,
    }),
    emailAndPassword: {
      enabled: config.emailAndPasswordEnabled,
      /** 注册成功后由页面根据系统配置决定走验证码验证或自动密码登录。 */
      disableSignUp: false,
      autoSignIn: false,
    },
    ...(config.emailAndPasswordEnabled && options.sendVerificationOTP
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
          },
        }
      : {}),
    socialProviders: socialProviders as never, // 由 resolveSocialProviders 按 env 密钥动态构建
    account: {
      accountLinking: {
        enabled: true,
        /**
         * trustedProviders：隐式关联的安全面。
         * 同一邮箱在 trustedProviders 范围内可自动关联到同一 user（免用户手动合并账号）。
         * 例：用 Google 登录后，再用 GitHub 同邮箱登录 → 自动关联，不需要手动 Link。
         * 不把未配置的 provider 放进列表 → 避免空配置被当作信任面扩大攻击向量。
         */
        trustedProviders,
        /** 禁止不同邮箱强行合并 → 降低账号接管风险 */
        allowDifferentEmails: false,
        /**
         * 本地邮箱未验证时，不依赖社交 IdP 的 email_verified 做隐式合并。
         * 防抢注：恶意用户先注册 attacker@x.com（未验证），再等受害者用 Google 同邮箱登录 → 
         * 若不设此标志，BA 会隐式合并两个账号，攻击者获得受害者 Google 身份。
         */
        requireLocalEmailVerified: true,
      },
    },
    /**
     * databaseHooks.session.create.before：建 session 前的最后一道防线。
     *
     * 每次登录/注册成功后触发，查平台黑名单（email / user_id / email_domain）。
     * 若命中 blocklist → 抛 APIError("FORBIDDEN", "账号不可用") → BA 拒绝建 session。
     * 与 better-auth admin 插件 ban 钩子同位置，但不引入完整 admin 插件（避免 role 字段侵入 user 表）。
     * VPS 上 db 是客户端直连；测试中 mock createTestApp 隔离。
     */
    databaseHooks: {
      session: {
        create: {
          async before(session) {
            const userId = session.userId;
            if (!userId) return;
            const [u] = await db
              .select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
              .from(user)
              .where(eq(user.id, userId))
              .limit(1);
            if (!u) return;
            // ── 邮箱策略（system_config 可配，Admin → 系统配置 → 邮箱策略）──
            const email = u.email?.toLowerCase() || "";
            const emailPolicy = await loadEmailPolicy(db);
            const violation = email ? findEmailPolicyViolation(emailPolicy, email) : null;
            if (violation) {
              throw APIError.from("FORBIDDEN", {
                message: violation.message,
                code: violation.code,
              });
            }
            // 邮箱未验证 → 拒绝建 session（由 system_config 开关控制）
            if (
              config.emailAndPasswordEnabled &&
              emailPolicy.signupVerificationRequired &&
              !u.emailVerified
            ) {
              throw APIError.from("FORBIDDEN", {
                message: "请先验证邮箱（检查收件箱中的验证码）",
                code: "EMAIL_NOT_VERIFIED",
              });
            }
            const blocked = await isBlocked(db, {
              userId,
              email: u?.email ?? null,
            });
            if (blocked) {
              // 与 better-auth admin 插件 ban 钩子相同抛错方式
              throw APIError.from("FORBIDDEN", {
                message: BLOCKED_USER_MESSAGE,
                code: "BLOCKED_USER",
              });
            }
          },
        },
      },
    },
    plugins,
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
