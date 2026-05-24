import { readFileSync } from "node:fs";

/*
 * CF Form Kit 模板结构检查脚本。
 *
 * 用途：
 * - 检查模板关键文件是否存在。
 * - 检查 wrangler.jsonc 是否绑定 D1 和 Static Assets。
 * - 检查源码是否保留 Hono、Zod、Drizzle、限流、幂等、Turnstile 入口。
 *
 * 必填环境变量：
 * - 无。
 *
 * 常用命令：
 * - rtk npm run check
 */

const files = [
  "wrangler.jsonc",
  "src/index.ts",
  "src/config/forms.ts",
  "src/db/schema.ts",
  "src/routes/forms.ts",
  "src/lib/rate-limit.ts",
  "src/lib/idempotency.ts",
  "src/lib/security.ts",
  "migrations/0001_init.sql",
  "public/index.html",
  "public/_headers"
];

for (const file of files) readFileSync(file, "utf8");

const wrangler = readFileSync("wrangler.jsonc", "utf8");
const pkg = readFileSync("package.json", "utf8");
const index = readFileSync("src/index.ts", "utf8");
const formsRoute = readFileSync("src/routes/forms.ts", "utf8");
const migration = readFileSync("migrations/0001_init.sql", "utf8");

const checks = [
  [wrangler.includes('"binding": "DB"'), "wrangler.jsonc 必须绑定 D1 DB"],
  [wrangler.includes('"binding": "ASSETS"'), "wrangler.jsonc 必须绑定 Static Assets"],
  [pkg.includes('"hono"') && pkg.includes('"zod"') && pkg.includes('"drizzle-orm"'), "package.json 必须包含 Hono/Zod/Drizzle"],
  [index.includes("new Hono"), "src/index.ts 必须使用 Hono"],
  [formsRoute.includes("zValidator") && formsRoute.includes("submissionSchema"), "表单提交必须使用 Zod validator"],
  [formsRoute.includes("enforceRateLimit"), "表单提交必须有限流入口"],
  [formsRoute.includes("Idempotency") || formsRoute.includes("idempotency"), "表单提交必须有幂等入口"],
  [formsRoute.includes("verifyTurnstile"), "表单提交必须保留 Turnstile 入口"],
  [migration.includes("CREATE TABLE IF NOT EXISTS submissions"), "migration 必须创建 submissions"],
  [migration.includes("CREATE TABLE IF NOT EXISTS request_logs"), "migration 必须创建 request_logs"],
  [migration.includes("CREATE TABLE IF NOT EXISTS idempotency_keys"), "migration 必须创建 idempotency_keys"]
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  for (const [, message] of failed) console.error(message);
  process.exit(1);
}

console.log("CF Form Kit checks passed.");
