import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../bindings";
import { fail, maskContact, ok, getDb, safeJsonBody } from "../lib/http";
import { and, eq, inArray, sql } from "drizzle-orm";
import { cards, coupons } from "../db/schema";
import { getIpHash } from "../lib/security";
import { enforceRateLimit } from "../lib/rate-limit";
import { writeAdminAudit } from "../services/audit-service";
import { markPaidAndIssue } from "../services/order-service";
import { cleanupExpiredOrders } from "../services/cleanup-service";
import { cacheKey, cacheDelete } from "../lib/cache";
import {
  getAdminSummary,
  getOrderList,
  exportOrders,
  getOrderDetail,
  importCards,
  getCardList,
  updateCardStatus,
  getBatchList,
  getCouponList,
  getAdminProducts,
  checkProductExists,
  createProduct,
  updateProduct,
  upsertCoupon,
  generateCoupon,
  updateCoupon,
  getMergedLogs,
  getSystemConfig,
  upsertSystemConfig,
  deleteSystemConfig,
  createCouponCode,
  getLowStockProducts,
  batchDisableCards,
  cancelOrder,
  getEmailLogList,
  getCampaignList,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getReferralCodeList,
  createReferralCode,
  updateReferralCode,
  deleteReferralCode,
  updateCard,
  deleteProduct,
  deleteCoupon,
} from "../services/admin-service";
import { insertProductSchema, insertCouponSchema } from "../db/schema";
import { generateVoucherCodes, revokeVoucherCodes, getVoucherStats, listVoucherCodes } from "../services/voucher-service";

export const adminRoute = new Hono<AppEnv>();

// 管理端：每个 IP 每子路由每分钟最多 10 次，防止单路由被耗尽
// 注意：不同子路由用不同 key，避免互相挤占限额
adminRoute.use('*', async (c, next) => {
  const action = `admin:${new URL(c.req.url).pathname}`;
  const limit = await enforceRateLimit(c, action, 10);
  if (!limit.ok) return fail(c, '请求过于频繁', 429);
  await next();
});

// 管理端第一版只做固定 token，不引入用户系统。
// 目标是让个人开发者能低成本维护订单、商品和卡密，同时通过 WAF/ADMIN_TOKEN/审计日志形成基础闭环。
const importCardsSchema = z.object({
  productId: z.string().regex(/^[a-z0-9_-]{2,80}$/),
  batchName: z.string().trim().min(1).max(120),
  cards: z.array(z.object({
    accountLabel: z.string().trim().min(1).max(160),
    deliverySecret: z.string().trim().min(1).max(2000),
    deliveryNote: z.string().trim().max(1000).optional().or(z.literal(""))
  })).min(1).max(200)
});

// 基于 drizzle-zod 自动生成的 insert schema，在此基础上 extend 添加业务校验。
// schema 与 DB 表结构永远同步，新增/删除字段时无需修改此处。
const productSchema = insertProductSchema.extend({
  id: z.string().regex(/^[a-z0-9_-]{2,80}$/),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  salesCopy: z.string().trim().max(2000).default(""),
  coverUrl: z.string().trim().max(500).default(""),
  tagsJson: z.string().trim().max(2000).default("[]"),
  priceCents: z.number().int().min(0).max(999999),
  currency: z.string().trim().min(3).max(8).default("CNY"),
  issueMode: z.enum(["direct", "manual"]).default("manual"),
  active: z.boolean().default(true),
  category: z.string().trim().max(40).default(""),
  sortOrder: z.number().int().min(0).max(99999).default(100)
});

const couponSchema = insertCouponSchema.extend({
  productId: z.string().regex(/^[a-z0-9_-]{2,80}$/).optional().or(z.literal("")),
  code: z.string().trim().min(2).max(40),
  discountType: z.enum(["fixed", "percent"]),
  discountValue: z.number().int().min(1).max(100000),
  maxUses: z.number().int().min(0).max(100000).default(0),
  active: z.boolean().default(true),
  expiresAt: z.string().trim().max(40).optional().or(z.literal(""))
});

const generateCouponSchema = z.object({
  productId: z.string().regex(/^[a-z0-9_-]{2,80}$/),
  prefix: z.string().trim().max(12).optional().or(z.literal("")),
  discountType: z.enum(["fixed", "percent"]).default("fixed"),
  discountValue: z.number().int().min(1).max(100000, "折扣值至少为 1"),
  maxUses: z.number().int().min(0).max(100000).default(0),
  active: z.boolean().default(true),
  expiresAt: z.string().trim().max(40).optional().or(z.literal("")),
  count: z.number().int().min(1).max(50).default(1)
});

