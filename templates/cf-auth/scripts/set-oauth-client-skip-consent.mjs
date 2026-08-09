#!/usr/bin/env node
/**
 * 第一方 RP：将 oauthClient.skipConsent 置 1（HTTP admin-update 在部分版本 404 时的运维兜底）。
 * 用法：
 *   node scripts/set-oauth-client-skip-consent.mjs --client-id <id>
 * 需要 .env 中 TURSO_URL/DATABASE_URL + TURSO_TOKEN（与生产 auth 库一致）。
 */
import "dotenv/config";
import { createClient } from "@libsql/client";

const args = process.argv.slice(2);
const i = args.indexOf("--client-id");
const clientId = i >= 0 ? args[i + 1] : "";
if (!clientId) {
  console.error("用法: --client-id <oauth client_id>");
  process.exit(1);
}
const url = process.env.DATABASE_URL || process.env.TURSO_URL;
const token = process.env.TURSO_TOKEN;
if (!url || !token) {
  console.error("需要 DATABASE_URL/TURSO_URL + TURSO_TOKEN");
  process.exit(1);
}
const c = createClient({ url, authToken: token });
const before = await c.execute({
  sql: "SELECT clientId, name, skipConsent FROM oauthClient WHERE clientId = ?",
  args: [clientId],
});
if (!before.rows.length) {
  console.error("client 不存在");
  process.exit(1);
}
await c.execute({
  sql: "UPDATE oauthClient SET skipConsent = 1 WHERE clientId = ?",
  args: [clientId],
});
const after = await c.execute({
  sql: "SELECT clientId, name, skipConsent FROM oauthClient WHERE clientId = ?",
  args: [clientId],
});
console.log(JSON.stringify({ before: before.rows[0], after: after.rows[0] }, null, 2));
