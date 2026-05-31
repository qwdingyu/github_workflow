import { Hono } from "hono";
import { initDatabase } from "./db/database";
import type { AppEnv } from "./bindings";
import { fail } from "./lib/http";
import { requireAdmin } from "./lib/security";
import { cleanupExpiredOrders } from "./services/cleanup-service";
import { healthRoute } from "./routes/health";
import { productRoute } from "./routes/products";
import { orderRoute } from "./routes/orders";
import { payRoute } from "./routes/pay";
import { adminRoute } from "./routes/admin";
import { systemConfigRoute } from "./routes/system-config";
import { redeemRoute } from "./routes/redeem";
import { voucherRoute } from "./routes/vouchers";

const api = new Hono<AppEnv>();

// 数据库初始化中间件：创建 libsql client + Drizzle ORM 实例，存入 Hono Context
// - DB 可用时：c.set("db", orm)，所有路由正常使用
// - DB 不可用时：health 路由 c.set("db", undefined) 自行降级；其他路由直接 503
// - 同时注入 executionCtx，供服务层使用 ctx.waitUntil() 异步发邮件（节省 CPU）
api.use("*", async (c, next) => {
  const isHealth = c.req.path === "/health";

  try {
    const { db } = initDatabase({ TURSO_URL: c.env.TURSO_URL, TURSO_TOKEN: c.env.TURSO_TOKEN });
    c.set("db", db);
    c.set("executionCtx", c.executionCtx);
    await next();
  } catch (err) {
    console.error("[db-init]", err);
    if (isHealth) { c.set("db", undefined); c.set("executionCtx", c.executionCtx); await next(); return; }
    return fail(c, "服务暂时不可用", 503);
  }
});

// 全局中间件：请求体大小限制（100KB）
api.use(async (c, next) => {
  const contentLength = parseInt(c.req.header("content-length") || "0");
  if (contentLength > 1024 * 100) {
    return fail(c, "请求体过大（最大 100KB）", 413);
  }
  await next();
});

api.route("/", healthRoute);
api.route("/", productRoute);
api.route("/", orderRoute);
api.route("/", systemConfigRoute);
api.route("/", payRoute);
api.route("/", redeemRoute);
api.route("/", voucherRoute);
api.route("/admin", new Hono<AppEnv>().use("*", requireAdmin).route("/", adminRoute));

api.notFound((c) => fail(c, "API not found", 404));

api.onError((error, c) => {
  console.error("[onError]", error?.constructor?.name, error?.message, error?.stack);
  return fail(c, "服务暂时不可用", 500, { error: error?.message });
});

export default {
  async fetch(request: Request, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    try {
      const url = new URL(request.url);
      // 全局安全响应头
      const responseHeaders = new Headers({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      // 用户端页面允许 Element Plus CDN 资源 + Telegram WebApp SDK
      // admin 页面用 Vue UMD 构建（vue.global.prod.js），内部 new Function() 编译模板，需要 unsafe-eval
      const isAdmin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
      const csp = [
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline' https://unpkg.com",
        `script-src 'self' 'unsafe-inline'${isAdmin ? " 'unsafe-eval'" : ""} https://unpkg.com https://static.cloudflareinsights.com https://challenges.cloudflare.com https://telegram.org`,
        "img-src 'self' data: https:",
        "connect-src 'self' https://unpkg.com https://challenges.cloudflare.com",
        "frame-src 'self' https://challenges.cloudflare.com",
        "object-src 'none'",
        "base-uri 'self'",
      ].join("; ");
      responseHeaders.set("Content-Security-Policy", csp);

      // 给静态资源响应附加安全头（API 响应由 Hono 内置处理）
      async function withHeaders(response: Response, addCacheControl = false) {
        const headers = new Headers(response.headers);
        for (const [key, value] of responseHeaders) {
          headers.set(key, value);
        }
        // Vite 构建的 hash 文件设置长缓存（1 年），节省 Workers 请求配额
        if (addCacheControl && url.pathname.startsWith("/_app/assets/")) {
          headers.set("Cache-Control", "public, max-age=31536000, immutable");
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }

      // API 统一挂在 /api 下，进入 Hono 前去掉 /api 前缀，避免页面路径和接口路径混在一起。
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        url.pathname = url.pathname.replace(/^\/api/, "") || "/";
        return await api.fetch(new Request(url, request), env, ctx);
      }
      // 管理后台
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        url.pathname = "/admin.html";
        return withHeaders(await env.ASSETS.fetch(new Request(url, request)));
      }

      // ── Vue3 新前端（渐进式迁移，旧 index.html 托底）──
      // Vue3 产物在 /_app/ 下，如果存在则优先使用，否则回退到旧 Vanilla 页面。
      const isPageRoute =
        url.pathname === "/" ||
        url.pathname === "/shop" ||
        url.pathname === "/redeem" ||
        url.pathname === "/lookup" ||
        url.pathname === "/order";

      if (isPageRoute) {
        // 尝试返回 Vue3 入口
        const vueEntry = "/_app/index.html";
        const vueRes = await env.ASSETS.fetch(new Request(new URL(vueEntry, request.url), request));
        if (vueRes.ok) {
          return withHeaders(vueRes);
        }
        // Vue3 未部署，托底到旧页面
        url.pathname = "/index.html";
        return withHeaders(await env.ASSETS.fetch(new Request(url, request)));
      }

      // Vue3 静态资源（/_app/assets/*）— 设置长缓存，节省 Workers 请求配额
      if (url.pathname.startsWith("/_app/")) {
        return withHeaders(await env.ASSETS.fetch(request), true);
      }

      // 根路径兜底
      if (url.pathname === "/") {
        url.pathname = "/index.html";
        return withHeaders(await env.ASSETS.fetch(new Request(url, request)));
      }

      // 其他路径交给 Static Assets（旧 styles.css、app.js 等）
      return withHeaders(await env.ASSETS.fetch(request));
    } catch (err) {
      console.error("[fetch]", err);
      return new Response(JSON.stringify({ ok: false, error: "服务暂时不可用" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  },

  /**
   * Cron Trigger 未启用 — Free 版支持 Cron 但仅 10ms CPU 时间，
   * cleanup 逻辑含多条 SQL + 邮件发送，CPU 不足。
   * 替代方案：GitHub Actions 定时调用 /admin/cleanup 接口。
   * 见 .github/workflows/cleanup-schedule.yml
   */
};