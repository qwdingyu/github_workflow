/**
 * Voucher 兑换路由 — 充值码兑付与余额查询。
 *
 * 充值码是"预付费凭证"：用户先在站外付款获取充值码，
 * 然后在 /api/vouchers/redeem 兑付为余额，最后用余额购买商品。
 *
 * 关键安全设计：
 * - 兑换接口受 Turnstile 保护，防止批量枚举兑付
 * - 兑换接口有限流（每 IP 每分钟 5 次），防止暴力尝试
 * - 余额查询只返回余额信息，不暴露充值码明细
 *
 * 注意：充值码不是 PaymentProvider（它是独立路由），
 * 余额支付在订单创建时通过 paymentMethod=balance 处理。
 */

import { Hono } from "hono";
import { z } from "zod";
import { ok, fail, safeJsonBody } from "@eforge/cf-core/http";
import { verifyTurnstile } from "@eforge/cf-core/security";
import { MemoryRateLimiter } from "@eforge/cf-core/rate-limit";
import type { AppEnv } from "../bindings";
import { redeemVoucher, getUserBalance } from "../services/voucher-service";

export const voucherRoutes = new Hono<AppEnv>();

// ── 限流器 ──
const redeemRateLimiter = new MemoryRateLimiter({
  limit: 5,
  windowMs: 60_000,
  keyPrefix: "voucher:redeem",
});
const balanceRateLimiter = new MemoryRateLimiter({
  limit: 30,
  windowMs: 60_000,
  keyPrefix: "voucher:balance",
});

// ── 请求体验证 Schema ──

/** 充值码兑换请求体 */
const RedeemSchema = z.object({
  code: z.string().trim().min(8).max(80),
  email: z.string().trim().email().max(160),
  turnstileToken: z.string().trim().optional().or(z.literal("")),
});

/** 余额查询请求体 */
const BalanceSchema = z.object({
  email: z.string().trim().email().max(160),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 用户端接口
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/vouchers/redeem
 *
 * 充值码兑付接口。
 * 用户输入充值码和邮箱，兑换成功后余额自动转入 user_balances 表。
 * 兑付使用条件 UPDATE 保证原子性，并发下不会超兑。
 *
 * 限流：每 IP 每分钟 5 次（防止批量暴力尝试）。
 */
voucherRoutes.post("/vouchers/redeem", async (c) => {
  try {
    const ipHash = c.req.header("cf-connecting-ip") || "unknown";

    const rateLimit = await redeemRateLimiter.check(ipHash);
    if (!rateLimit.ok) {
      return fail(c, "请求过于频繁，请稍后再试", 429);
    }

    const body = RedeemSchema.safeParse(await safeJsonBody(c));
    if (!body.success) {
      return fail(c, "请求参数无效", 400, body.error.flatten());
    }

    // Turnstile 人机验证（可选）
    const turnstile = await verifyTurnstile(c, body.data.turnstileToken);
    if (!turnstile.ok) {
      return fail(c, turnstile.message || "安全校验失败", 403);
    }

    const db = c.get("db");

    // 调用原子兑换逻辑
    const result = await redeemVoucher(db, body.data.code, body.data.email);
    if (!result.success) {
      return fail(c, result.message, 400);
    }

    return ok(c, {
      success: true,
      amountCents: result.amountCents,
      amountYuan: (result.amountCents / 100).toFixed(2),
      message: result.message,
    });
  } catch (err) {
    console.error("[vouchers:redeem] error:", err);
    return fail(c, "兑换失败，请稍后重试", 500);
  }
});

/**
 * POST /api/vouchers/balance
 *
 * 用户余额查询接口。
 * 前端可通过此接口在结算前展示余额。
 * 查询不需要 Turnstile（信息非敏感，仅限余额数字）。
 */
voucherRoutes.post("/vouchers/balance", async (c) => {
  try {
    const ipHash = c.req.header("cf-connecting-ip") || "unknown";

    const rateLimit = await balanceRateLimiter.check(ipHash);
    if (!rateLimit.ok) {
      return fail(c, "请求过于频繁，请稍后再试", 429);
    }

    const body = BalanceSchema.safeParse(await safeJsonBody(c));
    if (!body.success) {
      return fail(c, "请求参数无效", 400, body.error.flatten());
    }

    const db = c.get("db");
    const balance = await getUserBalance(db, body.data.email);

    return ok(c, {
      email: balance.email,
      balanceCents: balance.balanceCents,
      balanceYuan: (balance.balanceCents / 100).toFixed(2),
      totalDepositedYuan: (balance.totalDepositedCents / 100).toFixed(2),
      totalSpentYuan: (balance.totalSpentCents / 100).toFixed(2),
    });
  } catch (err) {
    console.error("[vouchers:balance] error:", err);
    return fail(c, "查询余额失败", 500);
  }
});
