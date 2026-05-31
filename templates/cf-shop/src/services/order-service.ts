import type { Context } from "hono";
import type { AppEnv, IssueMode } from "../bindings";
import type { DbType } from "../db/client";
import { getDb, getOrigin, normalizeCode } from "../lib/http";
import { createOrderNo, createOrderToken, hashOrderToken } from "../lib/token";
import { getProduct } from "./product-service";
import { consumeCoupon, getCoupon, quoteCoupon } from "./coupon-service";
import { issueAvailableCard, releaseIssuedCard, lockCardForOrder, releaseLockedCardByOrder } from "./issue-service";
import type { IssuedCard } from "./issue-service";
import { writeOrderEvent } from "./audit-service";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { orders, products, cards, coupons, referralEvents } from "../db/schema";

/**
 * 检查并作废过期订单。
 * 幂等操作：使用 Drizzle ORM 条件 UPDATE + RETURNING 只在当前仍为 pending/paid 时才作废，
 * 防止并发覆盖已发卡状态。
 * 被 /pay/status 轮询、markPaidAndIssue 和 cleanup-service 共用。
 *
 * @returns { expired, releasedCards } — expired 为 true 表示本次调用成功将订单标记为 expired；
 *        releasedCards 为释放的卡密数量（仅在 expired=true 时非零）
 */
export async function checkAndExpireOrder(
  db: DbType,
  orderId: string,
  expiresAt: string | null,
  currentStatus: string,
  env?: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  orderInfo?: { orderNo: string; productTitle: string; buyerEmail: string },
  executionCtx?: ExecutionContext
): Promise<{ expired: boolean; releasedCards: number }> {
  if (!expiresAt || new Date(expiresAt).getTime() >= Date.now() || !["pending", "paid"].includes(currentStatus)) {
    return { expired: false, releasedCards: 0 };
  }
  const result = await db.update(orders).set({ status: 'expired' }).where(and(eq(orders.id, orderId), or(eq(orders.status, 'pending'), eq(orders.status, 'paid')))).returning({id: orders.id});
  if (result.length > 0) {
    const releasedCards = await releaseLockedCardByOrder(db, orderId);
    await writeOrderEvent(db, orderId, "expired", "订单已过期，系统自动作废");
    // 订单过期后发邮件通知买家（异步，不阻塞主流程）
    if (env?.RESEND_API_KEY && orderInfo?.buyerEmail && orderInfo.buyerEmail.includes("@")) {
      const { sendEmail } = await import("./email-service");
      const emailPromise = sendEmail(db, env, {
        to: orderInfo.buyerEmail,
        template: "order_expired",
        templateData: {
          orderNo: orderInfo.orderNo || "",
          productName: orderInfo.productTitle || "",
        },
        orderId
      });
      if (executionCtx) {
        executionCtx.waitUntil(emailPromise);
      } else {
        emailPromise.catch((e) => console.warn("[email] failed to send expired notification:", e));
      }
    }
    return { expired: true, releasedCards };
  }
  return { expired: false, releasedCards: 0 };
}

export type CreateOrderInput = {
  productId?: string;
  buyerContact?: string;
  buyerEmail: string;  // 下单时必填（Zod 强制非空）
  couponCode?: string;
  campaignCode?: string;
  referralCode?: string;
};

export type OrderSummaryRow = {
  id: string;
  orderNo: string;
  productId: string;
  productTitle: string;
  /**
   * 买家联系方式。用途因支付渠道而异：
   * - 线上支付：格式为 `pay:{orderNo后8位}`，用于支付回调对账
   * - 线下支付：格式为 6 位纯数字备注码，用于管理员确认收款时对账
   * - 直接发卡（/orders）：用户填写的联系方式，用于买家沟通
   */
  buyerContact: string;
  buyerEmail: string;
  amountCents: number;
  discountCents: number;
  currency: string;
  status: string;
  issueMode: IssueMode;
  issuedCardId: string | null;
  campaignCode: string;
  referralCode: string;
  couponCode: string;
  createdAt: string;
  paidAt: string | null;
  issuedAt: string | null;
  // 卡密交付字段（通过 LEFT JOIN cards 获取）
  accountLabel: string | null;
  deliverySecret: string | null;
  deliveryNote: string | null;
};

