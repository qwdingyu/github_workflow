/**
 * Workers Cache API 封装
 * 
 * Cloudflare Free 套餐的 Cache API 完全免费，不计入 10 万次/天的请求限制。
 * 用于缓存商品列表、系统配置等低频变更的接口响应。
 * 
 * 使用场景：
 * - GET /products（商品列表，TTL 5 分钟）
 * - GET /system-config（系统配置，TTL 30 分钟）
 * - GET /products/:slug（商品详情，TTL 5 分钟）
 */

const CACHE_NAMESPACE = "eshop-v1";

/**
 * 生成缓存键
 * @param path - URL 路径（如 /products）
 * @param query - 查询参数（可选）
 */
export function cacheKey(path: string, query?: string): string {
  const base = `https://cache.local/${CACHE_NAMESPACE}${path}`;
  return query ? `${base}?${query}` : base;
}

/**
 * 从 Cache API 读取缓存
 * @param key - 缓存键
 * @returns 缓存的 Response 或 null
 */
export async function cacheGet(key: string): Promise<Response | null> {
  try {
    const cache = caches.default;
    const match = await cache.match(key);
    return match || null;
  } catch (err) {
    console.warn("[cache] get failed:", err);
    return null;
  }
}

/**
 * 写入 Cache API
 * @param key - 缓存键
 * @param response - 要缓存的 Response
 * @param ttlSeconds - TTL（秒）
 */
export async function cachePut(key: string, response: Response, ttlSeconds: number): Promise<void> {
  try {
    const cache = caches.default;
    // Clone response because Cache API consumes it
    const clone = response.clone();
    // 设置 Cache-Control 头
    const headers = new Headers(clone.headers);
    headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    headers.set("CF-Cache-Status", "HIT");
    const cachedResponse = new Response(clone.body, {
      status: clone.status,
      statusText: clone.statusText,
      headers,
    });
    await cache.put(key, cachedResponse);
  } catch (err) {
    console.warn("[cache] put failed:", err);
  }
}

/**
 * 删除缓存
 * @param key - 缓存键
 */
export async function cacheDelete(key: string): Promise<boolean> {
  try {
    const cache = caches.default;
    return await cache.delete(key);
  } catch (err) {
    console.warn("[cache] delete failed:", err);
    return false;
  }
}

/**
 * 清除指定路径的所有缓存（通过 purge tag）
 * 注意：Cache API 不支持按前缀删除，只能在数据变更时主动失效特定 key
 * @param pathPattern - 路径模式（如 /products）
 */
export async function cachePurgeByPattern(pathPattern: string): Promise<void> {
  // Cache API 不支持模式匹配删除，只能在数据变更时删除具体 key
  // 这里仅记录日志，实际清理需要在数据变更时调用 cacheDelete
  console.log(`[cache] purge pattern: ${pathPattern} (manual delete required)`);
}
