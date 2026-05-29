/**
 * 商品路由
 *
 * GET /api/products — 商品列表（含库存统计，Cache API 缓存 5 分钟）
 * GET /api/products/:slug — 商品详情
 */

import { Hono } from "hono";
import { ok, fail } from "@eforge/cf-core/http";
import { cache } from "@eforge/cf-core/cache";
import type { AppEnv } from "../bindings";
import { getAllProducts, getProductBySlug } from "../services/product-service";
import { CACHE_TTL } from "../config";

export const productRoutes = new Hono<AppEnv>();

/**
 * GET /api/products
 *
 * 获取商品列表，包含每个商品的可用库存数量。
 * 使用 Cache API 缓存 5 分钟，减轻数据库压力。
 */
productRoutes.get("/", async (c) => {
  try {
    // 尝试从缓存读取
    const cacheKey = new Request(c.req.url);
    const cached = await cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 查询数据库
    const db = c.get("db");
    const products = await getAllProducts(db);

    // 构建响应
    const response = ok(c, {
      products,
      count: products.length,
    });

    // 写入缓存（5 分钟）
    await cache.put(cacheKey, response, CACHE_TTL.PRODUCTS_LIST);

    return response;
  } catch (err) {
    console.error("[products:list] error:", err);
    return fail(c, "获取商品列表失败", 500);
  }
});

/**
 * GET /api/products/:slug
 *
 * 获取商品详情（通过 slug 别名）。
 * 包含完整的商品信息和库存。
 */
productRoutes.get("/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    if (!slug) {
      return fail(c, "缺少商品标识", 400);
    }

    const db = c.get("db");
    const product = await getProductBySlug(db, slug);

    if (!product) {
      return fail(c, "商品不存在", 404);
    }

    return ok(c, { product });
  } catch (err) {
    console.error("[products:detail] error:", err);
    return fail(c, "获取商品详情失败", 500);
  }
});
