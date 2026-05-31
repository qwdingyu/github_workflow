import { Hono } from "hono";
import { z } from "zod";
import { fail, ok, getOrigin, normalizeCode, getDb, safeJsonBody } from "../lib/http";
import type { AppEnv } from "../bindings";
import type { DbType } from "../db/client";
import { getProduct } from "../services/product-service";
import { checkAndExpireOrder, markPaidAndIssue } from "../services/order-service";
import { quoteCoupon } from "../services/coupon-service";
import { writeOrderEvent } from "../services/audit-service";
import { enforceRateLimit, writeRequestLog } from "../lib/rate-limit";
import { createOrderToken, hashOrderToken } from "../lib/token";
import { verifyTurnstile } from "../lib/security";
import { checkIdempotency, saveIdempotentResponse } from "../lib/idempotency";
import { lockCardForOrder, releaseLockedCardByOrder } from "../services/issue-service";
import { orders, cards, products as productsTable, systemConfig } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { createProviderRegistry, type PaymentProvider, VALID_PROVIDER_NAMES } from "../services/payments";
import { deductBalance, getUserBalance } from "../services/voucher-service";
import { checkTrc20Transaction } from "../services/trc20-monitor";

/** 合法的发卡模式枚举值 */
export const VALID_ISSUE_MODES = ["direct", "manual"] as const;

/** 下单请求体共享 Schema（/pay/unified 和 /pay/offline 共用） */
const PayOrderSchema = z.object({
  productId: z.string().regex(/^[a-z0-9_-]{2,80}$/),
  couponCode: z.string().trim().max(80).optional().or(z.literal("")),
  buyerEmail: z.string().trim().email().max(160),
  turnstileToken: z.string().trim().optional().or(z.literal("")),
  campaignCode: z.string().trim().max(80).optional().or(z.literal("")),
  referralCode: z.string().trim().max(80).optional().or(z.literal("")),
  /** 余额支付标记：为 true 时使用 user_balances 余额支付，跳过外部支付渠道 */
  balancePayment: z.boolean().optional().default(false),
});

/**
 * 向 orders 表插入一条订单记录（Drizzle ORM）。
 * 被 /pay/unified（线上/线下降级）和 /pay/offline 共用。
 */
export async function createOrderRecord(
  db: DbType,
  orderId: string,
  orderNo: string,
  productId: string,
  buyerContact: string,
  buyerEmail: string,
  payableCents: number,
  discountCents: number,
  currency: string,
  paymentMethod: "online" | "offline",
  issueMode: string,
  campaignCode: string | undefined,
  referralCode: string | undefined,
  couponCode: string,
  ipHash: string | undefined,
  userAgent: string,
  orderTokenHash: string,
  expiresAt: string,
  paymentProvider?: string,
) {
  await db.insert(orders).values({
    id: orderId,
    orderNo,
    productId,
    buyerContact,
    buyerEmail,
    amountCents: payableCents,
    discountCents,
    currency,
    status: "pending",
    paymentMethod,
    paymentProvider: paymentProvider || "",
    issueMode,
    campaignCode: campaignCode || "",
    referralCode: referralCode || "",
    couponCode,
    ipHash: ipHash || "",
    userAgent,
    orderTokenHash,
    expiresAt,
    createdAt: new Date().toISOString(),
  });
}

/**
 * 创建线下支付订单（内部函数，Drizzle ORM）。
 */
