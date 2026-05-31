import { baseUrl, request, textRequest } from "./http-client.mjs";

/*
 * eshop 只读 smoke。
 *
 * 用途：
 * - 验证 Worker、D1、商品接口、优惠码试算接口可用。
 * - 验证管理接口没有 token 时不会裸露。
 * - 验证 /admin 不会被 Static Assets 307 到 /，防止后台入口实际打开用户首页。
 *
 * 必填环境变量：
 * - 无。默认 BASE_URL=http://127.0.0.1:8790。
 *
 * 可选环境变量：
 * - BASE_URL：目标地址，例如 https://eshop.eforge.xyz。
 * - ADMIN_PAGE_URL：后台页面验证地址。自定义域名有 WAF challenge 时，建议填 workers.dev 域名。
 * - RESOLVE_IP：强制 HTTPS 请求使用指定 IP，只用于排障。
 *
 * 常用命令：
 * - rtk npm run smoke:readonly
 * - BASE_URL="https://eshop.eforge.xyz" rtk npm run smoke:readonly
 * - BASE_URL="https://eshop.mailforwdy.workers.dev" rtk npm run smoke:readonly
 */

const adminPageUrl = process.env.ADMIN_PAGE_URL || `${baseUrl}/admin`;

const health = await request("/api/health");
if (health.service !== "eshop" || (health.storage !== "d1" && health.storage !== "turso")) {
  throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
}

const products = await request("/api/products");
if (!Array.isArray(products.products) || products.products.length === 0) {
  throw new Error("No products returned");
}

const product = products.products[0];
// 用商品自己的 id 做 quote（不依赖特定优惠券，空 couponCode 也合法）
const quote = await request("/api/coupons/quote", {
  method: "POST",
  body: JSON.stringify({ productId: product.id, couponCode: "" })
});
if (typeof quote.payableCents !== "number") {
  throw new Error(`Unexpected coupon quote: ${JSON.stringify(quote)}`);
}

let unauthorized = false;
try {
  await request("/api/admin/summary");
} catch (error) {
  unauthorized = String(error.message).includes("HTTP 401") || String(error.message).includes("HTTP 503");
}
if (!unauthorized) throw new Error("Admin API should reject missing token");

const adminPage = await textRequest(adminPageUrl);
const isCloudflareChallenge = adminPage.statusCode === 403 && String(adminPage.headers["cf-mitigated"] || "").includes("challenge");
const hasAdminUi = adminPage.statusCode >= 200 && adminPage.statusCode < 300 && (adminPage.raw.includes("eshop Ops") || adminPage.raw.includes("管理后台"));
if (adminPage.statusCode >= 300 && adminPage.statusCode < 400) {
  throw new Error(`/admin should not redirect. got HTTP ${adminPage.statusCode} location=${adminPage.headers.location || ""}`);
}
if (!hasAdminUi && !isCloudflareChallenge) {
  throw new Error(`/admin did not return admin UI or Cloudflare challenge. got HTTP ${adminPage.statusCode}`);
}

// 验证公共系统配置接口
const sysConfig = await request("/api/system-config");
if (typeof sysConfig.config?.offline_pay_hint !== "string") {
  throw new Error(`Unexpected system-config: ${JSON.stringify(sysConfig)}`);
}

console.log(`eshop readonly smoke passed: ${baseUrl}`);
