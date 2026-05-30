/**
 * 订单服务
 *
 * 处理订单创建、查询、过期等核心业务逻辑。
 * 订单创建流程包含：校验 → 优惠码 → 锁卡密 → 创建订单 → 记录事件
 */

import { sql, eq } from "drizzle-orm";
import { generateUUID } from "@eforge/cf-core/crypto";
import { products, cards, orders, orderEvents, coupons } from "../db/schema";
import { ORDER_EXPIRE_MINUTES, ORDER_STATUS } from "../config";
import { lockCards, releaseCards } from "./issue-service";

/**
 * 生成订单号（S + 年月日 + 6位随机字符）
 * 例如：S20260529ABC123
 */
function generateOrderNo(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `S${date}${rand}`;
}

/**
 * 创建订单
 *
 * 流程：
 * 1. 查询商品（必须上架且有库存）
 * 2. 计算金额（含优惠码折扣）
 * 3. 锁卡密（原子操作，防并发超卖）
 * 4. 写入订单 + 事件
 *
 * @param db - 数据库实例
 * @param params - 订单参数
 * @returns 创建结果
 */
export async function createOrder(
  db: any,
  params: {
    productId: string;
    quantity: number;
    buyerEmail: string;
    couponCode?: string;
    buyerIpHash: string;
    paymentMethod?: string;
  },
) {
  // 1. 查询商品
  const productList = await db
    .select()
    .from(products)
    .where(sql`${products.id} = ${params.productId} AND ${products.enabled} = 1`)
    .limit(1);

  if (!productList.length) {
    return { ok: false, error: "商品不存在或已下架", status: 404 };
  }

  const product = productList[0];

  // 2. 检查库存
  const availableCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(cards)
    .where(sql`${cards.productId} = ${params.productId} AND ${cards.status} = 'available'`)
    .then((rows: any[]) => rows[0]?.count ?? 0);

  if (availableCount < params.quantity) {
    return { ok: false, error: `库存不足（剩余 ${availableCount} 件）`, status: 400 };
  }

  // 3. 计算金额
  let amountCents = product.priceCents * params.quantity;
  let discountCents = 0;

  // 3.1 优惠码处理
  if (params.couponCode) {
    const couponList = await db
      .select()
      .from(coupons)
      .where(sql`${coupons.code} = ${params.couponCode.toUpperCase()} AND ${coupons.enabled} = 1`)
      .limit(1);

    if (couponList.length) {
      const coupon = couponList[0];

      // 检查过期
      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        return { ok: false, error: "优惠码已过期", status: 400 };
      }

      // 检查使用次数
      if (coupon.maxUsage > 0 && coupon.usedCount >= coupon.maxUsage) {
        return { ok: false, error: "优惠码已达到使用上限", status: 400 };
      }

      // 检查最低消费
      if (coupon.minOrderCents > 0 && amountCents < coupon.minOrderCents) {
        return { ok: false, error: `订单金额需满 ¥${(coupon.minOrderCents / 100).toFixed(2)} 才能使用此优惠码`, status: 400 };
      }

      // 计算折扣
      if (coupon.discountType === "percent") {
        discountCents = Math.round(amountCents * coupon.discountValue / 100);
      } else {
        discountCents = Math.min(coupon.discountValue, amountCents);
      }

      // 增加使用次数
      await db
        .update(coupons)
        .set({ usedCount: coupon.usedCount + 1 })
        .where(eq(coupons.id, coupon.id));
    }
  }

  const paidCents = Math.max(0, amountCents - discountCents);

  // 4. 锁卡密（原子操作）
  const lockedCardIds = await lockCards(db, params.productId, params.quantity);
  if (!lockedCardIds || lockedCardIds.length < params.quantity) {
    // 锁定失败（并发竞争），回滚
    if (lockedCardIds?.length) {
      await releaseCards(db, lockedCardIds);
    }
    return { ok: false, error: "库存不足，请稍后重试", status: 400 };
  }

  // 5. 创建订单
  const orderId = generateUUID();
  const orderNo = generateOrderNo();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ORDER_EXPIRE_MINUTES * 60_000).toISOString();

  await db.insert(orders).values({
    id: orderId,
    orderNo,
    productId: params.productId,
    quantity: params.quantity,
    amountCents,
    discountCents,
    paidCents,
    buyerEmail: params.buyerEmail,
    buyerIpHash: params.buyerIpHash,
    status: ORDER_STATUS.PENDING,
    paymentMethod: params.paymentMethod || "pending",
    couponCode: params.couponCode || "",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  // 6. 记录订单事件
  await db.insert(orderEvents).values({
    id: generateUUID(),
    orderId,
    eventType: "created",
    metadataJson: JSON.stringify({
      productId: params.productId,
      quantity: params.quantity,
      amountCents,
      discountCents,
      couponCode: params.couponCode || null,
    }),
    createdAt: now,
  });

  return {
    ok: true,
    order: {
      id: orderId,
      orderNo,
      productId: params.productId,
      productName: product.name,
      quantity: params.quantity,
      amountCents,
      discountCents,
      paidCents,
      status: ORDER_STATUS.PENDING,
      expiresAt,
    },
  };
}

/**
 * 订单查询
 *
 * @param db - 数据库实例
 * @param orderNo - 订单号
 * @param email - 买家邮箱
 * @returns 订单详情（含卡密信息，仅已发放状态展示）
 */
export async function lookupOrder(db: any, orderNo: string, email: string) {
  const orderList = await db
    .select()
    .from(orders)
    .where(sql`${orders.orderNo} = ${orderNo} AND ${orders.buyerEmail} = ${email}`)
    .limit(1);

  if (!orderList.length) {
    return { ok: false, error: "订单不存在或邮箱不匹配" };
  }

  const order = orderList[0];

  // 查询关联商品名称
  const productList = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, order.productId))
    .limit(1);

  // 查询已发放的卡密（仅 issued 状态）
  let issuedCards: any[] = [];
  if (order.status === ORDER_STATUS.ISSUED) {
    issuedCards = await db
      .select({ cardData: cards.cardData, issuedAt: cards.issuedAt })
      .from(cards)
      .where(sql`${cards.lockedByOrderId} = ${order.id} AND ${cards.status} = 'issued'`);
  }

  return {
    ok: true,
    order: {
      orderNo: order.orderNo,
      productName: productList[0]?.name || "未知商品",
      quantity: order.quantity,
      amountCents: order.amountCents,
      discountCents: order.discountCents,
      paidCents: order.paidCents,
      status: order.status,
      paymentMethod: order.paymentMethod,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      cards: issuedCards.map((c: any) => ({
        cardData: c.cardData,
        issuedAt: c.issuedAt,
      })),
    },
  };
}