export async function createOfflineOrder(
  db: DbType,
  product: { id: string; currency: string; title: string; priceCents: number },
  buyerEmail: string,
  payableCents: number,
  discountCents: number,
  issueMode: string,
  campaignCode: string | undefined,
  referralCode: string | undefined,
  couponCode: string,
  ipHash: string | undefined,
  userAgent: string,
  env?: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  executionCtx?: ExecutionContext,
): Promise<{
  orderId: string;
  orderNo: string;
  orderToken: string;
  offlineNoteCode: string;
}> {
  const orderId = crypto.randomUUID();
  const orderNo = createPayOrderNo();
  const orderToken = createOrderToken();
  const orderTokenHash = await hashOrderToken(orderToken);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const offlineNoteCode = createOfflineNoteCode();

  const lockedCard = await lockCardForOrder(db, orderId, product.id, expiresAt);
  if (!lockedCard) throw new Error("当前商品库存不足");

  try {
    await createOrderRecord(
      db, orderId, orderNo, product.id, offlineNoteCode,
      buyerEmail, payableCents, discountCents, product.currency,
      "offline", issueMode, campaignCode, referralCode, couponCode,
      ipHash, userAgent, orderTokenHash, expiresAt,
    );
  } catch (err) {
    await releaseLockedCardByOrder(db, orderId);
    throw new Error("订单创建失败，请稍后重试");
  }

  await writeOrderEvent(db, orderId, "created", "线下支付订单已创建，等待管理员确认收款");

  // 线下支付下单后发邮件通知买家（异步，不阻塞主流程）
  if (env?.RESEND_API_KEY && buyerEmail && buyerEmail.includes("@")) {
    const { sendEmail } = await import("../services/email-service");
    const emailPromise = sendEmail(db, env, {
      to: buyerEmail,
      template: "order_pending",
      templateData: {
        orderNo,
        productName: product.title,
        price: `${(payableCents / 100).toFixed(2)}`,
        currency: product.currency,
      },
      orderId
    });
    if (executionCtx) {
      executionCtx.waitUntil(emailPromise);
    } else {
      emailPromise.catch((e) => console.warn("[email] failed to send offline order notification:", e));
    }
  }

  return { orderId, orderNo, orderToken, offlineNoteCode };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 余额支付处理
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 余额支付处理函数。
 *
 * 当用户选择余额支付时调用此函数：
 * 1. 查询用户余额
 * 2. 检查余额是否足够
 * 3. 原子扣减余额
 * 4. 直接调用 markPaidAndIssue 发卡（不经过外部支付渠道）
 *
 * 设计要点：
 * - 余额查询与扣减分开（先查再扣），但扣减使用条件 UPDATE 保证原子性
 * - 发卡成功后邮件通知（由 markPaidAndIssue 内部处理）
 * - 发卡失败时余额不回退（人工介入处理，防止恶意反复余额回滚） */
async function handleBalancePayment(
  db: DbType,
  orderId: string,
  buyerEmail: string,
  payableCents: number,
  product: { id: string; title: string },
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
): Promise<{ ok: boolean; status: number; message: string }> {
  // 查询余额
  const balance = await getUserBalance(db, buyerEmail);
  if (balance.balanceCents < payableCents) {
    return { ok: false, status: 402, message: `余额不足：当前余额 ${(balance.balanceCents / 100).toFixed(2)} 元，需要 ${(payableCents / 100).toFixed(2)} 元` };
  }

  // 原子扣减余额
  const deducted = await deductBalance(db, buyerEmail, payableCents);
  if (!deducted) {
    return { ok: false, status: 409, message: "余额扣减失败，请重试" };
  }

  // 直接发卡
  const issueResult = await markPaidAndIssue(db, orderId, env);
  if (!issueResult.ok) {
    // 发卡失败时，余额已扣减，需要人工介入处理
    // 原因：发卡失败通常为库存耗尽，此时余额回滚可能导致漏洞
    // 设计上倾向于"宁可多扣不要少扣"原则
    console.error(`[balance_payment] markPaidAndIssue failed for ${orderId}, balance already deducted for ${buyerEmail}: ${issueResult.message}`);
    return { ok: false, status: 409, message: `支付成功但发卡失败：${issueResult.message}。余额已扣减，请联系管理员处理` };
  }

  return { ok: true, status: 200, message: "余额支付成功" };
}

export const payRoute = new Hono<AppEnv>();

/** 统一下单接口：自动判断线上/线下支付，前端无需感知差异 */
payRoute.post("/pay/unified", async (c) => {
  const limit = await enforceRateLimit(c, "pay_unified", 8);
  if (!limit.ok) return fail(c, limit.message || "请求过于频繁，请稍后再试", limit.status || 429);

  const body = PayOrderSchema.safeParse(await safeJsonBody(c));
  if (!body.success) {
    await writeRequestLog(c, "pay_unified", 400, limit.ipHash);
    return fail(c, "请求参数无效", 400, body.error.flatten());
  }

  // Turnstile 校验
  const turnstile = await verifyTurnstile(c, body.data.turnstileToken);
  if (!turnstile.ok) {
    await writeRequestLog(c, "pay_unified", 403, limit.ipHash);
    return fail(c, turnstile.message || "安全校验失败", 403);
  }

  const db = getDb(c);
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (idempotencyKey) {
    const idem = await checkIdempotency(db, idempotencyKey, "pay_unified");
    if (!idem.shouldProceed && idem.cachedResponse) return c.json(JSON.parse(idem.cachedResponse), 200);
  }

  // 查商品
  const product = await getProduct(db, body.data.productId);
  if (!product) return fail(c, "商品不存在或已下架", 404);
  if (Number(product.stock) < 1) return fail(c, "当前商品库存不足", 409);

  // 可选优惠码
  const quote = await quoteCoupon(db, product.priceCents, product.id, body.data.couponCode || "");
  const payableCents = quote.valid ? quote.payableCents : product.priceCents;

  // 创建订单通用参数
  const orderId = crypto.randomUUID();
  const orderNo = createPayOrderNo();
  const orderToken = createOrderToken();
  const orderTokenHash = await hashOrderToken(orderToken);
  const couponCode = normalizeCode(body.data.couponCode);
  const campaignCode = normalizeCode(body.data.campaignCode);
  const referralCode = normalizeCode(body.data.referralCode);
  // 校验发卡模式枚举值，防止数据库中存入非法值
  const issueMode = VALID_ISSUE_MODES.includes(product.issueMode) ? product.issueMode : "manual";
  const userAgent = c.req.header("user-agent") || "";
  const expiresAt = new Date(Date.now() + 30*60*1000).toISOString();

  // 软锁定卡密以防止超卖
  const lockedCard = await lockCardForOrder(db, orderId, product.id, expiresAt);
  if (!lockedCard) {
    return fail(c, "当前商品库存不足", 409);
  }

  // ── 余额支付分流 ──
  // 当 balancePayment=true 时，跳过外部支付渠道，使用 user_balances 余额支付
  if (body.data.balancePayment) {
    try {
      await createOrderRecord(
        db, orderId, orderNo, product.id, `balance:${body.data.buyerEmail.slice(0, 8)}`,
        body.data.buyerEmail.trim(), payableCents,
        quote.valid ? quote.discountCents : 0, product.currency,
        "online", issueMode, campaignCode, referralCode, couponCode,
        limit.ipHash, userAgent, orderTokenHash, expiresAt,
        "balance",
      );
    } catch (err) {
      await releaseLockedCardByOrder(db, orderId);
      throw new Error("订单创建失败，请稍后重试");
    }

    await writeOrderEvent(db, orderId, "created", "余额支付订单创建");
    const balanceResult = await handleBalancePayment(
      db, orderId, body.data.buyerEmail.trim(), payableCents,
      product, { RESEND_API_KEY: c.env.RESEND_API_KEY, EMAIL_FROM: c.env.EMAIL_FROM },
    );

    if (!balanceResult.ok) {
      console.error(`[pay_unified] balance payment failed: ${balanceResult.message}`);
      return fail(c, balanceResult.message, balanceResult.status);
    }

    await writeRequestLog(c, "pay_unified", 200, limit.ipHash);

    // 查询已发卡的卡密信息返回给用户
    const orderRows = await db
      .select({
        orderNo: orders.orderNo,
        issuedCardId: orders.issuedCardId,
        accountLabel: cards.accountLabel,
        deliverySecret: cards.deliverySecret,
        deliveryNote: cards.deliveryNote,
      })
      .from(orders)
      .leftJoin(cards, eq(cards.id, orders.issuedCardId))
      .where(eq(orders.id, orderId))
      .limit(1);

    const issuedOrder = orderRows[0];
    const responseBody: Record<string, unknown> = {
      mode: "balance",
      orderId,
      orderNo,
      orderToken,
      amountCents: payableCents,
      currency: product.currency,
      status: "issued",
    };
    if (issuedOrder) {
      responseBody.delivery = {
        accountLabel: issuedOrder.accountLabel || "",
        deliverySecret: issuedOrder.deliverySecret || "",
        deliveryNote: issuedOrder.deliveryNote || "",
      };
    }
    return ok(c, responseBody);
  }

  // 尝试线上支付（通过 Provider 抽象层）
  const registry = createProviderRegistry(c.env);
  const provider = registry.selectOnline();
  if (provider) {
    try {
      await createOrderRecord(
        db, orderId, orderNo, product.id, `pay:${orderNo.slice(-8)}`,
        body.data.buyerEmail.trim(), payableCents,
        quote.valid ? quote.discountCents : 0, product.currency,
        "online", issueMode, campaignCode, referralCode, couponCode,
        limit.ipHash, userAgent, orderTokenHash, expiresAt,
        provider.name,
      );
    } catch (err) {
      await releaseLockedCardByOrder(db, orderId);
      throw new Error("订单创建失败，请稍后重试");
    }

    await writeOrderEvent(db, orderId, "created", "支付订单已创建");

    const origin = getOrigin(c);
    const notifyUrl = `${origin}/api/pay/callback/${provider.name}`;

    try {
      const payResult = await provider.createPayment({
        orderNo,
        amountCents: payableCents,
        currency: product.currency,
        notifyUrl,
        metadata: { subject: product.title || "商品购买" },
      });

      await writeOrderEvent(db, orderId, "pay_ready", "支付二维码已生成", {
        provider: provider.name,
        total_fee: payableCents,
      });
      await writeRequestLog(c, "pay_unified", 201, limit.ipHash);

      const responseBody = {
        mode: "online",
        provider: provider.name,
        orderId,
        orderNo,
        orderToken,
        amountCents: payableCents,
        currency: product.currency,
        qrcode: payResult.qrCode || "",
        redirectUrl: payResult.redirectUrl || "",
      };
      if (idempotencyKey) {
        try { await saveIdempotentResponse(db, idempotencyKey, "pay_unified", orderId, responseBody); }
        catch (e) { console.warn("[idempotency] failed to save response for key", idempotencyKey, e); }
      }
      return ok(c, responseBody);
    } catch (err) {
      console.warn(`[pay_unified] ${provider.name} 支付创建失败，降级到线下:`, err);
      // 线上支付失败，释放卡锁，降级到线下
      await releaseLockedCardByOrder(db, orderId);
    }
  }

  // ── 降级：线下支付 ──
  // 线上支付失败释放卡密后降级到线下支付，coupon 报价可能已失效，
  // 需重新 quoteCoupon 以确保折扣金额与优惠券当前状态一致。
  const offlineQuote = couponCode
    ? await quoteCoupon(db, product.priceCents, product.id, couponCode)
    : quote;
  const offlinePayableCents = offlineQuote.valid ? offlineQuote.payableCents : product.priceCents;
  const offlineDiscountCents = offlineQuote.valid ? offlineQuote.discountCents : 0;

  let offlineResult: Awaited<ReturnType<typeof createOfflineOrder>>;
  try {
    offlineResult = await createOfflineOrder(
      db, product, body.data.buyerEmail.trim(),
      offlinePayableCents, offlineDiscountCents,
      issueMode, campaignCode, referralCode, couponCode,
      limit.ipHash, userAgent,
      { RESEND_API_KEY: c.env.RESEND_API_KEY, EMAIL_FROM: c.env.EMAIL_FROM },
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "当前商品库存不足") {
      return fail(c, "当前商品库存不足", 409);
    }
    throw new Error("订单创建失败，请稍后重试");
  }

  // 读取线下收款码配置（Drizzle ORM）
  const configRows = await db
    .select({ key: systemConfig.key, value: systemConfig.value })
    .from(systemConfig)
    .where(inArray(systemConfig.key, ["offline_pay_qr_wechat", "offline_pay_qr_alipay"]));
  const configMap: Record<string, string> = {};
  for (const row of configRows) configMap[row.key] = row.value;

  await writeRequestLog(c, "pay_unified", 201, limit.ipHash);

  const responseBody = {
    mode: "offline",
    orderId: offlineResult.orderId,
    orderNo: offlineResult.orderNo,
    orderToken: offlineResult.orderToken,
    amountCents: offlinePayableCents,
    currency: product.currency,
    offlineNoteCode: offlineResult.offlineNoteCode,
    wechatQr: configMap["offline_pay_qr_wechat"] || "",
    alipayQr: configMap["offline_pay_qr_alipay"] || "",
  };
  if (idempotencyKey) {
    try { await saveIdempotentResponse(db, idempotencyKey, "pay_unified", offlineResult.orderId, responseBody); }
    catch (e) { console.warn("[idempotency] failed to save response for key", idempotencyKey, e); }
  }

  return ok(c, responseBody);
});

/** ② 支付成功回调接口（Provider 抽象层统一处理） */
payRoute.post("/pay/callback/:provider", async (c) => {
  // 限流：防日志膨胀和 DoS
  const limit = await enforceRateLimit(c, "pay_callback", 60);
  if (!limit.ok) return c.text("fail", 429);

  const providerName = c.req.param("provider");

  // 白名单校验 provider 名称
  if (!VALID_PROVIDER_NAMES.includes(providerName as typeof VALID_PROVIDER_NAMES[number])) {
    return c.text("invalid provider", 400);
  }

  const registry = createProviderRegistry(c.env);
  const provider = registry.get(providerName);
  if (!provider) {
    return c.text("provider not configured", 500);
  }

  const db = getDb(c);

  // 1. 解析回调 body → params，再交给 Provider 验签
  //    支持两种格式：
  //    - Alipay：URL-encoded form data（application/x-www-form-urlencoded）
  //    - Stripe：JSON body（text/plain）+ 需要原始 body 和 Stripe-Signature 头验签
  let callbackResult;
  try {
    const bodyText = await c.req.text();
    // 备用：以 URL-encoded 方式解析（Alipay 等传统渠道）
    const params = Object.fromEntries(new URLSearchParams(bodyText).entries());
    // 注入原始 body 和签名头，供 Stripe 等需要原始 body 验签的 Provider 使用
    params["_raw_body"] = bodyText;
    params["_stripe_signature"] = c.req.header("Stripe-Signature") || "";
    callbackResult = await provider.verifyCallback(params);
  } catch (err) {
    console.warn(`[pay_callback] ${providerName} 验签失败:`, err);
    return c.text("fail", 400);
  }

  const orderNo = callbackResult.orderNo;

  // 2. 查订单（Drizzle ORM）— 包含 amountCents 用于金额校验
  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      productId: orders.productId,
      buyerEmail: orders.buyerEmail,
      amountCents: orders.amountCents,
    })
    .from(orders)
    .where(eq(orders.orderNo, orderNo))
    .limit(1);

  if (!order) return c.text("order not found", 404);

  // 金额校验：回调金额必须与订单实际金额一致，防止支付平台篡改或中间人攻击
  if (callbackResult.amountCents !== order.amountCents) {
    await writeOrderEvent(db, order.id, "callback_amount_mismatch", "回调金额与订单金额不一致", {
      expected: order.amountCents,
      received: callbackResult.amountCents,
    });
    return c.text("fail", 400);
  }

  // 幂等：如果已处理则直接返回 success
  if (order.status === "issued" || order.status === "paid") {
    return c.text("success");
  }

  // 3. 状态守卫更新为已支付（pending → paid）— 原子 UPDATE RETURNING
  const nowStr = callbackResult.paidAt || new Date().toISOString();
  const updated = await db
    .update(orders)
    .set({ status: "paid", paymentRef: callbackResult.providerTradeNo, paidAt: nowStr })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
    .returning({ id: orders.id });

  if (updated.length === 0) {
    return c.text("success"); // 并发已更新，直接返回成功
  }

  await writeOrderEvent(db, order.id, "paid", "在线支付成功回调", {
    provider: providerName,
    trade_no: callbackResult.providerTradeNo,
  });

  // 4. 执行自动/手动发卡逻辑
  await markPaidAndIssue(db, order.id, { RESEND_API_KEY: c.env.RESEND_API_KEY, EMAIL_FROM: c.env.EMAIL_FROM });

  return c.text("success");
});

