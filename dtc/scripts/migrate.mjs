/**
 * DTC 故障码查询服务 — 迁移脚本
 *
 * 读取 migrations/ 目录下的 SQL 文件，按顺序执行。
 *
 * 用法：
 *   TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=xxx node scripts/migrate.mjs
 */

import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN;

if (!TURSO_URL) {
  console.error("❌ TURSO_URL is required");
  process.exit(1);
}

const migrationsDir = join(process.cwd(), "migrations");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("ℹ️ No migration files found");
  process.exit(0);
}

console.log(`\n📦 Applying ${files.length} migration(s)...\n`);

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN || undefined,
});

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf-8");
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`  📄 ${file} (${statements.length} statements)`);

  for (const stmt of statements) {
    try {
      await client.execute(stmt);
    } catch (err: any) {
      if (err.message?.includes("already exists")) continue;
      console.error(`    ❌ ${err.message}`);
      process.exit(1);
    }
  }
}

console.log(`\n✅ All migrations applied\n`);
client.close();