/**
 * 确认支付并发卡（用于支付回调、余额支付）。
 *
 * 流程：
 * 1. 原子锁定订单状态（pending → paid）
 * 2. 查询该订单已锁定的卡密
 * 3. 发放卡密（locked → issued）
 * 4. 更新订单状态为 issued
 *
 * @param db      - 数据库实例
 * @param orderId - 订单 ID
 * @param env     - 环境变量（含邮件配置，可选）
 * @returns 发卡结果
 */
export async function markPaidAndIssue(
  db: any,
  orderId: string,
  paymentTradeNo?: string,
): Promise<{ ok: boolean; status: number; message: string; alreadyIssued?: boolean }> {
  const now = new Date().toISOString();

  // 1. 查订单
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return { ok: false, status: 404, message: "订单不存在" };
  if (order.status === "issued") return { ok: true, status: 200, message: "订单已发放", alreadyIssued: true };
  if (order.status !== "pending") return { ok: false, status: 409, message: "当前订单状态不可发卡" };

  // 2. 原子锁定：pending → paid
  const locked = await db
    .update(orders)
    .set({
      status: "paid",
      paidAt: now,
      paymentTradeNo: paymentTradeNo || order.paymentTradeNo,
      updatedAt: now,
    })
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
    .returning({ id: orders.id });

  if (locked.length === 0) return { ok: false, status: 409, message: "订单已被其他操作处理" };

  // 3. 查询已锁定的卡密
  const lockedCards = await db
    .select({ id: cards.id })
    .from(cards)
    .where(sql`${cards.lockedByOrderId} = ${orderId} AND ${cards.status} = 'locked'`);

  if (lockedCards.length === 0) {
    return { ok: false, status: 409, message: "未找到已锁定的卡密" };
  }

  // 4. 发放卡密
  await issueCards(db, orderId, lockedCards.map((c: any) => c.id));

  // 5. 更新订单为已发卡
  await db
    .update(orders)
    .set({ status: "issued", updatedAt: now })
    .where(eq(orders.id, orderId));

  // 6. 记录事件
  await db.insert(orderEvents).values({
    id: generateUUID(),
    orderId,
    eventType: "issued",
    metadataJson: JSON.stringify({ paymentTradeNo, issuedAt: now }),
    createdAt: now,
  });

  return { ok: true, status: 200, message: "发卡成功" };
}

/**
 * 处理过期订单
 *
 * 遍历所有 pending 且已过期的订单，将其标记为 expired 并释放卡密。
 * 应通过定时任务或请求触发调用。
 */
export async function processExpiredOrders(db: any) {
  const now = new Date().toISOString();

  // 查询过期订单
  const expiredOrders = await db
    .select()
    .from(orders)
    .where(sql`${orders.status} = 'pending' AND ${orders.expiresAt} < ${now}`)
    .limit(100);

  for (const order of expiredOrders) {
    // 更新订单状态
    await db
      .update(orders)
      .set({ status: ORDER_STATUS.EXPIRED, updatedAt: now })
      .where(eq(orders.id, order.id));

    // 释放锁定的卡密
    await releaseCards(db, [], order.id);

    // 记录事件
    await db.insert(orderEvents).values({
      id: generateUUID(),
      orderId: order.id,
      eventType: "expired",
      metadataJson: JSON.stringify({ expiredAt: now }),
      createdAt: now,
    });
  }

  return { expired: expiredOrders.length };
}
