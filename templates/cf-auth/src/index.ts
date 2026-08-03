/**
 * Cloudflare Workers 入口。
 * 模块级缓存 AppResources，避免每次请求 migrate + 重建 betterAuth。
 */
import type { AppEnv, Bindings } from "./bindings";
import { createApp, type AppResources } from "./app";

let cached: { key: string; resources: AppResources; app: Awaited<ReturnType<typeof createApp>>["app"] } | null =
  null;

function cacheKey(env: Bindings): string {
  return [
    env.BETTER_AUTH_URL || env.APP_ORIGIN || "",
    env.DATABASE_URL || env.TURSO_URL || "d1-or-default",
    env.BETTER_AUTH_SECRET?.slice(0, 8) || "",
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
} satisfies ExportedHandler<Bindings>;

export type { AppEnv };
