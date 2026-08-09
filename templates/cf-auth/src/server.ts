/**
 * Node.js 入口：本地开发 / 云服务器（非 Cloudflare Workers）。
 *
 * 用法：
 *   npm run dev:local          # 开发
 *   npm start                  # 生产（systemd 同此）
 *
 * Cloudflare 继续用 src/index.ts + wrangler。
 * 双平台共享 createApp()；差异见 src/lib/platform.ts。
 *
 * Admin SPA：frontend vite 构建产物在 public/（见 vite outDir）。
 * 协议页 /、/sign-in、/consent 由 pagesRoute 提供，不得用 /* 静态抢走。
 */
import "dotenv/config";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";
import type { Bindings } from "./bindings";

const PORT = parseInt(process.env.PORT || "8788", 10);
/** 生产建议 127.0.0.1（仅 nginx 反代）；本地调试可用 0.0.0.0 */
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = join(process.cwd(), "public");

// file: SQLite 时确保 data 目录存在
const dbUrl = process.env.DATABASE_URL || process.env.TURSO_URL || "file:./data/local.db";
if (dbUrl.startsWith("file:")) {
  const filePath = dbUrl.replace(/^file:/, "");
  const abs = filePath.startsWith("/") ? filePath : join(process.cwd(), filePath);
  mkdirSync(dirname(abs), { recursive: true });
}

const env = { ...process.env } as Bindings;

const { app } = await createApp({ env });

// 把 process.env 注入每个请求的 c.env（与 createApp 启动解析互补）
app.use("*", async (c, next) => {
  const bag = (c.env ?? {}) as Record<string, unknown>;
  if (!c.env) c.env = bag as typeof c.env;
  for (const [k, v] of Object.entries(process.env)) {
    if (!(k in bag) && v !== undefined) bag[k] = v;
  }
  if (!c.get("executionCtx")) {
    c.set("executionCtx", undefined);
  }
  await next();
});

// Admin SPA：只挂 /admin* 与 /assets/*，勿用 /* 抢走协议首页 /sign-in
if (existsSync(PUBLIC_DIR)) {
  app.use("/assets/*", serveStatic({ root: "./public" }));
  app.get("/admin", async (c) => {
    const { readFile } = await import("node:fs/promises");
    return c.html(await readFile(join(PUBLIC_DIR, "index.html"), "utf8"));
  });
  app.get("/admin/*", async (c) => {
    const { readFile } = await import("node:fs/promises");
    const path = new URL(c.req.url).pathname;
    // 带扩展名的路径（若有）交给 404；SPA 子路由回 index.html
    if (path.includes(".") && !path.endsWith(".html")) {
      return c.notFound();
    }
    return c.html(await readFile(join(PUBLIC_DIR, "index.html"), "utf8"));
  });
} else {
  console.warn("[cf-auth] public/ 不存在：请先 npm run build:frontend，否则 /admin 不可用");
}

console.log(`[cf-auth] http://${HOST}:${PORT}`);
console.log(`[cf-auth] baseURL=${env.BETTER_AUTH_URL || env.APP_ORIGIN || `http://localhost:${PORT}`}`);
console.log(`[cf-auth] database=${dbUrl}`);
console.log(`[cf-auth] admin SPA=${existsSync(PUBLIC_DIR) ? "public/" : "未构建"}`);
console.log(`[cf-auth] TRUST_PROXY_HEADERS=${env.TRUST_PROXY_HEADERS || "false"}`);

serve({ fetch: app.fetch, port: PORT, hostname: HOST });