// ── 控制台概览 ──

adminRoute.get("/summary", async (c) => {
  try {
    const db = getDb(c);
    const summary = await getAdminSummary(db);
    return ok(c, { summary });
  } catch (err) {
    console.error("[admin/summary]", (err as Error)?.constructor?.name, (err as Error)?.message, (err as Error)?.stack);
    throw err;
  }
});

// ── 订单管理 ──

adminRoute.get("/orders", async (c) => {
  const status = c.req.query("status") || "";
  const productId = c.req.query("productId") || "";
  const q = c.req.query("q") || "";
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(Number(c.req.query("limit") || 20), 100);

  const { total, orders } = await getOrderList(getDb(c), {
    status, productId, q, page, limit
  });

  return ok(c, {
    total,
    orders: orders.map((row) => ({
      ...row,
      buyerContact: maskContact(String(row.buyerContact || "")),
      buyerEmail: row.buyerEmail ? maskContact(String(row.buyerEmail)) : ""
    }))
  });
});

adminRoute.get("/orders/export", async (c) => {
  const status = c.req.query("status") || "";
  const productId = c.req.query("productId") || "";
  const q = c.req.query("q") || "";
  const format = c.req.query("format") || "csv";
  const cursor = c.req.query("cursor") || "";
  const limit = Math.min(Number(c.req.query("limit") || 1000), 5000);

  const { rows, nextCursor, hasMore } = await exportOrders(getDb(c), {
    status, productId, q, cursor, limit
  });

  await writeAdminAudit(getDb(c), {
    action: "export_orders",
    targetType: "order",
    targetId: "",
    metadata: { status, productId, format, count: rows.length, hasMore },
    ipHash: await getIpHash(c)
  });

  if (format === "json") {
    return ok(c, { orders: rows, nextCursor, hasMore });
  }

  // CSV format
  // 防止 CSV 公式注入：以 =, +, -, @, TAB, 换行 开头的值会被 Excel 解析为公式，
  // 前置制表符 \t 可安全中和（Excel 会将其视为文本，不影响内容）。
  const safeCsv = (v: string) => {
    const c = v[0];
    if (c && ("=+-@\t\n".includes(c))) return `\t"${v.replace(/"/g, '""')}"`;
    return `"${v.replace(/"/g, '""')}"`;
  };
  const headers = ["orderNo", "productTitle", "buyerContact", "buyerEmail", "amountCents", "discountCents", "currency", "status", "createdAt", "paidAt", "issuedAt"];
  const csvRows = rows.map((row) => [
    safeCsv(String(row.orderNo || "")),
    safeCsv(String(row.productTitle || "")),
    safeCsv(maskContact(String(row.buyerContact || ""))),
    safeCsv(row.buyerEmail ? maskContact(String(row.buyerEmail)) : ""),
    safeCsv(String(row.amountCents ?? "")),
    safeCsv(String(row.discountCents ?? "")),
    safeCsv(String(row.currency || "")),
    safeCsv(String(row.status || "")),
    safeCsv(String(row.createdAt || "")),
    safeCsv(String(row.paidAt || "")),
    safeCsv(String(row.issuedAt || ""))
  ]);

  const csvContent = "\uFEFF" + [
    headers.join(","),
    ...csvRows.map((r) => r.join(","))
  ].join("\n");

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="orders-${Date.now()}.csv"`);
  if (nextCursor) {
    c.header("X-Next-Cursor", nextCursor);
    c.header("X-Has-More", "true");
  }
  return c.text(csvContent);
});

adminRoute.get("/orders/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c);
  const raw = await getOrderDetail(db, id);
  if (!raw) return fail(c, "订单不存在", 404);

  await writeAdminAudit(db, {
    action: "view_order_detail",
    targetType: "order",
    targetId: id,
    ipHash: await getIpHash(c)
  });

  const order = {
    ...raw,
    buyerContact: maskContact(String(raw.buyerContact || "")),
    buyerEmail: raw.buyerEmail ? maskContact(String(raw.buyerEmail)) : ""
  };
  return ok(c, { order });
});

adminRoute.post("/orders/:id/mark-paid", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c);
  const result = await markPaidAndIssue(db, id, { RESEND_API_KEY: c.env.RESEND_API_KEY, EMAIL_FROM: c.env.EMAIL_FROM });
  if (!result.ok) return fail(c, result.message, result.status);
  await writeAdminAudit(db, {
    action: "mark_paid_and_issue",
    targetType: "order",
    targetId: id,
    ipHash: await getIpHash(c)
  });
  return ok(c, { message: "订单已标记为已支付并完成发卡" });
});

adminRoute.post("/orders/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c);
  try {
    const result = await cancelOrder(db, id);
    await writeAdminAudit(db, {
      action: "cancel_order",
      targetType: "order",
      targetId: id,
      ipHash: await getIpHash(c)
    });
    return ok(c, { message: "订单已取消", releasedCardId: result.releasedCardId });
  } catch (err) {
    return fail(c, err instanceof Error ? err.message : "取消失败", 400);
  }
});

// ── 卡密管理 ──

adminRoute.post("/cards/import", async (c) => {
  const body = importCardsSchema.safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  try {
    const db = getDb(c);
    const result = await importCards(db, body.data);
    await writeAdminAudit(db, {
      action: "import_cards",
      targetType: "product",
      targetId: body.data.productId,
      metadata: { batchId: result.batchId, count: result.imported },
      ipHash: await getIpHash(c)
    });
    return ok(c, result, 201);
  } catch (err) {
    return fail(c, err instanceof Error ? err.message : "导入失败", 404);
  }
});

adminRoute.get("/cards", async (c) => {
  const productId = c.req.query("productId") || "";
  const batchId = c.req.query("batchId") || "";
  const status = c.req.query("status") || "";
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(Number(c.req.query("limit") || 20), 100);

  const { total, results } = await getCardList(getDb(c), {
    productId, batchId, status, page, limit
  });
  return ok(c, { total, results: results || [] });
});

adminRoute.patch("/cards/:id", async (c) => {
  const id = c.req.param("id");
  const body = z.object({
    status: z.enum(["available", "disabled"])
  }).safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  const db = getDb(c);

  // 已发卡的卡密不可变更状态
  const row = await db.all<{ status: string }>(
    sql`SELECT status FROM cards WHERE id = ${id}`
  );
  if (row.length === 0) return fail(c, "卡密不存在", 404);
  if (row[0].status === "issued") return fail(c, "已发卡的卡密不可变更状态", 409);

  const result = await updateCardStatus(db, id, body.data.status);
  if (!result) return fail(c, "卡密不存在", 404);

  await writeAdminAudit(db, {
    action: body.data.status === "disabled" ? "disable_card" : "enable_card",
    targetType: "card",
    targetId: id,
    metadata: { status: body.data.status },
    ipHash: await getIpHash(c)
  });
  return ok(c, { id, status: body.data.status });
});

adminRoute.post("/cards/batch-disable", async (c) => {
  const body = z.object({
    ids: z.array(z.string()).min(1).max(200),
    status: z.enum(["available", "disabled"])
  }).safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  const db = getDb(c);

  // 已发卡的卡密不可变更状态；批量操作前先检查是否有 issued 状态的卡密
  const issuedRows = await db.select({ id: cards.id })
    .from(cards)
    .where(and(inArray(cards.id, body.data.ids), eq(cards.status, "issued")));
  if (issuedRows.length > 0) return fail(c, `包含 ${issuedRows.length} 张已发卡的卡密，已发卡的卡密不可变更状态`, 409);

  // NOTE: batchDisableCards 服务层也应加 WHERE status != 'issued' 条件作为兜底
  const result = await batchDisableCards(db, body.data.ids, body.data.status);

  await writeAdminAudit(db, {
    action: "batch_disable_cards",
    targetType: "card",
    targetId: "",
    metadata: { count: body.data.ids.length, status: body.data.status },
    ipHash: await getIpHash(c)
  });
  return ok(c, { updated: result.updated });
});

// ── 批次列表 ──

adminRoute.get("/batches", async (c) => {
  const productId = c.req.query("productId") || "";
  const batches = await getBatchList(getDb(c), productId);
  return ok(c, { results: batches });
});

// ── 优惠码列表 ──

adminRoute.get("/coupons", async (c) => {
  const productId = c.req.query("productId") || "";
  const status = c.req.query("status") || "";
  const search = c.req.query("search") || "";
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(Number(c.req.query("limit") || 20), 100);

  const { total, results } = await getCouponList(getDb(c), { productId, status, search, page, limit });
  return ok(c, { total, results: results || [] });
});

// ── 商品管理 ──

adminRoute.get("/products", async (c) => {
  const products = await getAdminProducts(getDb(c));
  return ok(c, { products });
});

adminRoute.post("/products", async (c) => {
  const body = productSchema.safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  const db = getDb(c);
  const exists = await checkProductExists(db, body.data.id);
  if (exists) return fail(c, "商品 ID 已存在，请使用编辑功能修改", 409);

  await createProduct(db, body.data);
  await writeAdminAudit(db, {
    action: "create_product",
    targetType: "product",
    targetId: body.data.id,
    ipHash: await getIpHash(c)
  });
  // 清除商品列表缓存（Free 套餐 Cache API 不计入请求配额）
  await cacheDelete(cacheKey("/products"));
  return ok(c, {}, 201);
});

adminRoute.patch("/products/:id", async (c) => {
  const body = productSchema.partial().safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());
  const id = c.req.param("id");

  const db = getDb(c);
  const exists = await checkProductExists(db, id);
  if (!exists) return fail(c, "商品不存在", 404);
  await updateProduct(db, id, body.data);
  await writeAdminAudit(db, {
    action: "update_product",
    targetType: "product",
    targetId: id,
    ipHash: await getIpHash(c)
  });
  // 清除商品列表和详情缓存
  await cacheDelete(cacheKey("/products"));
  await cacheDelete(cacheKey(`/products/${id}`));
  return ok(c, { productId: id });
});

adminRoute.delete("/products/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c);
  const result = await deleteProduct(db, id);
  if (!result.deleted) {
    return fail(c, result.reason || "删除失败", 400);
  }
  await writeAdminAudit(db, {
    action: "delete_product",
    targetType: "product",
    targetId: id,
    ipHash: await getIpHash(c)
  });
  // 清除商品列表和详情缓存
  await cacheDelete(cacheKey("/products"));
  await cacheDelete(cacheKey(`/products/${id}`));
  return ok(c, { deleted: id });
});

// ── 优惠码管理 ──

adminRoute.post("/coupons", async (c) => {
  const body = couponSchema.safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  if (body.data.discountType === "percent" && body.data.discountValue > 100) {
    return fail(c, "百分比折扣不能超过 100", 400);
  }

  const db = getDb(c);
  const codeLower = body.data.code.toLowerCase();

  // 检查是否已存在同名折扣码 — 存在时返回警告而非静默覆盖
  const existing = await db.select({ code: coupons.code }).from(coupons).where(eq(coupons.code, codeLower)).limit(1);
  const isUpdate = existing.length > 0;

  await upsertCoupon(db, {
    code: codeLower,
    productId: body.data.productId || "",
    discountType: body.data.discountType,
    discountValue: body.data.discountValue,
    maxUses: body.data.maxUses,
    active: body.data.active,
    expiresAt: body.data.expiresAt || null,
  });

  await writeAdminAudit(db, {
    action: isUpdate ? "update_coupon" : "create_coupon",
    targetType: "coupon",
    targetId: codeLower,
    ipHash: await getIpHash(c)
  });
  return ok(c, { code: codeLower, warning: isUpdate ? `折扣码 "${codeLower}" 已存在，已覆盖原值` : undefined }, isUpdate ? 200 : 201);
});

adminRoute.post("/coupons/generate", async (c) => {
  const body = generateCouponSchema.safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  if (body.data.discountType === "percent" && body.data.discountValue > 100) {
    return fail(c, "百分比折扣不能超过 100", 400);
  }

  const db = getDb(c);
  const exists = await checkProductExists(db, body.data.productId);
  if (!exists) return fail(c, "商品不存在", 404);

  const codes = await generateCoupon(db, { ...body.data, count: body.data.count });

  await writeAdminAudit(db, {
    action: "generate_coupon",
    targetType: "coupon",
    targetId: codes.join(","),
    metadata: { productId: body.data.productId, count: body.data.count },
    ipHash: await getIpHash(c)
  });
  return ok(c, { codes, productId: body.data.productId }, 201);
});

adminRoute.patch("/coupons/:code", async (c) => {
  const body = couponSchema.partial().safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());
  const code = c.req.param("code").toLowerCase();

  await updateCoupon(getDb(c), code, body.data);
  await writeAdminAudit(getDb(c), {
    action: "update_coupon",
    targetType: "coupon",
    targetId: code,
    ipHash: await getIpHash(c)
  });
  return ok(c, { code });
});

adminRoute.delete("/coupons/:code", async (c) => {
  const code = c.req.param("code").toLowerCase();
  const db = getDb(c);
  await deleteCoupon(db, code);
  await writeAdminAudit(db, {
    action: "delete_coupon",
    targetType: "coupon",
    targetId: code,
    ipHash: await getIpHash(c)
  });
  return ok(c, { deleted: code });
});

// ── 操作日志 ──

adminRoute.get("/logs", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(Number(c.req.query("limit") || 20), 100);

  const { total, logs } = await getMergedLogs(getDb(c), page, limit);
  return ok(c, { total, logs: logs || [] });
});

// ── 管理员系统参数 ──

adminRoute.get("/system-config", async (c) => {
  const config = await getSystemConfig(getDb(c));
  return ok(c, { config });
});

const systemConfigSchema = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.string().trim().max(500)
});

adminRoute.put("/system-config", async (c) => {
  const body = systemConfigSchema.safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  const db = getDb(c);
  await upsertSystemConfig(db, body.data.key, body.data.value);
  await writeAdminAudit(db, {
    action: "update_system_config",
    targetType: "system_config",
    targetId: body.data.key,
    metadata: { key: body.data.key, value: body.data.value },
    ipHash: await getIpHash(c)
  });
  // 清除系统配置缓存
  await cacheDelete(cacheKey("/system-config"));
  return ok(c, { key: body.data.key, value: body.data.value });
});

adminRoute.delete("/system-config/:key", async (c) => {
  const key = c.req.param("key");
  const builtInKeys = [
    "require_email",
    "order_expire_minutes",
    "resend_from_email",
    "resend_api_key",
    "inventory_warning_enabled",
    "inventory_warning_threshold",
  ];
  if (builtInKeys.includes(key)) {
    return fail(c, `内置配置项 "${key}" 不可删除，请使用 PUT 接口修改其值`, 400);
  }
  const db = getDb(c);
  await deleteSystemConfig(db, key);
  await writeAdminAudit(db, {
    action: "delete_system_config",
    targetType: "system_config",
    targetId: key,
    metadata: { key },
    ipHash: await getIpHash(c)
  });
  // 清除系统配置缓存
  await cacheDelete(cacheKey("/system-config"));
  return ok(c, { deleted: key });
});

// ── 库存预警 ──

adminRoute.get("/low-stock-products", async (c) => {
  const threshold = c.req.query("threshold")
    ? parseInt(c.req.query("threshold")!, 10)
    : undefined;
  const products = await getLowStockProducts(getDb(c), threshold);
  return ok(c, { products });
});

// ── 邮件服务测试 ──

const testEmailSchema = z.object({
  to: z.string().trim().email("请提供有效的邮箱地址")
});

/**
 * POST /admin/test-email
 * 用真实的 RESEND_API_KEY 发一封测试邮件，验证配置是否正确。
 * 不写 email_logs（测试邮件不记业务日志）。
 */
adminRoute.post("/test-email", async (c) => {
  if (!c.env.RESEND_API_KEY) {
    return fail(c, "RESEND_API_KEY 未配置，请通过 wrangler secret put RESEND_API_KEY 设置", 400);
  }

  const body = testEmailSchema.safeParse(await safeJsonBody(c));
  if (!body.success) {
    return fail(c, body.error.issues[0]?.message || "请求参数无效", 400, body.error.flatten());
  }

  const to = body.data.to;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${c.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: c.env.EMAIL_FROM || "eshop <noreply@eforge.xyz>",
        to,
        subject: "📧 eshop 邮件服务测试",
        html: `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>邮件测试</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #333;">
  <h2 style="color: #1a73e8;">📧 邮件服务测试成功</h2>
  <p>您好，这是一封来自 <strong>eshop</strong> 的测试邮件。</p>
  <p>如果您看到这封邮件，说明 Resend 邮件服务配置正确，可以正常发送订单通知邮件了。</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="color: #666; font-size: 13px;">发送时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）</p>
</body>
</html>`
      })
    });

    const data = await res.json() as { id?: string; message?: string };

    if (!res.ok) {
      const db = getDb(c);
      await writeAdminAudit(db, {
        action: "test_email",
        targetType: "email",
        targetId: to,
        metadata: { ok: false, status: res.status, error: data.message },
        ipHash: await getIpHash(c)
      });
      return fail(c, `发送失败：${data.message || `HTTP ${res.status}`}`, 502);
    }

    await writeAdminAudit(getDb(c), {
      action: "test_email",
      targetType: "email",
      targetId: to,
      metadata: { ok: true, resendId: data.id },
      ipHash: await getIpHash(c)
    });

    return ok(c, { ok: true, message: "测试邮件发送成功", resendId: data.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeAdminAudit(getDb(c), {
      action: "test_email",
      targetType: "email",
      targetId: to,
      metadata: { ok: false, error: msg },
      ipHash: await getIpHash(c)
    });
    return fail(c, `发送异常：${msg}`, 502);
  }
});

// ── 邮件日志 ──

adminRoute.get("/email-logs", async (c) => {
  const status = c.req.query("status") || "";
  const search = c.req.query("search") || "";
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(Number(c.req.query("limit") || 20), 100);

  const { total, results } = await getEmailLogList(getDb(c), { status, search, page, limit });
  return ok(c, { total, results: results || [] });
});

// ── 营销活动管理 ──

adminRoute.get("/campaigns", async (c) => {
  const campaigns = await getCampaignList(getDb(c));
  return ok(c, { campaigns });
});

adminRoute.post("/campaigns", async (c) => {
  const body = z.object({
    code: z.string().trim().min(2).max(40),
    name: z.string().trim().min(1).max(120),
    active: z.boolean().default(true),
    startsAt: z.string().trim().max(40).optional().or(z.literal("")),
    endsAt: z.string().trim().max(40).optional().or(z.literal("")),
    metadataJson: z.string().trim().max(5000).optional().or(z.literal(""))
  }).safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  const db = getDb(c);
  await createCampaign(db, body.data);
  await writeAdminAudit(db, {
    action: "create_campaign",
    targetType: "campaign",
    targetId: body.data.code,
    ipHash: await getIpHash(c)
  });
  return ok(c, { code: body.data.code }, 201);
});

adminRoute.patch("/campaigns/:code", async (c) => {
  const code = c.req.param("code");
  const body = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
    startsAt: z.string().trim().max(40).optional().or(z.literal("")),
    endsAt: z.string().trim().max(40).optional().or(z.literal("")),
    metadataJson: z.string().trim().max(5000).optional().or(z.literal(""))
  }).safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  const db = getDb(c);
  await updateCampaign(db, code, body.data);
  await writeAdminAudit(db, {
    action: "update_campaign",
    targetType: "campaign",
    targetId: code,
    ipHash: await getIpHash(c)
  });
  return ok(c, { code });
});

adminRoute.delete("/campaigns/:code", async (c) => {
  const code = c.req.param("code");
  const db = getDb(c);
  await deleteCampaign(db, code);
  await writeAdminAudit(db, {
    action: "delete_campaign",
    targetType: "campaign",
    targetId: code,
    ipHash: await getIpHash(c)
  });
  return ok(c, { deleted: code });
});

// ── 推荐码管理 ──

adminRoute.get("/referral-codes", async (c) => {
  const codes = await getReferralCodeList(getDb(c));
  return ok(c, { codes });
});

adminRoute.post("/referral-codes", async (c) => {
  const body = z.object({
    code: z.string().trim().min(2).max(40),
    ownerContact: z.string().trim().min(1).max(120),
    rewardType: z.enum(["none", "fixed", "percent"]).default("none"),
    rewardValue: z.number().int().min(0).max(100000).default(0),
    active: z.boolean().default(true)
  }).safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  const db = getDb(c);
  await createReferralCode(db, body.data);
  await writeAdminAudit(db, {
    action: "create_referral_code",
    targetType: "referral_code",
    targetId: body.data.code,
    ipHash: await getIpHash(c)
  });
  return ok(c, { code: body.data.code }, 201);
});

adminRoute.patch("/referral-codes/:code", async (c) => {
  const code = c.req.param("code");
  const body = z.object({
    ownerContact: z.string().trim().min(1).max(120).optional(),
    rewardType: z.enum(["none", "fixed", "percent"]).optional(),
    rewardValue: z.number().int().min(0).max(100000).optional(),
    active: z.boolean().optional()
  }).safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  const db = getDb(c);
  await updateReferralCode(db, code, body.data);
  await writeAdminAudit(db, {
    action: "update_referral_code",
    targetType: "referral_code",
    targetId: code,
    ipHash: await getIpHash(c)
  });
  return ok(c, { code });
});

adminRoute.delete("/referral-codes/:code", async (c) => {
  const code = c.req.param("code");
  const db = getDb(c);
  await deleteReferralCode(db, code);
  await writeAdminAudit(db, {
    action: "delete_referral_code",
    targetType: "referral_code",
    targetId: code,
    ipHash: await getIpHash(c)
  });
  return ok(c, { deleted: code });
});

// ── 定时清理过期订单 + 僵尸卡密 ──
// 供 GitHub Actions 定时调用（Free 版无 Cron Trigger CPU 时间不足，用外部调度替代）。
// 也支持管理员手动触发。
adminRoute.post("/cleanup", async (c) => {
  const db = getDb(c);
  const result = await cleanupExpiredOrders(
    db,
    { RESEND_API_KEY: c.env.RESEND_API_KEY, EMAIL_FROM: c.env.EMAIL_FROM },
    c.var.executionCtx
  );
  await writeAdminAudit(db, {
    action: "run_cleanup",
    targetType: "system",
    targetId: "cleanup",
    metadata: result,
    ipHash: await getIpHash(c)
  });
  return ok(c, {
    message: "清理完成",
    expiredOrders: result.expiredOrders,
    releasedCards: result.releasedCards
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 充值码管理
// ═══════════════════════════════════════════════════════════════════════════════

/** 生成充值码请求体验证 */
const GenerateVoucherSchema = z.object({
  count: z.number().int().min(1).max(500),
  amountCents: z.number().int().min(1).max(99999999),
  batchId: z.string().trim().min(1).max(80),
  expiresAt: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * 批量生成充值码。
 * 每个充值码面值一致，适用于第三方收款后批量交付。
 */
adminRoute.post("/vouchers/generate", async (c) => {
  const db = getDb(c);
  const body = GenerateVoucherSchema.safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "参数无效", 400, body.error.flatten());

  const { count, amountCents, batchId, expiresAt, notes } = body.data;
  const codes = await generateVoucherCodes(
    db, count, amountCents, batchId,
    expiresAt || null, notes,
  );

  await writeAdminAudit(db, {
    action: "generate_vouchers",
    targetType: "voucher",
    targetId: batchId,
    metadata: { count, amountCents, batchId },
    ipHash: await getIpHash(c),
  });

  return ok(c, {
    count: codes.length,
    batchId,
    codes,
    message: `已生成 ${codes.length} 张充值码`,
  });
});

/** 查询充值码列表（支持分页和状态过滤） */
adminRoute.get("/vouchers/list", async (c) => {
  const db = getDb(c);
  const status = c.req.query("status") || undefined;
  const batchId = c.req.query("batchId") || undefined;
  const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
  const offset = Number(c.req.query("offset")) || 0;

  const rows = await listVoucherCodes(db, { status, batchId, limit, offset });
  return ok(c, { items: rows, limit, offset });
});

/** 充值码统计 */
adminRoute.get("/vouchers/stats", async (c) => {
  const db = getDb(c);
  const stats = await getVoucherStats(db);
  return ok(c, stats);
});

/** 批量作废充值码 */
adminRoute.post("/vouchers/revoke", async (c) => {
  const db = getDb(c);
  const body = await safeJsonBody(c) as { codes?: string[] };
  const codes = body?.codes || [];
  if (codes.length === 0) return fail(c, "请提供要作废的充值码列表", 400);
  if (codes.length > 200) return fail(c, "单次最多作废 200 个充值码", 400);

  const count = await revokeVoucherCodes(db, codes);

  await writeAdminAudit(db, {
    action: "revoke_vouchers",
    targetType: "voucher",
    targetId: codes.join(",").slice(0, 100),
    metadata: { count },
    ipHash: await getIpHash(c),
  });

  return ok(c, { count, message: `已作废 ${count} 张充值码` });
});