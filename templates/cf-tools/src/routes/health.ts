/**
 * 健康检查路由
 *
 * GET /api/health — 返回服务状态、数据库连通性、时间戳
 * 用于监控/负载均衡器探活
 */

import { Hono } from "hono";
import { ok, fail } from "@eforge/cf-core/http";
import type { AppEnv } from "../bindings";

export const healthRoutes = new Hono<AppEnv>();

/**
 * GET /api/health
 * 健康检查 — 检查数据库连通性并返回服务状态
 */
healthRoutes.get("/", async (c) => {
  const db = c.get("db");
  const isDbOk = !!db;

  const payload = {
    status: isDbOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    service: "cf-tools",
    db: isDbOk ? "connected" : "disconnected",
  };

  // 数据库不可用时返回 503，让负载均衡器摘除节点
  if (!isDbOk) {
    return fail(c, "数据库连接失败", 503, payload);
  }

  return ok(c, payload);
});
