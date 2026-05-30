/**
 * DTC 故障码查询服务 — Worker 入口
 *
 * 直接管理 DB 初始化和路由注册（不依赖 cf-core 的 bootstrap，
 * 避免 Drizzle 版本冲突）。
 *
 * 路由结构：
 *   /api/health        — 健康检查
 *   /api/v1/dtc/{code} — 单码查询
 *   /api/v1/dtc/search — 搜索
 *   /api/v1/dtc/batch  — 批量查询
 *   /api/v1/dtc/stats  — 统计
 *   /api/v1/dtc/by-manufacturer/{mfr} — 按制造商
 *   /api/v1/dtc/extract — 从文本提取
 *   /api/v1/dtc/normalize/{code} — 归一化
 *   /api/v1/manufacturers — 制造商列表
 */

import { Hono } from "hono";
import { initDatabase } from "./db/database";
import type { AppEnv } from "./bindings";
import { fail } from "@eforge/cf-core/http";
import { buildSecurityHeaders } from "@eforge/cf-core/security";
import { health } from "./routes/health";
import { dtc } from "./routes/dtc";
import { manufacturersRoute } from "./routes/manufacturers";

// 创建 Hono 应用
const api = new Hono<AppEnv>();

// ── 数据库初始化中间件 ──
// 所有路由通过此中间件获取 db 实例
api.use("*", async (c, next) => {
  const isHealth = c.req.path === "/api/health";

  try {
    const { db } = initDatabase({ TURSO_URL: c.env.TURSO_URL, TURSO_TOKEN: c.env.TURSO_TOKEN });
    c.set("db", db);
    c.set("executionCtx", c.executionCtx);
    await next();
  } catch (err) {
    console.error("[db-init]", err);
    if (isHealth) { c.set("db", undefined as any); c.set("executionCtx", c.executionCtx); await next(); return; }
    return fail(c, "服务暂时不可用", 503);
  }
});

// ── 全局中间件：安全响应头 ──
api.use("*", async (c, next) => {
  await next();
  const headers = buildSecurityHeaders({});
  for (const [key, value] of Object.entries(headers)) {
    c.res.headers.set(key, value);
  }
});

// ── 注册路由 ──
api.route("/api/health", health);
api.route("/api/v1/dtc", dtc);
api.route("/api/v1/manufacturers", manufacturersRoute);

// ── 静态资源 ──
// 优先级：先查 API 路由，未匹配则使用 ASSETS
api.all("*", async (c) => {
  const env = c.env as { ASSETS: Fetcher };
  if (env.ASSETS) {
    const response = await env.ASSETS.fetch(c.req.raw);
    if (response.status !== 404) return response;
  }
  return new Response("Not Found", { status: 404 });
});

export default api;