import { request } from "./http-client.mjs";

/*
 * eshop 写入 smoke。
 *
 * 用途：
 * - 验证商品读取、创建订单、幂等键、订单 token 查询和 direct 发卡闭环。
 *
 * 必填环境变量：
 * - 无。默认 BASE_URL=http://127.0.0.1:8790。
 *
 * 可选环境变量：
 * - BASE_URL：目标地址。
 * - RESOLVE_IP：强制 HTTPS 请求使用指定 IP，只用于排障。
 * - ADMIN_TOKEN：当 direct 库存耗尽时，允许脚本创建 smoke 商品、导入卡密并生成折扣码。
 *
 * 注意：
 * - 本脚本会真实创建订单。
 * - 如果商品是 direct 模式，会消耗一条 available 卡密库存。
 */

const health = await request("/api/health");
if (health.service !== "eshop" || (health.storage !== "d1" && health.storage !== "turso")) {
  throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
}

const products = await request("/api/products");
let available = products.products.find((product) => Number(product.stock) > 0 && product.issueMode === "direct");
let couponCode = ""; // 空字符串 = 无优惠码，不依赖特定优惠券存在
if (!available) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error("No direct product with available stock for smoke test. Provide ADMIN_TOKEN to create a smoke fixture.");
  }
  const headers = { authorization: `Bearer ${adminToken}` };
  const productId = `direct-smoke-${Date.now()}`;
  await request("/api/admin/products", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: productId,
      title: "Direct Smoke 商品",
      description: "写入 smoke 自动创建的 direct 商品",
      priceCents: 100,
      currency: "CNY",
      issueMode: "direct",
      active: true
    })
  });
  await request("/api/admin/cards/import", {
    method: "POST",
    headers,
    body: JSON.stringify({
      productId,
      batchName: "direct smoke batch",
      cards: [
        {
          accountLabel: `${productId}-card`,
          deliverySecret: "direct-smoke-secret",
          deliveryNote: "direct smoke note"
        }
      ]
    })
  });
  const generated = await request("/api/admin/coupons/generate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      productId,
      prefix: "DIRECT",
      discountType: "fixed",
      discountValue: 1,
      maxUses: 1,
      active: true
    })
  });
  available = { id: productId };
  couponCode = generated.code;
}

const idempotencyKey = `smoke-${Date.now()}`;
const order = await request("/api/orders", {
  method: "POST",
  headers: { "idempotency-key": idempotencyKey },
  body: JSON.stringify({
    productId: available.id,
    buyerContact: `smoke-${Date.now()}@example.test`,
    buyerEmail: `smoke-${Date.now()}@example.test`,
    couponCode,
    campaignCode: "launch",
    referralCode: "demo"
  })
});

if (!order.order?.orderToken) {
  throw new Error(`Order did not return token: ${JSON.stringify(order)}`);
}
if (!order.order?.delivery?.deliverySecret) {
  throw new Error(`Direct order did not return delivery: ${JSON.stringify(order)}`);
}

const repeated = await request("/api/orders", {
  method: "POST",
  headers: { "idempotency-key": idempotencyKey },
  body: JSON.stringify({
    productId: available.id,
    buyerContact: "repeat@example.test",
    buyerEmail: "repeat@example.test",
    couponCode
  })
});
if (repeated.order.id !== order.order.id) {
  throw new Error("Idempotency-Key did not return the original order");
}

const lookup = await request(`/api/orders/lookup?token=${encodeURIComponent(order.order.orderToken)}`);
if (lookup.order.orderNo !== order.order.orderNo || !lookup.order.delivery?.deliverySecret) {
  throw new Error(`Lookup did not return issued delivery: ${JSON.stringify(lookup)}`);
}

console.log(`eshop write smoke passed: ${order.order.orderNo} -> ${order.order.delivery.accountLabel}`);