/** ③ 轮询支付状态 — 必须传入 token 参数，防止通过 UUID 枚举窃取卡密 */
payRoute.get("/pay/status/:orderId", async (c) => {
  // 限流：前端每 2.5s 轮询一次，每 IP 每分钟最多 30 次
  const limit = await enforceRateLimit(c, "pay_status", 30);
  if (!limit.ok) return fail(c, limit.message || "请求过于频繁，请稍后再试", limit.status || 429);

  const db = getDb(c);
  const orderId = c.req.param("orderId");
  const token = c.req.query("token");

  if (!token) return fail(c, "缺少 token 参数", 400);

  // 用 token hash 验证订单归属，防止 UUID 枚举（Drizzle ORM）
  const tokenHash = await hashOrderToken(token);
  const rows = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      issuedCardId: orders.issuedCardId,
      expiresAt: orders.expiresAt,
      buyerEmail: orders.buyerEmail,
      productTitle: productsTable.title,
      amountCents: orders.amountCents,
      currency: orders.currency,
      paymentProvider: orders.paymentProvider,
      accountLabel: cards.accountLabel,
      deliverySecret: cards.deliverySecret,
      deliveryNote: cards.deliveryNote,
    })
    .from(orders)
    .leftJoin(productsTable, eq(productsTable.id, orders.productId))
    .leftJoin(cards, eq(cards.id, orders.issuedCardId))
    .where(and(eq(orders.id, orderId), eq(orders.orderTokenHash, tokenHash)))
    .limit(1);

  const order = rows[0];
  if (!order) return fail(c, "订单不存在", 404);

  // 若过期自动触发作废
  const { expired: wasExpired } = await checkAndExpireOrder(db, orderId, order.expiresAt, order.status, { RESEND_API_KEY: c.env?.RESEND_API_KEY, EMAIL_FROM: c.env?.EMAIL_FROM }, { orderNo: order.orderNo || "", productTitle: order.productTitle || "", buyerEmail: order.buyerEmail || "" });
  if (wasExpired) {
    return ok(c, { orderId, orderNo: order.orderNo, status: "expired" });
  }

  // ── USDT 链上交易检查 ──
  // 当订单为 USDT 支付且状态为 pending 时，主动查询链上入账。
  // 匹配成功后自动更新订单状态并触发 markPaidAndIssue。
  if (order.status === "pending" && order.paymentProvider === "usdt_trc20") {
    try {
      const paid = await checkTrc20Transaction(
        db, orderId, order.orderNo || "", order.amountCents || 0,
        c.env as AppEnv["Bindings"],
      );
      if (paid) {
        // 链上交易已确认，更新状态后调用 markPaidAndIssue 发卡
        await markPaidAndIssue(db, orderId, { RESEND_API_KEY: c.env?.RESEND_API_KEY, EMAIL_FROM: c.env?.EMAIL_FROM }, c.get("executionCtx"));
        // 重新读取订单获取最新状态
        return ok(c, { orderId, orderNo: order.orderNo, status: "issued" });
      }
    } catch (err) {
      console.warn(`[pay_status] USDT chain check failed for ${orderId}:`, err);
      // 链上查询失败不阻塞用户，返回当前状态即可
    }
  }

  const responseBody: Record<string, unknown> = {
    orderId,
    orderNo: order.orderNo,
    status: order.status,
    productTitle: order.productTitle || "",
    amountCents: order.amountCents || 0,
    currency: order.currency || "CNY",
  };

  if (order.status === "issued" && order.accountLabel) {
    responseBody["delivery"] = {
      accountLabel: order.accountLabel,
      deliverySecret: order.deliverySecret,
      deliveryNote: order.deliveryNote || "",
    };
  }

  return ok(c, responseBody);
});