export function publicOrder(row: OrderSummaryRow, delivery?: unknown) {
  return {
    id: row.id,
    orderNo: row.orderNo,
    productId: row.productId,
    productTitle: row.productTitle,
    buyerContact: row.buyerContact,
    buyerEmail: row.buyerEmail,
    amountCents: row.amountCents,
    discountCents: row.discountCents,
    currency: row.currency,
    status: row.status,
    issueMode: row.issueMode,
    campaignCode: row.campaignCode,
    referralCode: row.referralCode,
    couponCode: row.couponCode,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    issuedAt: row.issuedAt,
    ...(delivery ? { delivery } : {})
  };
}

/** 订单查询公共 select 投影（含卡密交付字段） */
const orderSummarySelect = {
  id: orders.id,
  orderNo: orders.orderNo,
  productId: orders.productId,
  productTitle: products.title,
  buyerContact: orders.buyerContact,
  buyerEmail: orders.buyerEmail,
  amountCents: orders.amountCents,
  discountCents: orders.discountCents,
  currency: orders.currency,
  status: orders.status,
  issueMode: orders.issueMode,
  issuedCardId: orders.issuedCardId,
  campaignCode: orders.campaignCode,
  referralCode: orders.referralCode,
  couponCode: orders.couponCode,
  createdAt: orders.createdAt,
  paidAt: orders.paidAt,
  issuedAt: orders.issuedAt,
  accountLabel: cards.accountLabel,
  deliverySecret: cards.deliverySecret,
  deliveryNote: cards.deliveryNote,
};

/**
 * 构建订单查询：JOIN products + LEFT JOIN cards，返回 OrderSummaryRow。
 * 调用方通过回调添加额外的 join / where / orderBy / limit。
 */
function selectOrderSummary(db: DbType) {
  return db
    .select(orderSummarySelect)
    .from(orders)
    .innerJoin(products, eq(products.id, orders.productId))
    .leftJoin(cards, and(eq(cards.id, orders.issuedCardId), eq(cards.issuedOrderId, orders.id)));
}

/** 从查询结果提取第一行并转为公开订单对象 */
function firstOrder(rows: Record<keyof OrderSummaryRow, OrderSummaryRow[keyof OrderSummaryRow] | null>[]): ReturnType<typeof publicOrder> | null {
  const row = rows[0];
  if (!row) return null;
  const delivery = (row.status === "issued" && row.accountLabel)
    ? { accountLabel: row.accountLabel, deliverySecret: row.deliverySecret, deliveryNote: row.deliveryNote }
    : undefined;
  return publicOrder(row as OrderSummaryRow, delivery);
}

