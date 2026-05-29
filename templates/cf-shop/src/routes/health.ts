/**
 * 健康检查路由
 *
 * GET /api/health — 返回系统状态（商品数、卡密数、可用库存）
 * 用于监控和负载均衡健康检查
 */

import { Hono } from "hono";
import { ok, fail } from "@eforge/cf-core/http";
import type { AppEnv } from "../bindings";
import { products, cards } from "../db/schema";
import { sql } from "drizzle-orm";

export const healthRoutes = new Hono<AppEnv>();

/**
 * GET /api/health
 *
 * 健康检查端点，返回系统状态和库存统计。
 * 不要求认证，供监控系统使用。
 */
healthRoutes.get("/", async (c) => {
  try {
    const db = c.get("db");

    // 统计商品数量（上架的）
    const productCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(sql`${products.enabled} = 1`)
      .then((rows) => rows[0]?.count ?? 0);

    // 统计卡密数量（可用的）
    const availableCards = await db
      .select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(sql`${cards.status} = 'available'`)
      .then((rows) => rows[0]?.count ?? 0);

    // 统计卡密总数
    const totalCards = await db
      .select({ count: sql<number>`count(*)` })
      .from(cards)
      .then((rows) => rows[0]?.count ?? 0);

    return ok(c, {
      status: "healthy",
      timestamp: new Date().toISOString(),
      stats: {
        products: productCount,
        availableCards,
        totalCards,
      },
    });
  } catch (err) {
    console.error("[health] error:", err);
    return fail(c, "服务异常", 503);
  }
});