/** ③-2 线下支付确认：用户填写付款流水号后四位 + 订单凭证 token（防恶击知识证明） */
payRoute.post("/pay/offline/confirm", async (c) => {
  // 限流：每 IP 每分钟最多 5 次，防止暴力枚举 4 位流水号（仅 10000 种组合）
  const limit = await enforceRateLimit(c, "pay_offline_confirm", 5);
  if (!limit.ok) return fail(c, limit.message || "请求过于频繁，请稍后再试", limit.status || 429);

  const db = getDb(c);
  const schema = z.object({
    orderId: z.string().uuid(),
    orderToken: z.string().min(1).max(200),
    payRefLast4: z.string().regex(/^\d{4}$/, "请输入4位纯数字"),
  });

  const body = schema.safeParse(await safeJsonBody(c));
  if (!body.success) return fail(c, "请求参数无效", 400, body.error.flatten());

  // 用 token hash 验证订单归属，防止仅凭 orderId (UUID) 枚举确认付款
  const tokenHash = await hashOrderToken(body.data.orderToken);
  const [order] = await db
    .select({ id: orders.id, status: orders.status, paymentMethod: orders.paymentMethod })
    .from(orders)
    .where(and(eq(orders.id, body.data.orderId), eq(orders.orderTokenHash, tokenHash)))
    .limit(1);

  if (!order) return fail(c, "订单不存在或凭证无效", 404);
  if (order.paymentMethod !== "offline") return fail(c, "非线下支付订单", 400);
  if (!["pending", "paid"].includes(order.status)) return fail(c, "订单状态不可更改", 409);

  // 保存付款流水号后四位到 payment_ref（Drizzle ORM）
  await db
    .update(orders)
    .set({ paymentRef: `last4:${body.data.payRefLast4}` })
    .where(eq(orders.id, body.data.orderId));

  await writeOrderEvent(db, body.data.orderId, "offline_confirm", `用户确认付款，流水号后四位: ${body.data.payRefLast4}`);
  await writeRequestLog(c, "pay_offline_confirm", 200, limit.ipHash);

  return ok(c, { confirmed: true });
});

