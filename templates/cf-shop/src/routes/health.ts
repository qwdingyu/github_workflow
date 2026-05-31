import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import type { AppEnv } from "../bindings";
import { cards, products } from "../db/schema";
import { ok } from "../lib/http";

export const healthRoute = new Hono<AppEnv>();

healthRoute.get("/health", async (c) => {
  const db = c.get("db");

  // DB 不可用时直接返回 degraded 状态，不尝试查询
  if (!db) {
    return ok(c, {
      service: "eshop",
      storage: "turso",
      products: -1,
      cards: -1,
      availableCards: -1,
      error: "database unavailable"
    });
  }

  try {
    // 合并为 1 次 DB 查询（Free 套餐减少网络往返）
    const [row] = await db.select({
      productCount: sql<number>`(SELECT COUNT(*) FROM products)`,
      cardCount: sql<number>`(SELECT COUNT(*) FROM cards)`,
      stockCount: sql<number>`(SELECT COUNT(*) FROM cards WHERE status = 'available')`,
    }).from(products).limit(1);

    return ok(c, {
      service: "eshop",
      storage: "turso",
      products: row?.productCount ?? 0,
      cards: row?.cardCount ?? 0,
      availableCards: row?.stockCount ?? 0
    });
  } catch (err) {
    return ok(c, {
      service: "eshop",
      storage: "turso",
      products: -1,
      cards: -1,
      availableCards: -1,
      error: String(err)
    });
  }
});