export async function createOrder(c: Context<AppEnv>, input: CreateOrderInput, ipHash: string) {
  const db = getDb(c);
  const ctx = c.get("executionCtx") as ExecutionContext | undefined;
  // 订单主流程必须保持非常薄：先确认商品，再校验折扣码，最后按发卡模式进入 direct/manual。
  const coupon = await getCoupon(db, input.couponCode);
  const userProvidedCode = !!input.couponCode?.trim();
  const resolvedProductId = input.productId || coupon?.productId || "";
  if (!resolvedProductId) {
    // 区分三种场景：折扣码不存在 / 折扣码未绑定商品 / 根本没传商品和折扣码
    if (userProvidedCode && !coupon) {
      return { ok: false as const, status: 400, message: "折扣码不存在" };
    }
    if (coupon && !coupon.productId) {
      return { ok: false as const, status: 400, message: "该折扣码未绑定商品" };
    }
    return { ok: false as const, status: 400, message: "请选择商品" };
  }
  const product = await getProduct(db, resolvedProductId);
  if (!product) return { ok: false as const, status: 404, message: "商品不存在或已下架" };
  // 校验发卡模式枚举值，防止数据库中存入非法值导致后续逻辑异常
  const validIssueModes: IssueMode[] = ["direct", "manual"];
  if (!product.issueMode || !validIssueModes.includes(product.issueMode)) {
    return { ok: false as const, status: 400, message: "商品发卡模式配置异常，请联系管理员" };
  }
  const issueMode = product.issueMode;
  const quote = await quoteCoupon(db, product.priceCents, product.id, input.couponCode);
  if (!quote.valid) return { ok: false as const, status: 403, message: quote.message };
  const orderId = crypto.randomUUID();
  const orderNo = createOrderNo();
  const orderToken = createOrderToken();
  const orderTokenHash = await hashOrderToken(orderToken);
  const userAgent = c.req.header("user-agent") || "";
  const campaignCode = normalizeCode(input.campaignCode);
  const referralCode = normalizeCode(input.referralCode);
  const couponCode = normalizeCode(quote.couponCode);
  const buyerContact = input.buyerContact?.trim() || (couponCode ? `redeem:${couponCode}` : "");
  const status = issueMode === "direct" ? "issued" : "pending";
  const origin = getOrigin(c);

  if (issueMode !== "direct") {
    // manual/webhook 只创建待处理订单，不提前发卡；后续由管理员或支付回调触发原子发卡。
    const expiresAtStr = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // 软锁定卡密以防超卖
    const lockedCard = await lockCardForOrder(db, orderId, product.id, expiresAtStr);
    if (!lockedCard) {
      return { ok: false as const, status: 409, message: "当前商品库存不足" };
    }

    try {
      const nowStr = new Date().toISOString();
      await db.insert(orders).values({
        id: orderId,
        orderNo,
        productId: product.id,
        buyerContact,
        buyerEmail: (input.buyerEmail || "").trim(),
        amountCents: product.priceCents,
        discountCents: quote.discountCents,
        currency: product.currency,
        status,
        paymentMethod: "",
        paymentRef: "",
        issueMode,
        orderTokenHash,
        campaignCode,
        referralCode,
        couponCode,
        ipHash,
        userAgent,
        createdAt: nowStr,
        expiresAt: expiresAtStr,
      });
    } catch (err) {
      await releaseLockedCardByOrder(db, orderId);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[createOrder] manual insert failed", msg, (err as Error)?.stack);
      throw new Error("订单创建失败，请稍后重试: " + msg);
    }

    // 注意：coupon 在管理员确认付款时（markPaidAndIssue）才消耗，防止管理员拒绝后 coupon 无法回退
    await writeOrderEvent(db, orderId, "created", "订单已创建，等待确认发卡");
    // manual 模式下单后发邮件通知买家（异步，不阻塞主流程）
    const buyerEmail = input.buyerEmail?.trim() || "";
    if (c.env?.RESEND_API_KEY && buyerEmail && buyerEmail.includes("@")) {
      const { sendEmail } = await import("./email-service");
      c.get("executionCtx").waitUntil(
        sendEmail(db, { RESEND_API_KEY: c.env.RESEND_API_KEY, EMAIL_FROM: c.env.EMAIL_FROM }, {
          to: buyerEmail,
          template: "order_pending",
          templateData: {
            orderNo,
            productName: product.title,
            price: `${((quote.payableCents) / 100).toFixed(2)}`,
            currency: product.currency,
          },
          orderId
        }).catch((e) => console.warn("[email] failed to send pending notification:", e))
      );
    }
    return {
      ok: true as const,
      order: {
        id: orderId,
        orderNo,
        status,
        issueMode,
        amountCents: quote.payableCents,
        currency: product.currency,
        orderToken,
        lookupUrl: `${origin}/lookup?token=${encodeURIComponent(orderToken)}`,
        nextAction: "请按页面说明完成付款或联系管理员"
      }
    };
  }

  const issued = await issueAvailableCard(db, orderId, product.id);
  if (!issued) return { ok: false as const, status: 409, message: "当前商品库存不足" };

  try {
    // direct 模式只用于折扣码免单/演示/低风险商品。先用 issueAvailableCard 原子领卡，再写订单；
    // 如果订单写入失败，立即补偿释放卡密，避免库存被无订单占用。
    const nowStr = new Date().toISOString();
    await db.insert(orders).values({
      id: orderId,
      orderNo,
      productId: product.id,
      buyerContact,
      buyerEmail: (input.buyerEmail || "").trim(),
      amountCents: product.priceCents,
      discountCents: quote.discountCents,
      currency: product.currency,
      status: "issued",
      paymentMethod: "",
      paymentRef: "",
      issueMode,
      orderTokenHash,
      issuedCardId: issued.id,
      campaignCode,
      referralCode,
      couponCode,
      ipHash,
      userAgent,
      createdAt: nowStr,
      issuedAt: nowStr,
    });
  } catch (error) {
    await releaseIssuedCard(db, issued.id, orderId);
    throw new Error("订单创建失败，请稍后重试");
  }

  const couponResult = couponCode ? await consumeCoupon(db, couponCode) : null;
  if (couponCode && (!couponResult || !couponResult.success)) {
    await releaseIssuedCard(db, issued.id, orderId);
    await db.update(orders).set({ status: "failed" }).where(eq(orders.id, orderId));
    return { ok: false as const, status: 409, message: "优惠码已被他人使用或已失效，请重试" };
  }
  await writeOrderEvent(db, orderId, "issued", "订单创建并完成自动发卡", { cardId: issued.id });
  if (referralCode) {
    await db.insert(referralEvents).values({
      id: crypto.randomUUID(),
      referralCode,
      orderId,
      buyerContact,
      status: "created",
      createdAt: new Date().toISOString(),
    });
  }

  // direct 模式发卡成功后发邮件通知（异步，不阻塞主流程）
  const buyerEmail = input.buyerEmail?.trim() || "";
  if (c.env?.RESEND_API_KEY && buyerEmail && buyerEmail.includes("@")) {
    const { sendEmail } = await import("./email-service");
    c.get("executionCtx").waitUntil(
      sendEmail(db, { RESEND_API_KEY: c.env.RESEND_API_KEY, EMAIL_FROM: c.env.EMAIL_FROM }, {
        to: buyerEmail,
        template: "order_issued",
        templateData: {
          orderNo,
          productName: product.title,
          accountLabel: issued.accountLabel,
          deliverySecret: issued.deliverySecret,
          deliveryNote: issued.deliveryNote || ""
        },
        orderId
      }).catch((e) => console.warn("[email] failed to send direct issue notification:", e))
    );
  }

  return {
    ok: true as const,
    order: {
      id: orderId,
      orderNo,
      status,
      issueMode,
      amountCents: quote.payableCents,
      currency: product.currency,
      orderToken,
      lookupUrl: `${origin}/lookup?token=${encodeURIComponent(orderToken)}`,
      delivery: {
        accountLabel: issued.accountLabel,
        deliverySecret: issued.deliverySecret,
        deliveryNote: issued.deliveryNote
      }
    }
  };
}

