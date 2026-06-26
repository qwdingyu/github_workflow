/**
 * 健康检查路由
 *
 * GET /health — 返回服务状态、数据库连通性、DTC 数据量统计。
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../bindings";
import type { Db } from "../services/dtc-service";
import { ok, fail } from "@usethink/cf-core/http";
import { count as drizzleCount } from "drizzle-orm";
import { dtcCodes, manufacturers } from "../db/schema";

/** 从 Hono Context 获取类型安全的 Db 实例（转型，运行时由 bootstrap 保证 db 已初始化） */
function getDb(c: Context<AppEnv>): Db {
  return c.get("db") as unknown as Db;
}

const health = new Hono<AppEnv>();

health.get("/", async (c) => {
  const checks: Record<string, string | number> = {
    service: "ok",
    timestamp: new Date().toISOString(),
  };

  try {
    const db = getDb(c);
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

    return ok(c, checks);
  } catch (err) {
    checks.database = "error";
    checks.dbError = err instanceof Error ? err.message : String(err);
    return fail(c, "部分服务不可用", 503, checks);
  }
});

export { health };