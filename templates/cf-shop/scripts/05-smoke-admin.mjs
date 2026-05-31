import { request } from "./http-client.mjs";

/*
 * eshop 管理端 smoke。
 *
 * 用途：
 * - 验证 ADMIN_TOKEN、管理概览、商品创建、卡密导入、manual 订单和管理员确认发卡。
 *
 * 必填环境变量：
 * - ADMIN_TOKEN：与 Worker 环境中的 ADMIN_TOKEN 一致。
 *
 * 可选环境变量：
 * - BASE_URL：目标地址，默认 http://127.0.0.1:8790。
 * - RESOLVE_IP：强制 HTTPS 请求使用指定 IP，只用于排障。
 *
 * 常用命令：
 * - ADMIN_TOKEN="dev-only-change-me" rtk npm run smoke:admin
 */

const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) throw new Error("缺少 ADMIN_TOKEN");

const headers = { authorization: `Bearer ${adminToken}` };
const productId = `manual-smoke-${Date.now()}`;
const cardLabel = `${productId}-card`;

await request("/api/admin/summary", { headers });

// 验证管理员系统参数
const sysCfg = await request("/api/admin/system-config", { headers });
if (typeof sysCfg.config?.offline_pay_hint !== "string") {
  throw new Error(`Unexpected admin system-config: ${JSON.stringify(sysCfg)}`);
}
const originalHint = sysCfg.config.offline_pay_hint;
await request("/api/admin/system-config", {
  method: "PUT",
  headers,
  body: JSON.stringify({ key: "offline_pay_hint", value: originalHint === "true" ? "false" : "true" })
});
const sysCfg2 = await request("/api/admin/system-config", { headers });
if (sysCfg2.config?.offline_pay_hint === originalHint) {
  throw new Error("System config update did not persist");
}
// 恢复原始值
await request("/api/admin/system-config", {
  method: "PUT",
  headers,
  body: JSON.stringify({ key: "offline_pay_hint", value: originalHint })
});

// 验证管理员商品列表（含下架商品）
const adminProducts = await request("/api/admin/products", { headers });
if (!Array.isArray(adminProducts.products)) {
  throw new Error(`Admin products should return array: ${JSON.stringify(adminProducts)}`);
}

await request("/api/admin/products", {
  method: "POST",
  headers,
  body: JSON.stringify({
    id: productId,
    title: "Manual Smoke 商品",
    description: "管理端 smoke 自动创建的 manual 商品",
    priceCents: 100,
    currency: "CNY",
    issueMode: "manual",
    active: true
  })
});

await request("/api/admin/cards/import", {
  method: "POST",
  headers,
  body: JSON.stringify({
    productId,
    batchName: "admin smoke batch",
    cards: [
      {
        accountLabel: cardLabel,
        deliverySecret: "admin-smoke-secret",
        deliveryNote: "admin smoke note"
      }
    ]
  })
});

const coupon = await request("/api/admin/coupons/generate", {
  method: "POST",
  headers,
  body: JSON.stringify({
    productId,
    prefix: "SMOKE",
    discountType: "fixed",
    discountValue: 1,
    maxUses: 1,
    active: true
  })
});

const created = await request("/api/orders", {
  method: "POST",
  headers: { "idempotency-key": productId },
  body: JSON.stringify({
    productId,
    buyerContact: "admin-smoke@example.test",
    buyerEmail: "admin-smoke@example.test",
    couponCode: coupon.code,
    turnstileToken: process.env.SMOKE_TURNSTILE_TOKEN || ""
  })
});
if (created.order.status !== "pending") {
  throw new Error(`Manual order should be pending: ${JSON.stringify(created)}`);
}

await request(`/api/admin/orders/${created.order.id}/mark-paid`, {
  method: "POST",
  headers
});

// 验证订单详情 API 返回正确的字段名（camelCase + buyerEmail）
const detail = await request(`/api/admin/orders/${created.order.id}`, { headers });
if (!detail.order || !detail.order.buyerEmail || !detail.order.buyerContact || !detail.order.createdAt) {
  throw new Error(`Order detail missing fields: ${JSON.stringify(detail.order)}`);
}
if (!detail.order.productTitle) {
  throw new Error(`Order detail missing productTitle: ${JSON.stringify(detail.order)}`);
}

const lookup = await request(`/api/orders/lookup?token=${encodeURIComponent(created.order.orderToken)}`);
if (lookup.order.status !== "issued" || lookup.order.delivery?.accountLabel !== cardLabel) {
  throw new Error(`Admin issue failed: ${JSON.stringify(lookup)}`);
}

console.log(`eshop admin smoke passed: ${created.order.orderNo} -> ${cardLabel}`);