export async function getOrderByToken(db: DbType, token: string) {
  const tokenHash = await hashOrderToken(token);
  const rows = await selectOrderSummary(db)
    .where(eq(orders.orderTokenHash, tokenHash));
  return firstOrder(rows);
}

export async function getOrderByCouponCode(db: DbType, couponCode: string) {
  const code = normalizeCode(couponCode);
  if (!code) return null;
  // JOIN coupons 验证折扣码存在；对多用途折扣码返回最近一笔订单。
  const rows = await selectOrderSummary(db)
    .innerJoin(coupons, eq(sql`lower(${coupons.code})`, sql`lower(${orders.couponCode})`))
    .where(eq(sql`lower(${orders.couponCode})`, code))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  return firstOrder(rows);
}

export async function getOrderByNo(db: DbType, orderNo: string) {
  const rows = await selectOrderSummary(db)
    .where(eq(orders.orderNo, orderNo));
  return firstOrder(rows);
}

export async function getOrdersByEmail(db: DbType, email: string) {
  // 返回简要信息（不含卡密），让用户选择查哪一笔
  const rows = await selectOrderSummary(db)
    .where(eq(sql`lower(${orders.buyerEmail})`, email.toLowerCase()))
    .orderBy(desc(orders.createdAt))
    .limit(10);
  return rows.map(row => publicOrder(row as OrderSummaryRow));
}

