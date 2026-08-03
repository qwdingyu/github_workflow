/**
 * libSQL / SQLite 客户端工厂（本地 file + 远程 Turso）。
 * 与 lottery docs/050 相同：@libsql/client 按 URL scheme 自动切换。
 */
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type AuthDb = LibSQLDatabase<typeof schema>;

export type CreateDbOptions = {
  url: string;
  authToken?: string;
};

export function createLibsqlClient(options: CreateDbOptions): Client {
  return createClient({
    url: options.url,
    authToken: options.authToken,
  });
}

export function createDb(client: Client): AuthDb {
  return drizzle(client, { schema });
}

export function createDbFromUrl(options: CreateDbOptions): { client: Client; db: AuthDb } {
  const client = createLibsqlClient(options);
  return { client, db: createDb(client) };
}
