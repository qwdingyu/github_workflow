/**
 * Cloudflare Workers 入口。
 * 模块级缓存 AppResources，避免每次请求 migrate + 重建 betterAuth。
 */
import type { AppEnv, Bindings } from "./bindings";
import { createApp, type AppResources } from "./app";

let cached: { key: string; resources: AppResources; app: Awaited<ReturnType<typeof createApp>>["app"] } | null =
  null;

function cacheKey(env: Bindings): string {
  // 含社交开关与「是否配置了密钥」指纹，secret 轮换/增源后需重建 betterAuth
  const socialFingerprint = [
    env.ENABLED_SOCIAL_PROVIDERS || "",
    env.EMAIL_PASSWORD_ENABLED || "",
    env.GOOGLE_CLIENT_ID ? "g" : "",
    env.GITHUB_CLIENT_ID ? "h" : "",
    env.MICROSOFT_CLIENT_ID ? "m" : "",
    env.APPLE_CLIENT_ID ? "a" : "",
    env.DISCORD_CLIENT_ID ? "d" : "",
    env.GITLAB_CLIENT_ID ? "l" : "",
  ].join("");
  return [
    env.BETTER_AUTH_URL || env.APP_ORIGIN || "",
    env.DATABASE_URL || env.TURSO_URL || "d1-or-default",
    env.BETTER_AUTH_SECRET?.slice(0, 8) || "",
    socialFingerprint,
  ].join("|");
}

async function getApp(env: Bindings) {
  const key = cacheKey(env);
  if (cached && cached.key === key) return cached;

  // Workers 生产若仅绑 D1、无 DATABASE_URL：当前版本仍要求 libSQL URL。
  // M4 实测 D1 前，请配置 TURSO_URL/DATABASE_URL secret，或本地 wrangler dev 用 .dev.vars。
  const { app, resources } = await createApp({ env });
  cached = { key, resources, app };
  return cached;
}

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const { app } = await getApp(env);
    return app.fetch(request, env, ctx);
  },
  /**
   * 可选：在 Cloudflare 控制台为 Worker 绑定 Cron 后清理 rate_limit_log。
   * 未绑定时无影响；启动路径 createApp 也会偶发清理。
   */
  async scheduled(
    _controller: ScheduledController,
    env: Bindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const { resources } = await getApp(env);
    const { cleanExpiredRateLimits } = await import("./lib/rate-limit");
    await cleanExpiredRateLimits(resources.db, 3_600_000);
  },
} satisfies ExportedHandler<Bindings>;

export type { AppEnv };
