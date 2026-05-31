import { Hono } from "hono";
import { z } from "zod";
import { fail, ok, getDb, safeJsonBody } from "../lib/http";
import type { AppEnv } from "../bindings";
import { enforceRateLimit, writeRequestLog } from "../lib/rate-limit";
import { checkIdempotency, saveIdempotentResponse } from "../lib/idempotency";
import { verifyTurnstile } from "../lib/security";
import { createOrder, getOrderByCouponCode, getOrderByToken, getOrderByNo, getOrdersByEmail } from "../services/order-service";
import { getProduct } from "../services/product-service";
import { quoteCoupon } from "../services/coupon-service";

const createOrderSchema = z.object({
  productId: z.string().regex(/^[a-z0-9_-]{2,80}$/).optional().or(z.literal("")),
  buyerContact: z.string().trim().min(3).max(120).optional().or(z.literal("")),
  buyerEmail: z.string().trim().email().max(160).min(1),
  couponCode: z.string().trim().min(2).max(80).optional().or(z.literal("")),
  campaignCode: z.string().trim().max(40).optional().or(z.literal("")),
  referralCode: z.string().trim().max(40).optional().or(z.literal("")),
  turnstileToken: z.string().trim().optional().or(z.literal(""))
});

const quoteSchema = z.object({
  productId: z.string().regex(/^[a-z0-9_-]{2,80}$/),
  couponCode: z.string().trim().max(40).optional().or(z.literal(""))
});

export const orderRoute = new Hono<AppEnv>();

orderRoute.post("/coupons/quote", async (c) => {
  // 折扣码报价接口增加限流，防止暴力枚举折扣码
  const limit = await enforceRateLimit(c, "coupon_quote", 20);
  if (!limit.ok) return fail(c, limit.message || "请求过于频繁，请稍后再试", limit.status || 429);

  const body = quoteSchema.safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());
  const product = await getProduct(getDb(c), body.data.productId);
  if (!product) return fail(c, "商品不存在或已下架", 404);
  const quote = await quoteCoupon(getDb(c), product.priceCents, product.id, body.data.couponCode);
  return ok(c, { priceCents: product.priceCents, ...quote });
});

orderRoute.post("/orders", async (c) => {
// 用户下单入口：限流 -> Zod -> Turnstile -> 幂等 -> 发卡。
  const limit = await enforceRateLimit(c, "create_order", 8);
  if (!limit.ok) return fail(c, limit.message || "请求过于频繁，请稍后再试", limit.status || 429);

  const body = createOrderSchema.safeParse(await safeJsonBody(c));
  if (!body.success) {
    await writeRequestLog(c, "create_order", 400, limit.ipHash);
    return fail(c, "请求参数无效", 400, body.error.flatten());
  }


  const turnstile = await verifyTurnstile(c, body.data.turnstileToken);
  if (!turnstile.ok) {
    await writeRequestLog(c, "create_order", 403, limit.ipHash);
    return fail(c, turnstile.message || "安全校验失败", 403);
  }

  const idempotencyKey = c.req.header("idempotency-key")?.trim();
  if (idempotencyKey) {
    const idem = await checkIdempotency(getDb(c), idempotencyKey, "create_order");
    if (!idem.shouldProceed && idem.cachedResponse) return c.json(JSON.parse(idem.cachedResponse), 200);
  }

  const result = await createOrder(c, body.data, limit.ipHash || "");
  if (!result.ok) {
    await writeRequestLog(c, "create_order", result.status, limit.ipHash);
    return fail(c, result.message, result.status);
  }

  const response = { ok: true, order: result.order };
  if (idempotencyKey) {
    try {
      await saveIdempotentResponse(getDb(c), idempotencyKey, "create_order", result.order.id, response);
    } catch (e) {
      // 幂等键保存失败时降级：丢失幂等保护但用户能拿到响应，优于永久卡死
      console.warn("[idempotency] failed to save response for key", idempotencyKey, e);
    }
  }
  await writeRequestLog(c, "create_order", 201, limit.ipHash);
  return c.json(response, 201);
});

orderRoute.get("/orders/lookup", async (c) => {
  // 限流：每 IP 每分钟最多 10 次，防止通过 orderNo 时间戳预测批量枚举
  const limit = await enforceRateLimit(c, "order_lookup", 10);
  if (!limit.ok) return fail(c, limit.message || "请求过于频繁，请稍后再试", limit.status || 429);

  const token = c.req.query("token")?.trim();
  const code = c.req.query("code")?.trim();
  const orderNo = c.req.query("orderNo")?.trim();
  const email = c.req.query("email")?.trim();
  const turnstileToken = c.req.query("turnstileToken")?.trim();

  if (email) {
    // 邮箱查询：Turnstile + 限流双重防护，防止批量枚举泄露订单信息
    const emailLimit = await enforceRateLimit(c, "order_lookup_email", 5);
    if (!emailLimit.ok) return fail(c, emailLimit.message || "请求过于频繁，请稍后再试", emailLimit.status || 429);
    const turnstile = await verifyTurnstile(c, turnstileToken);
    if (!turnstile.ok) return fail(c, turnstile.message || "安全校验失败，请完成验证后重试", 403);
    const orders = await getOrdersByEmail(getDb(c), email);
    return ok(c, { orders, total: orders.length, hasMore: false });
  }

  if (orderNo) {
    // 订单号查询返回卡密，需 Turnstile + 独立限流双重防护（orderNo 可预测，防止批量枚举）
    const orderNoLimit = await enforceRateLimit(c, "order_lookup_no", 5);
    if (!orderNoLimit.ok) return fail(c, orderNoLimit.message || "请求过于频繁，请稍后再试", orderNoLimit.status || 429);
    const turnstile = await verifyTurnstile(c, turnstileToken);
    if (!turnstile.ok) return fail(c, turnstile.message || "安全校验失败，请完成验证后重试", 403);
    const order = await getOrderByNo(getDb(c), orderNo);
    if (!order) return fail(c, "订单不存在", 404);
    // 过期/作废订单不返回卡密信息
    if (order.status === "expired" || order.status === "failed") {
      return ok(c, { order: { ...order, delivery: undefined } });
    }
    return ok(c, { order });
  }

  if (!token && !code) return fail(c, "请输入订单 Token、订单号或邮箱", 400);
  const order = token
    ? await getOrderByToken(getDb(c), token)
    : await getOrderByCouponCode(getDb(c), code || "");
  if (!order) return fail(c, "订单不存在，或该折扣码不支持查询", 404);
  return ok(c, { order });
});
