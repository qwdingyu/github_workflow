/**
 * 订单路由
 *
 * POST /api/orders                — 创建订单（支持多种支付方式）
 * GET /api/orders/lookup           — 订单查询（通过订单号 + 邮箱）
 * POST /api/orders/alipay/notify   — 支付宝异步回调通知
 * POST /api/orders/stripe/webhook  — Stripe Webhook 回调
 * GET /api/orders/status           — 订单状态轮询（用于 USDT/TRC20 等需轮询的支付方式）
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ok, fail, safeJsonBody } from "@eforge/cf-core/http";
import { verifyTurnstile, getIpHash } from "@eforge/cf-core/security";
import { checkIdempotency, saveIdempotentResponse, getIdempotentResponse } from "@eforge/cf-core/idempotency";
import { MemoryRateLimiter } from "@eforge/cf-core/rate-limit";
import type { AppEnv } from "../bindings";
import { orders } from "../db/schema";
import { createOrder, lookupOrder, markPaidAndIssue } from "../services/order-service";
import { getUserBalance, deductBalance } from "../services/voucher-service";
import { createProviderRegistry, VALID_PROVIDER_NAMES } from "../services/payments";

export const orderRoutes = new Hono<AppEnv>();

// ── 限流器 ──
const orderRateLimiter = new MemoryRateLimiter();

// ═══════════════════════════════════════════════════════════════════════════════
// 创建订单
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/orders
 *
 * 创建订单流程：
 * 1. Turnstile 人机验证
 * 2. IP 限流（防刷）
 * 3. 幂等性检查（防重复提交）
 * 4. 验证请求参数
 * 5. 锁卡密 + 创建订单
 * 6. 根据 paymentMethod 分支：
 *    - "balance"    → 立即扣余额并发卡
 *    - "stripe"     → 调用 StripeProvider.createPayment → 返回 checkout URL
 *    - "alipay"     → 调用 AlipayProvider.createPayment → 返回二维码
 *    - "usdt_trc20" → 调用 Trc20Provider.createPayment → 返回收款地址+Memo
 *    - "manual"     → 返回待支付状态，管理员手动确认
 * 7. 保存幂等响应
 */