/** ④ 线下支付下单（无需在线支付平台，管理员手动确认） */
payRoute.post("/pay/offline", async (c) => {
  // 限流：每 IP 每分钟最多 5 次（降低防库存耗尽 DoS：每单锁卡 30 分钟，8 次可耗尽小库存）
  const limit = await enforceRateLimit(c, "pay_offline", 5);
  if (!limit.ok) return fail(c, limit.message || "请求过于频繁，请稍后再试", limit.status || 429);

  const body = PayOrderSchema.safeParse(await safeJsonBody(c));
  if (!body.success) {
    await writeRequestLog(c, "pay_offline", 400, limit.ipHash);
    return fail(c, "请求参数无效", 400, body.error.flatten());
  }

  // Turnstile 校验
  const turnstile = await verifyTurnstile(c, body.data.turnstileToken);
  if (!turnstile.ok) {
    await writeRequestLog(c, "pay_offline", 403, limit.ipHash);
    return fail(c, turnstile.message || "安全校验失败", 403);
  }

  // 幂等 Key：重复提交返回上次响应，避免重复下单
  const db = getDb(c);
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (idempotencyKey) {
    const idem = await checkIdempotency(db, idempotencyKey, "pay_offline");
    if (!idem.shouldProceed && idem.cachedResponse) return c.json(JSON.parse(idem.cachedResponse), 200);
  }

  // 查商品
  const product = await getProduct(db, body.data.productId);
  if (!product) return fail(c, "商品不存在或已下架", 404);
  if (Number(product.stock) < 1) return fail(c, "当前商品库存不足", 409);

  // 可选优惠码：quote 但暂不 consume
  const quote = await quoteCoupon(db, product.priceCents, product.id, body.data.couponCode || "");
  const payableCents = quote.valid ? quote.payableCents : product.priceCents;

  // 复用共享函数创建线下订单
  const issueMode = VALID_ISSUE_MODES.includes(product.issueMode) ? product.issueMode : "manual";
  let offlineResult: Awaited<ReturnType<typeof createOfflineOrder>>;
  try {
    offlineResult = await createOfflineOrder(
      db, product, body.data.buyerEmail.trim(),
      payableCents, quote.valid ? quote.discountCents : 0,
      issueMode, normalizeCode(body.data.campaignCode), normalizeCode(body.data.referralCode),
      normalizeCode(body.data.couponCode),
      limit.ipHash, c.req.header("user-agent") || "",
      { RESEND_API_KEY: c.env.RESEND_API_KEY, EMAIL_FROM: c.env.EMAIL_FROM },
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "当前商品库存不足") {
      return fail(c, "当前商品库存不足", 409);
    }
    throw new Error("订单创建失败，请稍后重试");
  }

  // 注意：coupon 在管理员确认付款时（markPaidAndIssue）才消耗，防止管理员拒绝后 coupon 无法回退

  const origin = getOrigin(c);
  const lookupUrl = `${origin}/lookup?t=${offlineResult.orderToken}`;

  await writeRequestLog(c, "pay_offline", 201, limit.ipHash);

  const responseBody = {
    orderId: offlineResult.orderId,
    orderNo: offlineResult.orderNo,
    orderToken: offlineResult.orderToken,
    lookupUrl,
    amountCents: payableCents,
    currency: product.currency,
    offlineNoteCode: offlineResult.offlineNoteCode,
  };
  if (idempotencyKey) {
    try { await saveIdempotentResponse(db, idempotencyKey, "pay_offline", offlineResult.orderId, responseBody); }
    catch (e) { console.warn("[idempotency] failed to save response for key", idempotencyKey, e); }
  }

  return ok(c, responseBody);
});

/* ===== 工具函数 ===== */

export function createPayOrderNo(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `P${ts}${rand}`;
}

/** 生成 6 位纯数字付款备注码，用于线下支付对账（6 位空间 900,000，低频场景碰撞概率极低） */
export function createOfflineNoteCode(): string {
  const array = new Uint8Array(4);
  crypto.getRandomValues(array);
  const val = ((array[0] << 24) | (array[1] << 16) | (array[2] << 8) | array[3]) >>> 0;
  return String((val % 900000) + 100000);
}