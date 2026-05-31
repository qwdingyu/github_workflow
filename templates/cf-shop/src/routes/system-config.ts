import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { ok, getDb } from "../lib/http";
import { systemConfig } from "../db/schema";
import { inArray } from "drizzle-orm";
import { cacheKey, cacheGet, cachePut } from "../lib/cache";

/**
 * 公共系统配置接口——无需鉴权，用户端读取热生效参数。
 *
 * 设计原则：
 * - 只返回 white-list 的公开参数，不泄漏敏感数据。
 * - 使用 Cache API 缓存 30 分钟（Free 套餐不计入请求配额）
 * - 管理后台修改配置时主动清除缓存
 * - 使用 Drizzle ORM 查询，避免原始 SQL。
 */
const PUBLIC_KEYS = ["offline_pay_qr_wechat", "offline_pay_qr_alipay", "offline_pay_hint", "turnstile_site_key"];

export const systemConfigRoute = new Hono<AppEnv>();

systemConfigRoute.get("/system-config", async (c) => {
  // Cache API 缓存 30 分钟
  const key = cacheKey("/system-config");
  const cached = await cacheGet(key);
  if (cached) {
    return cached;
  }

  const db = getDb(c);
  const rows = await db
    .select({ key: systemConfig.key, value: systemConfig.value })
    .from(systemConfig)
    .where(inArray(systemConfig.key, PUBLIC_KEYS));

  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  
  const response = ok(c, { config });
  
  // 写入缓存（30 分钟 TTL）
  await cachePut(key, response, 1800);
  
  return response;
});