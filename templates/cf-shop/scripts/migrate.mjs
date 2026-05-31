/**
 * Apply SQL migrations to Turso/libSQL database.
 * Replaces the broken Turso CLI approach (CLI removed --auth-token flag).
 * Uses the libsql Node.js client directly.
 */
import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");

const url = process.env.TURSO_URL || process.env.TURSO_DB_URL;
const token = process.env.TURSO_TOKEN || process.env.TURSO_DB_AUTH_TOKEN;

if (!url || !token) {
  console.log("[migrate] TURSO_URL and TURSO_TOKEN not set, skipping migrations");
  process.exit(0);
}

const client = createClient({ url, authToken: token });

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf-8");
  const statements = sql
    .split(";")
    .map((s) => {
      // Strip leading comment lines so "ALTER TABLE" after "-- comment" isn't dropped
      let lines = s.trim().split("\n");
      while (lines.length > 0 && lines[0].trim().startsWith("--")) {
        lines.shift();
      }
      return lines.join("\n").trim();
    })
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    console.log(`Applying: ${file} ... ${stmt.slice(0, 80)}...`);
    try {
      await client.execute(stmt);
    } catch (err) {
      // ALTER TABLE / CREATE INDEX failures are often "already exists" — skip
      const msg = String(err.message || err);
      if (
        msg.includes("duplicate column") ||
        msg.includes("already exists") ||
        msg.includes("no such table")
      ) {
        console.log(`  (skipped — already applied)`);
      } else {
        console.error(`  FAILED: ${msg}`);
        process.exit(1);
      }
    }
  }
}

console.log("[migrate] All migrations applied successfully");
