/**
 * 健康检查路由
 *
 * GET /health — 返回服务状态、数据库连通性、DTC 数据量统计。
 * 不需要认证，用于监控探针。
 */

import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { ok, fail } from "@eforge/cf-core/http";
import { count as drizzleCount } from "drizzle-orm";
import { dtcCodes, manufacturers } from "../db/schema";

const health = new Hono<AppEnv>();

health.get("/", async (c) => {
  const checks: Record<string, string | number> = {
    service: "ok",
    timestamp: new Date().toISOString(),
  };

  const db = c.get("db");
  if (db) {
    try {
      // 连通性检查 + DTC 数据量统计
      const dtcCount = await db
        .select({ count: drizzleCount() })
        .from(dtcCodes)
        .then((rows) => rows[0]?.count ?? 0);

      const mfrCount = await db
        .select({ count: drizzleCount() })
        .from(manufacturers)
        .then((rows) => rows[0]?.count ?? 0);

      checks.database = "ok";
      checks.dtcCount = dtcCount;
      checks.manufacturerCount = mfrCount;
    } catch (err) {
      checks.database = "error";
      checks.dbError = err instanceof Error ? err.message : String(err);
    }
  } else {
    checks.database = "unavailable";
  }

  const allOk = checks.database === "ok";
  if (allOk) {
    return ok(c, checks);
  }
  return fail(c, "部分服务不可用", 503, checks);
});

export { health };