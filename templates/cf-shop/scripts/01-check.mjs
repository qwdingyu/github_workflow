import { readFileSync } from "node:fs";

/*
 * eshop 本地结构检查脚本。
 *
 * 用途：
 * - 快速确认项目关键文件存在。
 * - 检查 wrangler.jsonc 是否绑定 D1 和 Static Assets。
 * - 检查 Static Assets 是否全量 Worker-first，避免 /admin 被静态层重定向到用户首页。
 * - 检查 Worker 是否保留发卡所需的核心 API 和 D1 UPDATE RETURNING。
 * - 检查 migration 是否创建 products/cards/orders 三张核心表。
 *
 * 必填环境变量：
 * - 无。
 *
 * 可选环境变量：
 * - 无。
 *
 * 常用命令：
 * - 在 eshop 项目根目录执行：
 *   rtk npm run check
 *
 * 使用边界：
 * - 这是静态结构检查，不替代 wrangler dev、远程 verify 或 smoke。
 * - 它不会访问 Cloudflare，不会读写 D1，不会消耗库存。
 */

const requiredFiles = [
  "wrangler.jsonc",
  "src/index.ts",
  "src/routes/orders.ts",
  "src/routes/admin.ts",
  "src/services/order-service.ts",
  "src/services/issue-service.ts",
  "src/lib/idempotency.ts",
  "src/lib/rate-limit.ts",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "migrations/0001_init.sql",
  "seed.sql"
 ];

for (const file of requiredFiles) {
  readFileSync(file, "utf8");
}

const wrangler = readFileSync("wrangler.jsonc", "utf8");
const worker = readFileSync("src/index.ts", "utf8");
const ordersRoute = readFileSync("src/routes/orders.ts", "utf8");
const adminRoute = readFileSync("src/routes/admin.ts", "utf8");
const issueService = readFileSync("src/services/issue-service.ts", "utf8");
const migration = readFileSync("migrations/0001_init.sql", "utf8");
const html = readFileSync("public/index.html", "utf8");

const checks = [
  [wrangler.includes('"binding": "ASSETS"'), "wrangler.jsonc must bind Static Assets as ASSETS"],
  [wrangler.includes('"run_worker_first": true'), "wrangler.jsonc must route all assets requests through Worker first"],
  [wrangler.includes('"main": "src/index.ts"'), "wrangler.jsonc must use TypeScript Worker entry"],
  [worker.includes("Hono") && worker.includes("requireAdmin"), "Worker must use Hono and admin auth"],
  [worker.includes("getDb") || worker.includes("database"), "Worker must initialize database (Turso/D1)"],
  [ordersRoute.includes("z.object") && ordersRoute.includes("Idempotency-Key") || ordersRoute.includes("idempotency-key"), "Orders route must validate input and support idempotency"],
  [adminRoute.includes("/cards/import") && adminRoute.includes("mark-paid"), "Admin route must expose card import and manual issue APIs"],
  [issueService.includes("issueAvailableCard") || issueService.includes("update(cards)"), "Issue service must issue cards with Drizzle ORM or raw SQL"],
  [migration.includes("CREATE TABLE IF NOT EXISTS products"), "migration must create products"],
  [migration.includes("CREATE TABLE IF NOT EXISTS cards"), "migration must create cards"],
  [migration.includes("CREATE TABLE IF NOT EXISTS orders"), "migration must create orders"],
  [migration.includes("CREATE TABLE IF NOT EXISTS coupons"), "migration must create coupons"],
  [migration.includes("CREATE TABLE IF NOT EXISTS admin_audit_logs"), "migration must create admin audit logs"],
  [migration.includes("CREATE TABLE IF NOT EXISTS idempotency_keys"), "migration must create idempotency keys"],
  [migration.includes("CREATE TABLE IF NOT EXISTS system_config"), "migration must create system_config"],
  [migration.includes("CREATE TABLE IF NOT EXISTS card_logs"), "migration must create card_logs"],
  [migration.includes("CREATE TABLE IF NOT EXISTS rate_limit_windows"), "migration must create rate_limit_windows"],
  [migration.includes("'pending'"), "migration must define orders status check with pending"],
  [html.includes("eshop"), "HTML must render eshop"]
 ];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  for (const [, message] of failed) console.error(message);
  process.exit(1);
}

console.log("eshop checks passed.");
