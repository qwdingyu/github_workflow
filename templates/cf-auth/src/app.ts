/**
 * cf-auth 共享 Hono 应用入口（Workers 与 Node 共用同一 app.fetch）。
 *
 * ── 部署模式 ──
 * ① Cloudflare Workers：src/index.ts → createApp() → export default app
 * ② Node/VPS：src/server.ts → createApp() → serve({ fetch: app.fetch })
 * 两者共用一个 app 对象，差异仅在 env 来源（Workers = c.env / Node = process.env）。
 *
 * ── createApp 生命周期 ──
 * ① resolveAuthConfig → 解析 env 为 AuthRuntimeConfig
 * ② createDbFromUrl → 建连 Turso/Local SQLite
 * ③ applyAuthMigrations → 幂等建表（CREATE TABLE IF NOT EXISTS）
 * ④ createEmailSender → 邮件发送器（可选，需 EMAIL_ENCRYPTION_KEY）
 * ⑤ createAuth → Better Auth 实例（双层 OAuth + blocklist 钩子 + emailOTP）
 * ⑥ 注册中间件：CORS → 限流 → Admin → Pages → Social Sign-in 门禁
 *
 * ── 资源缓存 ──
 * Workers isolate 在多个请求间复用；createApp 只在冷启动时执行一次，
 * 后续请求复用缓存的 auth/db 实例（通过 options.resources 注入）。
 * Node/VPS 常驻进程天然单例，不重复 createAuth。
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Client } from "@libsql/client";
import { sql } from "drizzle-orm";
import type { AppEnv, Bindings } from "./bindings";
import type { AuthDb } from "./db/client";
import { applyAuthMigrations, validateSchema } from "./db/migrate";
import { createAuth, type AuthInstance } from "./lib/auth";
import { createEmailSender, setEmailLogger } from "./lib/email";
import { emailLog, user } from "./db/schema";
import { resolveAuthConfig } from "./lib/env";
import {
  findEmailPolicyViolation,
  loadEmailPolicy,
} from "./lib/email-policy";
import { hasEnabledEmailConfigs } from "./lib/email-config";
import { getEnv, parseTrustedOrigins, DEFAULT_LOCAL_ORIGINS } from "./lib/platform";
import { resolveTrustedOrigins } from "./lib/trusted-origin";
import { pagesRoute } from "./routes/pages";
import { createAdminRoutes } from "./routes/admin";
import { createEmailSendRoute } from "./routes/email-send";
import {
  checkDbRateLimit,
  cleanExpiredRateLimits,
  RATE_LIMITS,
} from "./lib/rate-limit";
import { clientIp } from "./lib/http";
import {
  adminPolicyFromContext,
  blockOpenClientRegistration,
} from "./lib/admin-auth";
import {
  getEffectiveSocialMeta,
  isProviderEffective,
  listProviderStatus,
} from "./lib/social-provider-config";
import { loadUiPolicy } from "./lib/ui-policy";

export type AppResources = {
  client: Client;
  db: AuthDb;
  auth: AuthInstance;
  emailOtpSenderReady?: boolean;
};

export type CreateAppOptions = {
  /** 已迁移的 db + auth；测试注入用 */
  resources?: AppResources;
  /** 覆盖 Bindings 解析（测试） */
  env?: Bindings;
  enableOAuthProvider?: boolean;
};

/**
 * 创建应用。若未注入 resources，则按 env 的 DATABASE_URL 建连并 migrate。
 *
 * 生产 Workers：入口（index.ts）应在模块顶层调用一次 createApp()，
 * 之后的请求复用缓存的 exports.app——避免每请求 createAuth() 的开销。
 * 测试：createTestApp() 每次都注入临时 DB（内存 SQLite file），
 * 用完 cleanupTestDbs() 删除临时文件。
 */
