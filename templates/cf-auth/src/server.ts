/**
 * Node.js 入口：本地开发 / 云服务器。
 * 用法：npm run dev:local
 */
import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import type { Bindings } from "./bindings";

const PORT = parseInt(process.env.PORT || "8788", 10);

// file: SQLite 时确保 data 目录存在
const dbUrl = process.env.DATABASE_URL || process.env.TURSO_URL || "file:./data/local.db";
if (dbUrl.startsWith("file:")) {
  const filePath = dbUrl.replace(/^file:/, "");
  const abs = filePath.startsWith("/") ? filePath : join(process.cwd(), filePath);
  mkdirSync(dirname(abs), { recursive: true });
}

const env = { ...process.env } as Bindings;

const { app } = await createApp({ env });

// 把 process.env 注入每个请求的 c.env
app.use("*", async (c, next) => {
  const bag = c.env as Record<string, unknown>;
  for (const [k, v] of Object.entries(process.env)) {
    if (!(k in bag) && v !== undefined) bag[k] = v;
  }
  if (!c.get("executionCtx")) {
    c.set("executionCtx", undefined);
  }
  await next();
});

console.log(`[cf-auth] http://localhost:${PORT}`);
console.log(`[cf-auth] baseURL=${env.BETTER_AUTH_URL || env.APP_ORIGIN || `http://localhost:${PORT}`}`);
console.log(`[cf-auth] database=${dbUrl}`);

serve({ fetch: app.fetch, port: PORT });
