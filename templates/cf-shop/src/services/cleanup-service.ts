/**
 * 过期订单懒加载清理服务
 *
 * 由 GitHub Actions 定时任务（每 2 小时）调用 /admin/cleanup 触发执行：
 * 1. 将超时未支付的 pending 订单标记为 expired
 * 2. 释放这些订单关联的 Soft Lock 卡密
 * 3. 兜底：释放所有 lock_expires_at 已过期但仍为 locked 的卡密
 *
 * 设计原则：
 * - 幂等：多次执行结果一致
 * - 安全：只处理 pending 状态订单，只释放过期 locked 卡密
 *
 * 使用 Drizzle ORM 进行所有数据库操作，不再依赖原始 SQL。
 */

import type { DbType } from "../db/client";
import { eq, and, lt, isNotNull, sql } from "drizzle-orm";
import { orders, products, cards, cardLogs } from "../db/schema";
import { checkAndExpireOrder } from "./order-service";

/** 清理结果 */
export interface CleanupResult {
  /** 标记为 expired 的订单数 */
  expiredOrders: number;
  /** 释放的 locked 卡密数 */
  releasedCards: number;
}

/**
 * 释放所有 lock_expires_at 已过期的 locked 卡密（兜底机制）。
 *
 * 正常情况下，cleanupExpiredOrders 在过期订单时会释放关联卡密。
 * 但存在卡密遗漏释放的场景（例如订单已被其他流程标记为 expired、
 * 或上一次定时任务执行时卡密释放失败）。
 * 此兜底步骤直接扫描 cards 表，确保不遗留僵尸 locked 卡密。
 */
async function releaseOrphanedLockedCards(db: DbType): Promise<number> {
  const now = new Date().toISOString();

  // 查找所有 lock_expires_at 已过期但仍为 locked 的卡密
  const orphaned = await db
    .select({ id: cards.id, lockedOrderId: cards.lockedOrderId })
    .from(cards)
    .where(and(
      eq(cards.status, "locked"),
      isNotNull(cards.lockExpiresAt),
      lt(cards.lockExpiresAt, now),
    ));

  if (orphaned.length === 0) return 0;

  // 逐条释放并写入审计日志（兜底释放，无关联订单）
  for (const card of orphaned) {
    await db
      .update(cards)
      .set({
        status: "available",
        lockedOrderId: null,
        lockExpiresAt: null,
      })
      .where(and(eq(cards.id, card.id), eq(cards.status, "locked")));
    // 写入审计日志，失败不影响主流程
    await db.insert(cardLogs).values({
      id: crypto.randomUUID(),
      cardId: card.id,
      action: "released_orphaned",
      orderId: "",
      operator: "system",
      detail: `定时任务兜底释放僵尸 locked 卡密（原锁定订单: ${card.lockedOrderId || "unknown"}）`,
      createdAt: new Date().toISOString(),
    }).catch(() => {
      console.warn(`[card_logs] failed to write orphaned release log for card ${card.id}`);
    });
  }

  return orphaned.length;
}

/**
 * 清理过期订单：将 expires_at < now 且 status = 'pending' 的订单标记为 expired，
 * 同时释放关联的 Soft Lock 卡密，并发送过期邮件通知买家。
 * 最后执行兜底步骤：释放所有过期但仍为 locked 的卡密。
 *
 * @param env 环境变量（用于发送邮件通知），由 /admin/cleanup 端点传入
 */
export async function cleanupExpiredOrders(
  db: DbType,
  env?: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  executionCtx?: ExecutionContext
): Promise<CleanupResult> {
  const now = new Date().toISOString();

  // 1. 查找所有已过期但仍为 pending 的订单（含买家邮箱和商品名，用于发邮件）
  const expired = await db
    .select({
      id: orders.id,
      status: orders.status,
      expiresAt: orders.expiresAt,
      orderNo: orders.orderNo,
      buyerEmail: orders.buyerEmail,
      productTitle: products.title,
    })
    .from(orders)
    .innerJoin(products, eq(products.id, orders.productId))
    .where(and(
      eq(orders.status, "pending"),
      lt(orders.expiresAt, now),
      sql`${orders.expiresAt} != ''`
    ));

  let expiredOrders = 0;
  let releasedCards = 0;

  // 2. 逐条使用 checkAndExpireOrder 处理（复用发邮件逻辑，保证与 /pay/status 行为一致）
  for (const order of expired) {
    const result = await checkAndExpireOrder(
      db, order.id, order.expiresAt, order.status, env,
      { orderNo: order.orderNo || "", productTitle: order.productTitle || "", buyerEmail: order.buyerEmail || "" },
      executionCtx
    );
    if (result.expired) {
      expiredOrders++;
      releasedCards += result.releasedCards;
    }
  }

  // 3. 兜底：释放所有 lock_expires_at 已过期的僵尸 locked 卡密
  const orphanedReleased = await releaseOrphanedLockedCards(db);
  releasedCards += orphanedReleased;

  return { expiredOrders, releasedCards };
}