export async function createApp(options: CreateAppOptions = {}): Promise<{
  app: Hono<AppEnv>;
  resources: AppResources;
}> {
  const env = options.env ?? ({} as Bindings);
  let resources = options.resources;

  if (!resources) {
    const { createDbFromUrl } = await import("./db/client");
    const config = resolveAuthConfig(env);
    const { client, db } = createDbFromUrl({
      url: config.databaseUrl,
      authToken: config.databaseAuthToken,
    });
    await applyAuthMigrations(client);
    // 启动时 schema 健康检查（不阻塞启动，缺列仅告警）
    validateSchema(client).catch(() => {});
    // 启动时清理过期限流记录（避免 rate_limit_log 无限增长）
    try { await cleanExpiredRateLimits(db, 3_600_000); } catch { /* ignore */ }

    /**
     * ④ 邮件发送器初始化。
     *
     * createEmailSender 首先检查 EMAIL_ENCRYPTION_KEY 是否配置：
     * - 已配置 → 返回 sendVerificationOTP 回调（BA emailOTP 插件使用）
     * - 未配置 → 返回 no-op 函数 + console.warn（不阻塞服务启动）
     *
     * setEmailLogger 注册日志钩子：每次邮件发送后写 email_log 表（三态：pending/sent/failed）。
     * 日志写入失败静默吞错，不影响注册/登录主流程。
     */
    const sendEmail = await createEmailSender(db, env as Record<string, string | undefined>);
    setEmailLogger(async (entry) => {
      try {
        await db.insert(emailLog).values({
          id: entry.id,
          clientId: entry.clientId ?? null,
          toAddr: entry.to,
          subject: entry.subject,
          status: entry.status,
          provider: entry.provider,
          error: entry.error ?? null,
          createdAt: new Date(),
        }).onConflictDoUpdate({
          target: emailLog.id,
          set: {
            clientId: entry.clientId ?? null,
            toAddr: entry.to,
            subject: entry.subject,
            status: entry.status,
            provider: entry.provider,
            error: entry.error ?? null,
          },
        });
      } catch {
        /* 日志写入失败不阻塞业务 */
      }
    });
    const auth = createAuth({
      config,
      db,
      enableOAuthProvider: options.enableOAuthProvider,
      sendVerificationOTP: sendEmail,
    });
    resources = { client, db, auth, emailOtpSenderReady: Boolean(sendEmail) };
  }

  const appResources = resources;
  const { auth } = appResources;
  const app = new Hono<AppEnv>();

  async function isSignupVerificationAvailable() {
    return Boolean(appResources.emailOtpSenderReady) && await hasEnabledEmailConfigs(appResources.db);
  }

  // 固定 trusted origins（create 时已解析）；cors 回调里 c.env 在 app.request 测试中可能为空
  // fallback 仅本地 dev（DEFAULT_LOCAL_ORIGINS）；生产显式配置 TRUSTED_ORIGINS
  const staticTrusted = parseTrustedOrigins(
    options.env?.TRUSTED_ORIGINS,
    DEFAULT_LOCAL_ORIGINS,
  );

  app.use("*", async (c, next) => {
    // app.request() 时 c.env 可能为 undefined，不能 Object.assign 到空值
    if (options.env) {
      const current = (c.env ?? {}) as Record<string, unknown>;
      c.env = { ...current, ...options.env } as typeof c.env;
    } else if (!c.env) {
      c.env = {} as typeof c.env;
    }
    await next();
  });

  app.use(
    "*",
    cors({
      // env 部署锚 ∪ DB 运营扩展（docs/029）；仅跨域（Origin ≠ baseURL）才读 DB，
      // 同源 POST（sign-in/authorize/Admin 写操作）也带 Origin，走快速路径零 DB 开销
      origin: async (origin, c) => {
        if (!origin) return staticTrusted[0] ?? "http://localhost:8788";
        const base = getEnv(c, "BETTER_AUTH_URL") || getEnv(c, "APP_ORIGIN") || "";
        if (base) {
          try {
            if (origin === new URL(base).origin) return origin;
          } catch {
            /* baseURL 非法时走 env+DB */
          }
        }
        const raw = getEnv(c, "TRUSTED_ORIGINS");
        const envList = raw ? parseTrustedOrigins(raw, staticTrusted) : staticTrusted;
        const list = await resolveTrustedOrigins(
          resources.db,
          "cors",
          envList,
        );
        return list.includes(origin) ? origin : list[0] ?? "";
      },
      credentials: true,
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-Admin-Api-Key",
      ],
      // Admin 需要 PATCH/PUT/DELETE；OAuth 以 GET/POST 为主
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/api/health", async (c) => {
    let dbOk = false;
    let dbError: string | null = null;
    try {
      const rs = await resources.client.execute("SELECT 1 AS ok");
      dbOk = Number(rs.rows[0]?.ok) === 1;
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
    const envBag = (c.env ?? options.env ?? {}) as Bindings;
    const cfg = resolveAuthConfig(envBag);
    const adminPolicy = adminPolicyFromContext(c);
    // 与 auth-meta 一致：运营 effective 集合（非 createAuth 注入全集）
    const socialStatus = await listProviderStatus(
      resources.db,
      envBag as Record<string, string | undefined>,
    );
    const effectiveSocial = socialStatus.filter((p) => p.effective);
    return c.json({
      ok: true,
      service: "cf-auth",
      db: dbOk,
      dbError,
      baseURL: cfg.baseURL,
      // 不泄露 client secret；只暴露登录页有效的上游 IdP id
      socialProviders: effectiveSocial.map((p) => p.id),
      emailPassword: cfg.emailAndPasswordEnabled,
      /** 是否已配置平台管理员（不暴露具体邮箱/Key） */
      adminConfigured: adminPolicy.configured,
      role: {
        upstreamSocialIdp: "users sign in to cf-auth via Google/GitHub/…",
        oauthProvider: "RPs (lottery, …) use authorization code + PKCE against cf-auth",
      },
    });
  });

  /**
   * 登录页动态按钮：effective 集合（密钥 ∩ env allowlist ∩ DB 运营启用）。
   * 展示名可被 Admin 覆盖；永不返回 secret。
   */
  app.get("/api/auth-meta/social", async (c) => {
    const envBag = (c.env ?? options.env ?? {}) as Bindings;
    const cfg = resolveAuthConfig(envBag);
    const providers = await getEffectiveSocialMeta(
      resources.db,
      envBag as Record<string, string | undefined>,
    );
    const emailPolicy = await loadEmailPolicy(resources.db);
    const emailVerificationAvailable = emailPolicy.signupVerificationRequired
      ? await isSignupVerificationAvailable()
      : Boolean(resources.emailOtpSenderReady);
    return c.json({
      providers,
      emailPassword: cfg.emailAndPasswordEnabled,
      emailPolicy: {
        signupVerificationRequired: emailPolicy.signupVerificationRequired,
        signupVerificationAvailable: emailVerificationAvailable,
      },
      baseURL: cfg.baseURL,
    });
  });

  app.get("/api/auth-meta/ui", async (c) => {
    const uiPolicy = await loadUiPolicy(resources.db);
    return c.json({
      ui: {
        showNonAdminLogout: uiPolicy.showNonAdminLogout,
      },
    });
  });

  /**
   * P0-2 限流：在进入 Better Auth 前对敏感路径做 DB 级限流。
   * 对齐 lottery checkDbRateLimit；超限 429，不进入协议层。
   */
  app.use("/api/auth/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const ip = clientIp(c);
    let bucket: { limit: number; windowMs: number } | null = null;
    let keyPrefix = "";

    if (path.includes("/sign-up")) {
      bucket = RATE_LIMITS.signUp;
      keyPrefix = "signUp";
    } else if (path.includes("/sign-in")) {
      bucket = RATE_LIMITS.signIn;
      keyPrefix = "signIn";
    } else if (path.includes("/oauth2/authorize")) {
      bucket = RATE_LIMITS.authorize;
      keyPrefix = "authorize";
    } else if (path.includes("/oauth2/token")) {
      bucket = RATE_LIMITS.token;
      keyPrefix = "token";
    }

    if (bucket) {
      const allowed = await checkDbRateLimit(
        resources.db,
        `${keyPrefix}:${ip}`,
        bucket.limit,
        bucket.windowMs,
      );
      if (!allowed) {
        return c.json({ ok: false, message: "请求过于频繁", error: "rate_limited" }, 429);
      }
    }
    await next();
  });

  /**
   * 邮箱注册/登录策略前置校验。
   * 不依赖 Better Auth 内部 session hook 是否触发，避免注册机先建出可用账号。
   */
  app.use("/api/auth/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const isEmailSignUp =
      c.req.method === "POST" &&
      (path === "/api/auth/sign-up/email" || path.endsWith("/sign-up/email"));
    const isEmailSignIn =
      c.req.method === "POST" &&
      (path === "/api/auth/sign-in/email" || path.endsWith("/sign-in/email"));
    const isSignupOtpSend =
      c.req.method === "POST" &&
      (path === "/api/auth/email-otp/send-verification-otp" ||
        path.endsWith("/email-otp/send-verification-otp"));

    if (!isEmailSignUp && !isEmailSignIn && !isSignupOtpSend) {
      await next();
      return;
    }

    let email = "";
    let otpType = "";
    try {
      const body = (await c.req.raw.clone().json()) as { email?: unknown; type?: unknown };
      email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      otpType = typeof body.type === "string" ? body.type.trim().toLowerCase() : "";
    } catch {
      await next();
      return;
    }
    if (!email) {
      await next();
      return;
    }

    const policy = await loadEmailPolicy(resources.db);

    if (isEmailSignUp) {
      const violation = findEmailPolicyViolation(policy, email);
      if (violation) {
        return c.json(
          { ok: false, message: violation.message, error: violation.message, code: violation.code },
          403,
        );
      }
      const [existingUser] = await resources.db
        .select({ id: user.id, emailVerified: user.emailVerified })
        .from(user)
        .where(sql`lower(${user.email}) = ${email}`)
        .limit(1);
      if (existingUser) {
        const pendingVerification =
          policy.signupVerificationRequired && !existingUser.emailVerified;
        return c.json(
          {
            ok: false,
            message: pendingVerification
              ? "该邮箱已注册但尚未验证，请输入验证码或重新发送验证码"
              : "该邮箱已注册，请直接登录",
            error: pendingVerification
              ? "email_signup_pending_verification"
              : "email_already_registered",
            code: pendingVerification
              ? "EMAIL_SIGNUP_PENDING_VERIFICATION"
              : "EMAIL_ALREADY_REGISTERED",
          },
          409,
        );
      }
      if (policy.signupVerificationRequired && !await isSignupVerificationAvailable()) {
        return c.json(
          {
            ok: false,
            message: "邮箱验证码服务未配置，请先在邮件配置中启用通道",
            error: "email_otp_unavailable",
            code: "EMAIL_OTP_UNAVAILABLE",
          },
          503,
        );
      }
    }

    const isSignupVerificationOtp =
      !otpType || otpType === "sign-up" || otpType === "email-verification";

    if (isSignupOtpSend && isSignupVerificationOtp) {
      const violation = findEmailPolicyViolation(policy, email);
      if (violation) {
        return c.json(
          { ok: false, message: violation.message, error: violation.message, code: violation.code },
          403,
        );
      }
      const [existingUser] = await resources.db
        .select({ id: user.id, emailVerified: user.emailVerified })
        .from(user)
        .where(sql`lower(${user.email}) = ${email}`)
        .limit(1);
      if (!existingUser) {
        return c.json(
          {
            ok: false,
            message: "请先提交注册信息，再获取邮箱验证码",
            error: "email_signup_not_found",
            code: "EMAIL_SIGNUP_NOT_FOUND",
          },
          404,
        );
      }
      if (existingUser.emailVerified || !policy.signupVerificationRequired) {
        return c.json(
          {
            ok: false,
            message: "该邮箱已注册，请直接登录",
            error: "email_already_registered",
            code: "EMAIL_ALREADY_REGISTERED",
          },
          409,
        );
      }
      if (!await isSignupVerificationAvailable()) {
        return c.json(
          {
            ok: false,
            message: "邮箱验证码服务未配置，请先在邮件配置中启用通道",
            error: "email_otp_unavailable",
            code: "EMAIL_OTP_UNAVAILABLE",
          },
          503,
        );
      }
    }

    if (isEmailSignIn && policy.signupVerificationRequired) {
      const [u] = await resources.db
        .select({ emailVerified: user.emailVerified })
        .from(user)
        .where(sql`lower(${user.email}) = ${email}`)
        .limit(1);
      if (u && !u.emailVerified) {
        return c.json(
          {
            ok: false,
            message: "请先验证邮箱（检查收件箱中的验证码）",
            error: "email_not_verified",
            code: "EMAIL_NOT_VERIFIED",
          },
          403,
        );
      }
    }

    await next();
  });

  /**
   * 社交运营门禁（docs/026 Phase A）：
   * createAuth 仍注入全部「密钥齐全」的 provider（避免 Worker 缓存与 DB 开关脱节），
   * 在 handler 前拦截发起流与 callback：非 effective → 403。
   * 覆盖：sign-in/social、link-social（已登录绑源）、callback/{id}。
   */
  app.use("/api/auth/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const envBag = (c.env ?? options.env ?? {}) as Record<
      string,
      string | undefined
    >;

    const socialDisabledResponse = () =>
      c.json(
        {
          ok: false,
          message: "该社交登录已停用或未配置",
          error: "social_provider_disabled",
        },
        403,
      );

    // POST 发起流：body.provider（JSON；BA 亦仅允许 application/json）
    const isSocialStart =
      c.req.method === "POST" &&
      (path === "/api/auth/sign-in/social" ||
        path.endsWith("/sign-in/social") ||
        path === "/api/auth/link-social" ||
        path.endsWith("/link-social"));

    if (isSocialStart) {
      let providerId = "";
      try {
        const cloned = c.req.raw.clone();
        const body = (await cloned.json()) as { provider?: unknown };
        providerId =
          typeof body?.provider === "string" ? body.provider.trim() : "";
      } catch {
        /* 非法 JSON 交由 BA 处理 */
      }
      if (providerId) {
        const okEff = await isProviderEffective(
          resources.db,
          envBag,
          providerId,
        );
        if (!okEff) return socialDisabledResponse();
      }
    }

    // GET|POST /api/auth/callback/{providerId}
    const cbMatch = path.match(/\/api\/auth\/callback\/([^/]+)\/?$/);
    if (cbMatch?.[1]) {
      const providerId = decodeURIComponent(cbMatch[1]).trim();
      const okEff = await isProviderEffective(
        resources.db,
        envBag,
        providerId,
      );
      if (!okEff) return socialDisabledResponse();
    }

    await next();
  });

  // P0-1：收口插件默认 create-client（任意登录用户 → 仅平台管理员）
  app.use("/api/auth/*", blockOpenClientRegistration(auth));

  // Better Auth 标准 handler（lottery 056 已验证）
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // 平台 Admin API（docs/013 M7a）
  app.route("/api/admin", createAdminRoutes(resources));

  // 邮件网关（docs/093）：POST /api/email/send（OAuth client 认证）
  app.route("/api/email", createEmailSendRoute(resources));

  /**
   * OAuth Provider 在 basePath=/api/auth 时要求：
   *   /.well-known/oauth-authorization-server/api/auth
   * （启动 WARN 已提示）。用官方 metadata helper 挂到正确路径。
   */
  try {
    const { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } =
      await import("@better-auth/oauth-provider");
    const asHandler = oauthProviderAuthServerMetadata(auth);
    const oidcHandler = oauthProviderOpenIdConfigMetadata(auth);
    app.get("/.well-known/oauth-authorization-server/api/auth", (c) => asHandler(c.req.raw));
    app.get("/.well-known/oauth-authorization-server", (c) => asHandler(c.req.raw));
    app.get("/.well-known/openid-configuration", (c) => oidcHandler(c.req.raw));
    app.get("/api/auth/.well-known/openid-configuration", (c) => oidcHandler(c.req.raw));
  } catch (e) {
    console.warn("[cf-auth] well-known metadata helpers unavailable:", e);
  }

  app.route("/", pagesRoute);

  /**
   * Admin SPA：Workers 用 ASSETS binding（对齐 lottery）。
   * 只托管 /admin 与构建产物 /assets/*，避免抢走 /、/sign-in、/consent 协议页。
   * Node 由 server.ts 限定路径 serveStatic。
   */
  app.get("*", async (c, next) => {
    const assets = c.env.ASSETS;
    if (!assets) return next();
    const path = new URL(c.req.url).pathname;
    const isAdminSpa =
      path === "/admin" ||
      path.startsWith("/admin/") ||
      path.startsWith("/assets/") ||
      path === "/index.html" ||
      path === "/favicon.ico";
    if (!isAdminSpa) return next();

    try {
      // /admin 与子路由：SPA fallback 到 index.html
      if (path === "/admin" || (path.startsWith("/admin/") && !path.includes("."))) {
        return assets.fetch(new Request(new URL("/index.html", c.req.url)));
      }
      const asset = await assets.fetch(c.req.raw);
      if (asset.status === 404 && path.startsWith("/admin")) {
        return assets.fetch(new Request(new URL("/index.html", c.req.url)));
      }
      return asset;
    } catch {
      return assets.fetch(new Request(new URL("/index.html", c.req.url)));
    }
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return { app, resources };
}
