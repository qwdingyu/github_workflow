/**
 * 订单路由
 *
 * POST /api/orders — 创建订单（Turnstile + 限流 + 幂等 + 锁卡密）
 * GET /api/orders/lookup — 订单查询（通过订单号 + 邮箱）
 */

import { Hono } from "hono";
import { z } from "zod";
import { ok, fail, safeJsonBody } from "@eforge/cf-core/http";
import { verifyTurnstile, getIpHash } from "@eforge/cf-core/security";
import { checkIdempotency, saveIdempotentResponse, getIdempotentResponse } from "@eforge/cf-core/idempotency";
import { MemoryRateLimiter } from "@eforge/cf-core/rate-limit";
import type { AppEnv } from "../bindings";
import { createOrder, lookupOrder } from "../services/order-service";

export const orderRoutes = new Hono<AppEnv>();

// ── 限流器（每 IP 每分钟最多 5 次下单）──
const orderRateLimiter = new MemoryRateLimiter({
  limit: 5,
  windowMs: 60_000,
  keyPrefix: "order:create",
});

/**
 * POST /api/orders
 *
 * 创建订单流程：
 * 1. Turnstile 人机验证
 * 2. IP 限流（防刷）
 * 3. 幂等性检查（防重复提交）
 * 4. 验证请求参数
 * 5. 锁卡密 + 创建订单
 * 6. 保存幂等响应
 */
orderRoutes.post("/", async (c) => {
  try {
    // 1. Turnstile 验证
    const body = await safeJsonBody(c);
    if (!body || typeof body !== "object") {
      return fail(c, "请求体格式错误", 400);
    }
    const { turnstileToken, productId, quantity, buyerEmail, couponCode, idempotencyKey } =
      body as Record<string, unknown>;

    const turnstile = await verifyTurnstile(c, turnstileToken as string | undefined);
    if (!turnstile.ok) {
      return fail(c, turnstile.message || "人机验证失败", 403);
    }

    // 2. IP 限流
    const ipHash = await getIpHash(c);
    const rateLimit = await orderRateLimiter.check(ipHash);
    if (!rateLimit.ok) {
      return fail(c, "请求过于频繁，请稍后再试", 429);
    }

    // 3. 幂等性检查
    if (idempotencyKey && typeof idempotencyKey === "string") {
      const idempotent = await getIdempotentResponse(c.get("db"), "order:create", idempotencyKey);
      if (idempotent) {
        return c.json(JSON.parse(idempotent.responseJson), 200);
      }
    }

    // 4. 验证参数
    const orderSchema = z.object({
      productId: z.string().min(1, "请选择商品"),
      quantity: z.number().int().min(1, "数量至少为 1").max(100, "数量不能超过 100"),
      buyerEmail: z.string().email("邮箱格式错误"),
      couponCode: z.string().optional(),
    });

    const parsed = orderSchema.safeParse({ productId, quantity, buyerEmail, couponCode });
    if (!parsed.success) {
      return fail(c, parsed.error.errors[0]?.message || "参数错误", 400);
    }

    // 5. 创建订单（含锁卡密）
    const db = c.get("db");
    const result = await createOrder(db, {
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      buyerEmail: parsed.data.buyerEmail,
      couponCode: parsed.data.couponCode,
      buyerIpHash: ipHash,
    });

    if (!result.ok) {
      return fail(c, result.error || "创建订单失败", result.status || 400);
    }

    // 6. 保存幂等响应
    const response = ok(c, { order: result.order }, 201);
    if (idempotencyKey && typeof idempotencyKey === "string") {
      await saveIdempotentResponse(
        c.get("db"),
        "order:create",
        idempotencyKey,
        result.order!.id,
        await response.clone().json(),
      );
    }

    return response;
  } catch (err) {
    console.error("[orders:create] error:", err);
    return fail(c, "创建订单失败", 500);
  }
});

/**
 * GET /api/orders/lookup
 *
 * 订单查询（通过订单号 + 邮箱验证）。
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
