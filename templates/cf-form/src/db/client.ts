/**
 * 数据库客户端 — Turso + Drizzle ORM
 *
 * 使用 @eforge/cf-core 的 initDatabase 工厂函数创建数据库实例。
 * Isolate 级连接复用，避免每次请求重建连接。
 */

import { initDatabase, type DrizzleInstance } from "@eforge/cf-core/db";
import * as schema from "./schema";

export type DbType = DrizzleInstance<typeof schema>;

/**
 * 创建数据库实例（供中间件调用）
 */
export function createDb(url?: string, authToken?: string): DbType {
  return initDatabase(url, authToken, schema);
}
