/**
 * 共享 Hono 应用：Workers 与 Node 共用同一 app.fetch。
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Client } from "@libsql/client";
import type { AppEnv, Bindings } from "./bindings";
import type { AuthDb } from "./db/client";
import { applyAuthMigrations } from "./db/migrate";
import { createAuth, type AuthInstance } from "./lib/auth";
import { resolveAuthConfig } from "./lib/env";
import { getEnv, parseTrustedOrigins } from "./lib/platform";
import { pagesRoute } from "./routes/pages";

export type AppResources = {
  client: Client;
  db: AuthDb;
  auth: AuthInstance;
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
 * 注意：生产 Workers 上每请求 migrate 成本高——入口应缓存 resources。
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
    const auth = createAuth({
      config,
      db,
      enableOAuthProvider: options.enableOAuthProvider,
    });
    resources = { client, db, auth };
  }

  const { auth } = resources;
  const app = new Hono<AppEnv>();

  // 固定 trusted origins（create 时已解析）；cors 回调里 c.env 在 app.request 测试中可能为空
  const staticTrusted = parseTrustedOrigins(
    options.env?.TRUSTED_ORIGINS,
    [
      "http://localhost:8788",
      "http://localhost:8787",
      "https://auth.eforge.xyz",
      "https://lucky.eforge.xyz",
    ],
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
      origin: (origin, c) => {
        const raw = getEnv(c, "TRUSTED_ORIGINS");
        const list = raw ? parseTrustedOrigins(raw, staticTrusted) : staticTrusted;
        if (!origin) return list[0] ?? "http://localhost:8788";
        return list.includes(origin) ? origin : list[0] ?? "";
      },
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "OPTIONS"],
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
    const baseURL = resolveAuthConfig((c.env ?? options.env ?? {}) as Bindings).baseURL;
    return c.json({
      ok: true,
      service: "cf-auth",
      db: dbOk,
      dbError,
      baseURL,
    });
  });

  // Better Auth 标准 handler（lottery 056 已验证）
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

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

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return { app, resources };
}