orderRoutes.post("/", async (c) => {
  try {
    // 1. Turnstile 验证
    const body = await safeJsonBody(c);
    if (!body || typeof body !== "object") {
      return fail(c, "请求体格式错误", 400);
    }
    const { turnstileToken, productId, quantity, buyerEmail, couponCode, idempotencyKey, paymentMethod } =
      body as Record<string, unknown>;

    const turnstile = await verifyTurnstile(c, turnstileToken as string | undefined);
    if (!turnstile.ok) {
      return fail(c, turnstile.message || "人机验证失败", 403);
    }

    // 2. IP 限流
    const ipHash = await getIpHash(c);
    const rateLimit = await orderRateLimiter.check(ipHash, 5, 60_000);
    if (!rateLimit.ok) {
      return fail(c, "请求过于频繁，请稍后再试", 429);
    }

    // 3. 幂等性检查
    if (idempotencyKey && typeof idempotencyKey === "string") {
      const idempotent = await getIdempotentResponse(c.get("db") as any, "order:create", idempotencyKey);
      if (idempotent) {
        return c.json(JSON.parse(idempotent.responseJson), 200);
      }
    }

    // 4. 验证参数
    const method = typeof paymentMethod === "string" ? paymentMethod : "manual";
    const orderSchema = z.object({
      productId: z.string().min(1, "请选择商品"),
      quantity: z.number().int().min(1, "数量至少为 1").max(100, "数量不能超过 100"),
      buyerEmail: z.string().email("邮箱格式错误"),
      couponCode: z.string().optional(),
      paymentMethod: z.enum(["alipay", "stripe", "usdt_trc20", "balance", "manual", "pending"]).optional(),
    });

    const parsed = orderSchema.safeParse({
      productId, quantity, buyerEmail, couponCode,
      paymentMethod: method,
    });
    if (!parsed.success) {
      return fail(c, parsed.error.errors[0]?.message || "参数错误", 400);
    }

    const db = c.get("db");
    const pm = parsed.data.paymentMethod || "manual";

    // 5. 余额支付：先查余额是否充足
    if (pm === "balance") {
      const { products } = await import("../db/schema");
      const { sql } = await import("drizzle-orm");
      const productList = await db
        .select({ priceCents: products.priceCents })
        .from(products)
        .where(sql`${products.id} = ${parsed.data.productId} AND ${products.enabled} = 1`)
        .limit(1);

      if (!productList.length) {
        return fail(c, "商品不存在或已下架", 404);
      }

      const amountCents = productList[0].priceCents * parsed.data.quantity;
      const balance = await getUserBalance(db, parsed.data.buyerEmail);
      if (balance.balanceCents < amountCents) {
        return fail(c, `余额不足：当前余额 ${(balance.balanceCents / 100).toFixed(2)} 元，需要 ${(amountCents / 100).toFixed(2)} 元`, 402);
      }

      const deducted = await deductBalance(db, parsed.data.buyerEmail, amountCents);
      if (!deducted) {
        return fail(c, "余额扣减失败，请重试", 409);
      }

      const result = await createOrder(db, {
        productId: parsed.data.productId,
        quantity: parsed.data.quantity,
        buyerEmail: parsed.data.buyerEmail,
        couponCode: parsed.data.couponCode,
        buyerIpHash: ipHash,
        paymentMethod: "balance",
      });

      if (!result.ok) {
        const { addBalance } = await import("../services/voucher-service");
        await addBalance(db, parsed.data.buyerEmail, amountCents);
        return fail(c, result.error || "创建订单失败", result.status || 400);
      }

      const issue = await markPaidAndIssue(db, result.order.id);
      if (!issue.ok) {
        return fail(c, `支付成功但发卡失败：${issue.message}。余额已扣减，请联系管理员`, 409);
      }

      const response = ok(c, {
        order: result.order,
        payment: { method: "balance", status: "paid" },
      }, 201 as any);

      if (idempotencyKey && typeof idempotencyKey === "string") {
        await saveIdempotentResponse(
          db as any, "order:create", idempotencyKey, result.order!.id, await response.clone().json(),
        );
      }

      return response;
    }

    // 6. 非余额支付：创建订单（待支付）
    const result = await createOrder(db, {
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      buyerEmail: parsed.data.buyerEmail,
      couponCode: parsed.data.couponCode,
      buyerIpHash: ipHash,
      paymentMethod: pm,
    });

    if (!result.ok) {
      return fail(c, result.error || "创建订单失败", result.status || 400);
    }

    // 7. 对于线上支付方式，调用对应的 Provider 创建支付
    const order = result.order!;
    let paymentData: Record<string, unknown> = { method: pm, status: "pending" };

    if (pm === "stripe" || pm === "alipay" || pm === "usdt_trc20") {
      const registry = createProviderRegistry(c.env);
      const provider = registry.get(pm);

      if (!provider) {
        return fail(c, `支付方式 ${pm} 未配置，请联系管理员`, 501);
      }

      try {
        const notifyUrl = `${c.env.APP_ORIGIN}/api/orders/${pm === "stripe" ? "stripe/webhook" : pm === "alipay" ? "alipay/notify" : ""}`;
        const paymentResult = await provider.createPayment({
          orderNo: order.orderNo,
          amountCents: order.paidCents || order.amountCents - order.discountCents,
          currency: pm === "alipay" ? "CNY" : pm === "usdt_trc20" ? "USDT" : "USD",
          notifyUrl: pm === "usdt_trc20" ? "" : notifyUrl,
          description: `订单 ${order.orderNo}`,
          metadata: { subject: order.orderNo },
        });

        paymentData = {
          method: pm,
          status: "pending",
          ...paymentResult,
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[orders:create] ${pm} payment creation failed:`, errMsg);
        return fail(c, `支付创建失败: ${errMsg}`, 502);
      }
    }

    // 8. 手动支付返回待支付
    if (pm === "manual") {
      paymentData = { method: "manual", status: "pending" };
    }

    // 9. 保存幂等响应
    const response = ok(c, { order, payment: paymentData }, 201 as any);
    if (idempotencyKey && typeof idempotencyKey === "string") {
      await saveIdempotentResponse(
        db as any, "order:create", idempotencyKey, order.id, await response.clone().json(),
      );
    }

    return response;
  } catch (err) {
    console.error("[orders:create] error:", err);
    return fail(c, "创建订单失败", 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 订单查询（通过订单号 + 邮箱）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/orders/lookup
 *
 * 用于买家自助查询订单状态和卡密。
 */
orderRoutes.get("/lookup", async (c) => {
  try {
    const orderNo = c.req.query("orderNo");
    const email = c.req.query("email");

    if (!orderNo || !email) {
      return fail(c, "请提供订单号和邮箱", 400);
    }

    const db = c.get("db");
    const result = await lookupOrder(db, orderNo, email);

    if (!result.ok) {
      return fail(c, result.error || "订单不存在", 404);
    }

    return ok(c, { order: result.order });
  } catch (err) {
    console.error("[orders:lookup] error:", err);
    return fail(c, "查询订单失败", 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 支付宝异步回调通知
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/orders/alipay/notify
 *
 * 支付宝支付成功后异步通知接口。
 * 使用本地 AlipayProvider 验证签名，验证通过后调用 markPaidAndIssue 发卡。
 *
 * 注意：此接口返回 "success" / "fail" 纯文本（支付宝要求的格式）。
 */
orderRoutes.post("/alipay/notify", async (c) => {
  try {
    const body = await c.req.text();
    const params: Record<string, string> = {};
    new URLSearchParams(body).forEach((value, key) => {
      params[key] = value;
    });

    const registry = createProviderRegistry(c.env);
    const alipay = registry.get("alipay");
    if (!alipay) {
      return c.text("fail");
    }

    const callbackResult = await alipay.verifyCallback(params);

    // 查订单 ID（通过订单号）
    const db = c.get("db");
    const [order] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNo, callbackResult.orderNo))
      .limit(1);

    if (!order) {
      console.warn(`[alipay:notify] 订单未找到: ${callbackResult.orderNo}`);
      return c.text("fail");
    }

    const result = await markPaidAndIssue(db, order.id, callbackResult.providerTradeNo);
    return c.text(result.ok ? "success" : "fail");
  } catch (err) {
    console.error("[alipay:notify] error:", err);
    return c.text("fail");
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe Webhook 回调
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/orders/stripe/webhook
 *
 * Stripe Checkout Session 完成后的 Webhook 通知。
 * 使用本地 StripeProvider 验证签名。
 */
orderRoutes.post("/stripe/webhook", async (c) => {
  try {
    const rawBody = await c.req.text();
    const signatureHeader = c.req.header("Stripe-Signature");

    if (!signatureHeader) {
      return c.json({ error: "Missing Stripe-Signature header" }, 400);
    }

    const registry = createProviderRegistry(c.env);
    const stripe = registry.get("stripe");
    if (!stripe) {
      return c.json({ error: "Stripe 未配置" }, 400);
    }

    const callbackResult = await stripe.verifyCallback({
      "_raw_body": rawBody,
      "_stripe_signature": signatureHeader,
    });

    const db = c.get("db");
    const [order] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNo, callbackResult.orderNo))
      .limit(1);

    if (!order) {
      console.warn(`[stripe:webhook] 订单未找到: ${callbackResult.orderNo}`);
      return c.json({ error: "订单不存在" }, 404);
    }

    const result = await markPaidAndIssue(db, order.id, callbackResult.providerTradeNo);
    if (!result.ok) {
      console.error(`[stripe:webhook] 发卡失败: ${result.message}`);
      return c.json({ error: result.message }, 500);
    }

    return c.json({ received: true });
  } catch (err) {
    console.error("[stripe:webhook] error:", err);
    return c.json({ error: "Webhook 处理失败" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 订单状态轮询（用于 USDT/TRC20 等异步支付）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/orders/status
 *
 * 查询订单最新状态。前端轮询此接口以检测支付结果。
 * 对于 USDT/TRC20 支付，会触发链上交易检查。
 *
 * 查询参数：orderNo, email（用于身份验证）
 */
orderRoutes.get("/status", async (c) => {
  try {
    const orderNo = c.req.query("orderNo");
    const email = c.req.query("email");

    if (!orderNo || !email) {
      return fail(c, "请提供订单号和邮箱", 400);
    }

    const db = c.get("db");

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNo, orderNo))
      .limit(1);

    if (!order) return fail(c, "订单不存在", 404);
    if (order.buyerEmail !== email) return fail(c, "邮箱不匹配", 403);

    // 对于 USDT/TRC20 支付，尝试链上查询
    if (order.paymentMethod === "usdt_trc20" && order.status === "pending") {
      const registry = createProviderRegistry(c.env);
      const trc20 = registry.get("usdt_trc20");

      if (trc20 && trc20.queryStatus) {
        const status = await trc20.queryStatus(orderNo);
        if (status.paid) {
          const result = await markPaidAndIssue(db, order.id, status.providerTradeNo || "");
          if (result.ok) {
            return ok(c, {
              status: "paid",
              paymentMethod: order.paymentMethod,
              paidAt: new Date().toISOString(),
              orderNo: order.orderNo,
            });
          }
        }
      }
    }

    return ok(c, {
      status: order.status,
      paymentMethod: order.paymentMethod,
      paidAt: order.paidAt,
      orderNo: order.orderNo,
    });
  } catch (err) {
    console.error("[orders:status] error:", err);
    return fail(c, "查询订单状态失败", 500);
  }
});
