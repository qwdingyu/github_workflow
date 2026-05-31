import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { fail, ok, getDb } from "../lib/http";
import { listProducts, getProduct } from "../services/product-service";
import { cacheKey, cacheGet, cachePut } from "../lib/cache";

export const productRoute = new Hono<AppEnv>();

productRoute.get("/products", async (c) => {
  // Cache API 缓存 5 分钟（Free 套餐不计入请求配额）
  const key = cacheKey("/products");
  const cached = await cacheGet(key);
  if (cached) {
    return cached;
  }

  const products = await listProducts(getDb(c));
  const response = ok(c, { products });
  
  // 写入缓存（5 分钟 TTL）
  await cachePut(key, response, 300);
  
  return response;
});

productRoute.get("/products/:slug", async (c) => {
  const slug = c.req.param("slug");
  
  // Cache API 缓存 5 分钟
  const key = cacheKey(`/products/${slug}`);
  const cached = await cacheGet(key);
  if (cached) {
    return cached;
  }

  const product = await getProduct(getDb(c), slug);
  if (!product) return fail(c, "商品不存在或已下架", 404);
  
  const response = ok(c, { product });
  
  // 写入缓存（5 分钟 TTL）
  await cachePut(key, response, 300);
  
  return response;
});
