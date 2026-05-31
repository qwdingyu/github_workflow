/**
 * Drizzle ORM 实例工厂 — 纯 Turso/libsql 模式。
 *
 * 创建 Drizzle ORM 实例，使用 drizzle-orm/libsql 驱动。
 * 业务代码只需调用 createDb(client)，获得类型安全的 ORM 实例。
 */
import { drizzle } from "drizzle-orm/libsql";
import type { Client } from "@libsql/client/web";

/**
 * 创建 Drizzle ORM 实例。
 * @param client - @libsql/client Client 实例
 * @returns Drizzle ORM 数据库实例
 */
export function createDb(client: Client) {
  return drizzle(client);
}

/** Drizzle ORM 实例类型（从 createDb 返回值推断） */
export type DbType = ReturnType<typeof createDb>;
