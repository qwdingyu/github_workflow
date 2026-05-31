import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../bindings";
import { fail, ok, getDb } from "../lib/http";
import { enforceRateLimit, writeRequestLog } from "../lib/rate-limit";
import { verifyTurnstile } from "../lib/security";
import { getCoupon, quoteCoupon, consumeCoupon } from "../services/coupon-service";
import { getProduct } from "../services/product-service";
import { issueAvailableCard, rollbackIssuedCard } from "../services/issue-service";
import { writeOrderEvent } from "../services/audit-service";
import { createOrderNo, createOrderToken, hashOrderToken } from "../lib/token";
import { orders, cards, coupons } from "../db/schema";
import { eq, sql } from "drizzle-orm";

const redeemSchema = z.object({
  couponCode: z.string().trim().min(2).max(80),
  buyerEmail: z.string().trim().email().max(160),
  turnstileToken: z.string().trim().optional().or(z.literal("")),
});

export const redeemRoute = new Hono<AppEnv>();

/** 折扣码兑换接口：验证折扣码 → 消耗 → 发卡 → 返回卡密 */
redeemRoute.post("/redeem", async (c) => {
  const limit = await enforceRateLimit(c, "redeem", 5);
  if (!limit.ok) return fail(c, limit.message || "请求过于频繁，请稍后再试", limit.status || 429);

  const body = redeemSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!body.success) {
    await writeRequestLog(c, "redeem", 400, limit.ipHash);
    return fail(c, "请求参数无效", 400);
  }

  const turnstile = await verifyTurnstile(c, body.data.turnstileToken);
  if (!turnstile.ok) {
    await writeRequestLog(c, "redeem", 403, limit.ipHash);
    return fail(c, turnstile.message || "安全校验失败", 403);
  }

  const db = getDb(c);
  const coupon = await getCoupon(db, body.data.couponCode);
  if (!coupon) {
    return fail(c, "折扣码不存在", 404);
  }
  if (!coupon.productId) {
    return fail(c, "该折扣码未绑定商品，无法兑换", 400);
  }

  const product = await getProduct(db, coupon.productId);
  if (!product) {
    return fail(c, "商品不存在或已下架", 404);
  }

  // 报价验证
  const quote = await quoteCoupon(db, product.priceCents, product.id, body.data.couponCode);
  if (!quote.valid) {
    return fail(c, quote.message, 403);
  }

  // ── 修复顺序：先发卡，再消耗优惠券，最后写订单 ──
  // 防止发卡失败时优惠券已被消耗导致用户损失

  // 1. 原子发卡（库存不足时优惠券未被消耗，用户安全）
  const orderId = crypto.randomUUID();
  const orderNo = createOrderNo();
  const issuedCard = await issueAvailableCard(db, orderId, product.id);
  if (!issuedCard) {
    return fail(c, "库存不足，兑换失败", 409);
  }

  // 2. 消耗折扣码（原子操作）
  const consume = await consumeCoupon(db, body.data.couponCode);
  if (!consume.success) {
    // 消耗失败（并发场景），回滚已发卡片
    await rollbackIssuedCard(db, issuedCard.id);
    return fail(c, "折扣码已被使用或已过期，请重试", 409);
  }

  // 3. 创建订单记录
  const orderToken = createOrderToken();
  const orderTokenHash = await hashOrderToken(orderToken);
  const nowStr = new Date().toISOString();

  try {
    await db.insert(orders).values({
      id: orderId,
      orderNo,
      productId: product.id,
      buyerContact: `redeem:${coupon.code}`,
      buyerEmail: body.data.buyerEmail,
      amountCents: 0,
      discountCents: product.priceCents,
      currency: product.currency,
      status: "issued",
      paymentMethod: "",
      paymentRef: "",
      issueMode: product.issueMode,
      orderTokenHash,
      campaignCode: "",
      referralCode: "",
      couponCode: coupon.code,
      ipHash: limit.ipHash || "",
      userAgent: c.req.header("user-agent") || "",
      createdAt: nowStr,
      paidAt: nowStr,
      issuedAt: nowStr,
      issuedCardId: issuedCard.id,
    });
  } catch (orderErr) {
    // 订单写入失败：回滚卡密 + 优惠券
    await rollbackIssuedCard(db, issuedCard.id);
    await db.update(coupons).set({ usedCount: sql`${coupons.usedCount} - 1` })
      .where(eq(sql`lower(${coupons.code})`, coupon.code.toLowerCase()));
    console.error("[redeem] order insert failed, rolled back card + coupon", orderErr);
    return fail(c, "系统繁忙，兑换失败，请重试", 500);
  }

  await writeOrderEvent(db, orderId, "redeemed", `折扣码兑换发卡成功，卡密: ${issuedCard.id}`);
  await writeRequestLog(c, "redeem", 200, limit.ipHash);

  return ok(c, {
    ok: true,
    delivery: {
      accountLabel: issuedCard.accountLabel,
      deliverySecret: issuedCard.deliverySecret,
      deliveryNote: issuedCard.deliveryNote || "",
    },
  });
});
