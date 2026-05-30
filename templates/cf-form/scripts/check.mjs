import { readFileSync } from "node:fs";

/*
 * cf-form 模板结构检查脚本。
 *
 * 用途：
 * - 检查模板关键文件是否存在。
 * - 检查 wrangler.jsonc 是否绑定 Static Assets。
 * - 检查源码是否使用 @eforge/cf-core。
 *
 * 常用命令：
 * - npm run check
 */

const files = [
  "wrangler.jsonc",
  "src/index.ts",
  "src/bindings.ts",
  "src/config/forms.ts",
  "src/db/schema.ts",
  "src/routes/forms.ts",
  "src/routes/admin.ts",
  "src/routes/health.ts",
  "migrations/0001_init.sql",
  "seed.sql",
  "public/index.html",
  "public/admin.html",
  "public/app.js",
  "public/_headers",
  ".deploy-mode",
];

for (const file of files) {
  try {
    readFileSync(file, "utf8");
  } catch {
    console.error(`缺少文件: ${file}`);
    process.exit(1);
  }
}

const wrangler = readFileSync("wrangler.jsonc", "utf8");
const pkg = readFileSync("package.json", "utf8");
const index = readFileSync("src/index.ts", "utf8");
const formsRoute = readFileSync("src/routes/forms.ts", "utf8");
const migration = readFileSync("migrations/0001_init.sql", "utf8");
const deployMode = readFileSync(".deploy-mode", "utf8").trim();

const checks = [
  [wrangler.includes('"binding": "ASSETS"'), "wrangler.jsonc 必须绑定 Static Assets"],
  [pkg.includes('"@eforge/cf-core"'), "package.json 必须依赖 @eforge/cf-core"],
  [pkg.includes('"hono"') && pkg.includes('"zod"') && pkg.includes('"drizzle-orm"'), "package.json 必须包含 Hono/Zod/Drizzle"],
  [index.includes("bootstrap"), "src/index.ts 必须使用 bootstrap 工厂"],
  [formsRoute.includes("zValidator") && formsRoute.includes("submissionSchema"), "表单提交必须使用 Zod validator"],
  [formsRoute.includes("DbRateLimiter") || formsRoute.includes("rate"), "表单提交必须有限流"],
  [formsRoute.includes("checkIdempotency") || formsRoute.includes("idempotency"), "表单提交必须有幂等"],
  [formsRoute.includes("verifyTurnstile"), "表单提交必须保留 Turnstile"],
  [migration.includes("CREATE TABLE IF NOT EXISTS forms"), "migration 必须创建 forms 表"],
  [migration.includes("CREATE TABLE IF NOT EXISTS submissions"), "migration 必须创建 submissions"],
  [migration.includes("form_schema"), "forms 表必须包含 form_schema 字段"],
  [deployMode === "workers", ".deploy-mode 必须为 workers"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  for (const [, message] of failed) console.error(`❌ ${message}`);
  process.exit(1);
}

console.log("cf-form checks passed.");
