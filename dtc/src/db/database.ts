/**
 * 数据库模块 — 纯 Turso/libsql 模式。
 *
 * 整个应用只使用 Drizzle ORM + libsql 驱动。
 * 所有数据库操作通过 Drizzle ORM 的 query builder 完成。
 *
 * 连接复用：Cloudflare Workers isolate 级别缓存 client 实例。
 */

import { createClient } from "@libsql/client/web";
import type { Client } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DbType = LibSQLDatabase<typeof schema>;

// Isolate 级别缓存
let _cachedUrl: string | undefined;
let _cachedDb: DbType | undefined;

/**
 * 初始化数据库：创建 libsql client + Drizzle ORM 实例。
 * 同一 isolate 内复用实例，节省重复创建开销。
 */
export function initDatabase(env: { TURSO_URL?: string; TURSO_TOKEN?: string }) {
  const url = env.TURSO_URL;
  if (!url) throw new Error("TURSO_URL is required");

  if (_cachedDb && _cachedUrl === url) {
    return { db: _cachedDb };
  }

  const client = createClient({ url, authToken: env.TURSO_TOKEN });
  const db = drizzle(client, { schema });

  _cachedUrl = url;
  _cachedDb = db;

  return { db };
}