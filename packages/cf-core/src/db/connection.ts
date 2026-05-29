/**
 * libSQL 数据库连接工厂
 *
 * 核心设计：Isolate 级连接复用
 * Cloudflare Workers 的 isolate 在多个请求间复用。
 * 缓存 client 实例避免每次请求重新 createClient（节省 ~1ms CPU）。
 *
 * 合并自：
 * - eshop: src/db/database.ts + src/db/client.ts
 * - xtools: src/db/database.ts + src/db/client.ts
 * - vcode: src/db/index.ts（含自动迁移）
 */

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

/** Drizzle ORM 实例类型（通用） */
export type DrizzleInstance<TSchema extends Record<string, unknown> = Record<string, never>> =
  ReturnType<typeof drizzle<TSchema>>;

// ═══════════════════════════════════════════════════════════════════════════════
// Isolate 级缓存（模块级别变量在 Workers isolate 生命周期内持久存在）
// ═══════════════════════════════════════════════════════════════════════════════

let _cachedUrl: string | undefined;
let _cachedClient: Client | undefined;

/**
 * 创建或复用 libSQL Client（Isolate 级缓存）
 *
 * 同一 isolate + 同一 URL 下复用 client 实例。
 * URL 变化时（极少见）重建实例。
 */
export function getOrCreateClient(url: string, authToken?: string): Client {
  if (_cachedClient && _cachedUrl === url) {
    return _cachedClient;
  }

  const client = createClient({ url, authToken });
  _cachedUrl = url;
  _cachedClient = client;
  return client;
}

/**
 * 创建 Drizzle ORM 实例
 *
 * @param client - libSQL Client
 * @param schema - Drizzle schema 对象（可选，传入后支持关系查询）
 */
export function createDrizzle<TSchema extends Record<string, unknown>>(
  client: Client,
  schema?: TSchema,
): DrizzleInstance<TSchema> {
  return (schema ? drizzle(client, { schema }) : drizzle(client)) as DrizzleInstance<TSchema>;
}

/**
 * 一步到位：初始化数据库（client + drizzle），带 Isolate 级缓存。
 *
 * 这是最常用的入口函数。在 Hono 中间件中调用：
 * ```ts
 * const db = initDatabase(env.TURSO_URL, env.TURSO_TOKEN, schema);
 * c.set("db", db);
 * ```
 *
 * @param url - Turso URL（libsql://xxx.turso.io）
 * @param authToken - Turso 认证 Token（可选）
 * @param schema - Drizzle schema（可选）
 */
export function initDatabase<TSchema extends Record<string, unknown>>(
  url?: string,
  authToken?: string,
  schema?: TSchema,
): DrizzleInstance<TSchema> {
  if (!url) throw new Error("TURSO_URL is required");
  const client = getOrCreateClient(url, authToken);
  return createDrizzle(client, schema);
}

/**
 * 重置 Isolate 级缓存（仅用于测试）
 */
export function _resetCache(): void {
  _cachedUrl = undefined;
  _cachedClient = undefined;
}