/** 标记订单已支付并执行发卡（支付回调/管理员确认共用） */
export async function markPaidAndIssue(
  db: DbType,
  orderId: string,
  env?: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  executionCtx?: ExecutionContext
) {
  // 查订单 + 商品信息
  const orderRows = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      productId: orders.productId,
      buyerEmail: orders.buyerEmail,
      status: orders.status,
      expiresAt: orders.expiresAt,
      couponCode: orders.couponCode,
      productTitle: products.title,
    })
    .from(orders)
    .innerJoin(products, eq(products.id, orders.productId))
    .where(eq(orders.id, orderId));

  const order = orderRows[0];
  if (!order) return { ok: false as const, status: 404, message: "订单不存在" };

  // 检查是否已过期（使用公共函数，与 /pay/status 轮询逻辑一致）
  const { expired: wasExpired } = await checkAndExpireOrder(db, order.id, order.expiresAt, order.status, env, { orderNo: order.orderNo || "", productTitle: order.productTitle, buyerEmail: order.buyerEmail });
  if (wasExpired) {
    return { ok: false as const, status: 410, message: "订单已过期" };
  }

  if (order.status === "issued") return { ok: true as const, alreadyIssued: true };
  if (!["pending", "paid"].includes(order.status)) return { ok: false as const, status: 409, message: "当前订单状态不可发卡" };

  // ── 先原子锁定订单，再发卡 ──
  // 关键：只接受 "pending" → "paid" 转换。如果订单已是 "paid"，说明上一次调用
  // 在发卡前崩溃了，需要恢复（见下方 recovery 分支）。
  // 并发时只有一个请求能成功锁定，失败者直接返回，不会触发多余的发卡。
  const nowStr = new Date().toISOString();
  const locked = await db
    .update(orders)
    .set({ status: "paid", paidAt: nowStr })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
    .returning({ id: orders.id });

  let issued;
  if (locked.length > 0) {
    // 正常路径：订单从 pending 转为 paid，安全发卡
    issued = await issueAvailableCard(db, order.id, order.productId);
  } else {
    // 订单不是 "pending" —— 可能是 "paid"（上次崩溃）或 "issued"（已完成）
    // 关键：重新读取最新状态，防止并发场景下重复发卡。
    // 并发场景：回调先锁定订单（pending→paid），发卡成功但尚未更新订单为 issued；
    // 此时管理员也进入恢复路径，读到 paid。必须先检查 issuedCardId 是否已有效，
    // 而不是盲目 release + re-issue。
    const [current] = await db
      .select({ status: orders.status, issuedCardId: orders.issuedCardId })
      .from(orders)
      .where(eq(orders.id, order.id));
    if (!current) return { ok: false as const, status: 404, message: "订单不存在" };
    if (current.status === "issued") return { ok: true as const, alreadyIssued: true };

    // 无论当前状态如何，只要 issuedCardId 存在且对应卡密有效，就返回已有卡密。
    // 这防止了并发回调/管理员场景下的重复发卡：
    // 回调发卡后设置了 issuedCardId 但尚未更新 status，管理员恢复路径读到 paid + issuedCardId，
    // 直接返回已有卡密而不是再发一张。
    if (current.issuedCardId) {
      const [existingCard] = await db
        .select({ id: cards.id, accountLabel: cards.accountLabel, deliverySecret: cards.deliverySecret, deliveryNote: cards.deliveryNote })
        .from(cards)
        .where(and(eq(cards.id, current.issuedCardId), eq(cards.issuedOrderId, order.id)));
      if (existingCard) {
        await db.update(orders).set({ status: "issued", issuedAt: nowStr }).where(eq(orders.id, order.id));
        return { ok: true as const, card: existingCard as IssuedCard };
      }
    }

    // 恢复路径：订单卡在 "paid" 且确实无有效已发卡记录，需要重新发卡
    if (current.status === "paid") {
      await releaseLockedCardByOrder(db, order.id);
      issued = await issueAvailableCard(db, order.id, order.productId);
    } else {
      return { ok: false as const, status: 409, message: "当前订单状态不可发卡" };
    }
  }
  if (!issued) {
    // 极端情况：锁定订单后库存耗尽（如并发发卡），回滚订单状态并释放可能遗留的卡锁
    await db.update(orders).set({ status: "pending", paidAt: null })
      .where(eq(orders.id, order.id));
    await releaseLockedCardByOrder(db, order.id);
    return { ok: false as const, status: 409, message: "当前商品库存不足" };
  }

  // 标记订单为已发卡
  await db
    .update(orders)
    .set({ status: "issued", issuedCardId: issued.id, issuedAt: nowStr })
    .where(eq(orders.id, order.id));

  // 消耗 coupon（下单时未消耗，在管理员确认付款时消耗，防止管理员拒绝后 coupon 无法回退）
  if (order.couponCode) {
    const couponResult = await consumeCoupon(db, order.couponCode);
    // coupon 消耗失败（并发扣减）不应回滚 order 状态，仅记录警告——管理员可人工介入
    if (!couponResult || !couponResult.success) {
      console.warn(`[markPaidAndIssue] coupon ${order.couponCode} consume failed for order ${orderId}, manual intervention may be needed`);
      await writeOrderEvent(db, order.id, "coupon_consume_failed", `优惠码 ${order.couponCode} 消耗失败，需要管理员人工核对使用次数`);
    }
  }

  await writeOrderEvent(db, order.id, "issued", "管理员确认付款并发卡", { cardId: issued.id });

  // 发卡成功后发邮件通知（异步，不阻塞主流程）
  if (env?.RESEND_API_KEY && order.buyerEmail && order.buyerEmail.includes("@")) {
    const { sendEmail } = await import("./email-service");
    const emailPromise = sendEmail(db, env, {
      to: order.buyerEmail,
      template: "order_issued",
      templateData: {
        orderNo: order.orderNo || "",
        productName: order.productTitle,
        accountLabel: issued.accountLabel,
        deliverySecret: issued.deliverySecret,
        deliveryNote: issued.deliveryNote || ""
      },
      orderId: order.id
    });
    if (executionCtx) {
      executionCtx.waitUntil(emailPromise);
    } else {
      emailPromise.catch((e) => console.warn("[email] failed to send issue notification:", e));
    }
  }

  return { ok: true as const, card: issued };
}