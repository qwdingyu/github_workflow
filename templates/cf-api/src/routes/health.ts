/**
 * 健康检查路由
 *
 * GET /health — 返回服务状态、数据库连通性、时间戳。
 * 不需要认证，用于负载均衡器和监控探针。
 */

import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { ok, fail } from "@eforge/cf-core/http";

const health = new Hono<AppEnv>();

health.get("/", async (c) => {
  const checks: Record<string, string> = {
    service: "ok",
    timestamp: new Date().toISOString(),
  };

  // 检查数据库连通性
  const db = c.get("db");
  if (db) {
    try {
      // 执行简单查询验证连接
      await (db as unknown as { $client: { execute: (s: string) => Promise<unknown> } })
        .$client.execute("SELECT 1");
      checks.database = "ok";
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
