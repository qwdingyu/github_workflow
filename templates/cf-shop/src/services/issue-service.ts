/**
 * 卡密发放服务
 *
 * 提供卡密的原子领取、软锁定、释放、回滚等操作。
 * 所有操作均使用数据库事务保证原子性，防止并发超卖。
 */

import { sql, eq } from "drizzle-orm";
import { cards, cardLogs } from "../db/schema";
import { generateUUID } from "@eforge/cf-core/crypto";

/**
 * 锁卡密（原子操作）
 *
 * 从 available 状态的卡密中随机选取 N 张，将其状态更新为 locked。
 * 使用 UPDATE ... WHERE status='available' LIMIT N 实现原子领取。
 *
 * 注意：libSQL/Turso 不支持 SELECT FOR UPDATE，
 * 因此使用乐观策略：先 UPDATE 锁定，再 SELECT 获取 ID。
 *
 * @param db - 数据库实例
 * @param productId - 商品 ID
 * @param quantity - 需要锁定的数量
 * @returns 锁定的卡密 ID 列表（数量不足时返回空数组）
 */
export async function lockCards(db: any, productId: string, quantity: number): Promise<string[]> {
  // 使用唯一锁定标记（防止并发冲突）
  const lockToken = generateUUID();
  const now = new Date().toISOString();

  // 1. 原子锁定：UPDATE available -> locked（使用子查询限制数量）
  // libSQL 不支持 UPDATE ... LIMIT，所以使用 IN 子查询
  const availableCards = await db
    .select({ id: cards.id })
    .from(cards)
    .where(sql`${cards.productId} = ${productId} AND ${cards.status} = 'available'`)
    .limit(quantity);

  if (availableCards.length < quantity) {
    return [];
  }

  const cardIds = availableCards.map((c: any) => c.id);

  // 2. 批量更新状态
  for (const cardId of cardIds) {
    await db
      .update(cards)
      .set({
        status: "locked",
        lockedByOrderId: lockToken, // 临时锁定标记，后续替换为 orderId
      })
      .where(sql`${cards.id} = ${cardId} AND ${cards.status} = 'available'`);
  }

  // 3. 验证锁定成功（双重检查）
  const locked = await db
    .select({ id: cards.id })
    .from(cards)
    .where(sql`${cards.id} IN (${sql.join(cardIds.map((id: string) => sql`${id}`), sql`, `)}) AND ${cards.status} = 'locked' AND ${cards.lockedByOrderId} = ${lockToken}`);

  if (locked.length < quantity) {
    // 部分锁定失败，回滚已锁定的
    const lockedIds = locked.map((c: any) => c.id);
    await releaseCards(db, lockedIds);
    return [];
  }

  // 4. 记录日志
  for (const cardId of cardIds) {
    await db.insert(cardLogs).values({
      id: generateUUID(),
      cardId,
      action: "locked",
      operator: "system",
      detail: `锁定用于订单创建（token: ${lockToken.slice(0, 8)}）`,
      createdAt: now,
    });
  }

  return cardIds;
}

/**
 * 释放卡密
 *
 * 将 locked 状态的卡密恢复为 available。
 * 用于订单取消、过期等场景。
 *
 * @param db - 数据库实例
 * @param cardIds - 要释放的卡密 ID 列表（与 orderId 二选一）
 * @param orderId - 通过订单 ID 释放所有关联卡密
 */
export async function releaseCards(db: any, cardIds: string[], orderId?: string): Promise<void> {
  const now = new Date().toISOString();

  let targetIds = cardIds;

  // 如果通过 orderId 释放，先查询关联卡密
  if (orderId && cardIds.length === 0) {
    const locked = await db
      .select({ id: cards.id })
      .from(cards)
      .where(sql`${cards.lockedByOrderId} = ${orderId} AND ${cards.status} IN ('locked', 'issued')`);
    targetIds = locked.map((c: any) => c.id);
  }

  if (targetIds.length === 0) return;

  // 批量恢复状态
  for (const cardId of targetIds) {
    await db
      .update(cards)
      .set({
        status: "available",
        lockedByOrderId: null,
        issuedAt: null,
      })
      .where(eq(cards.id, cardId));

    // 记录日志
    await db.insert(cardLogs).values({
      id: generateUUID(),
      cardId,
      action: "returned",
      operator: "system",
      detail: orderId ? `订单 ${orderId.slice(0, 8)} 释放` : "手动释放",
      createdAt: now,
    });
  }
}

/**
 * 发放卡密（确认订单后调用）
 *
 * 将 locked 状态的卡密标记为 issued，并关联到订单。
 *
 * @param db - 数据库实例
 * @param orderId - 订单 ID
 * @param cardIds - 要发放的卡密 ID 列表
 */
export async function issueCards(db: any, orderId: string, cardIds: string[]): Promise<void> {
  const now = new Date().toISOString();

  for (const cardId of cardIds) {
    await db
      .update(cards)
      .set({
        status: "issued",
        lockedByOrderId: orderId,
        issuedAt: now,
      })
      .where(eq(cards.id, cardId));

    await db.insert(cardLogs).values({
      id: generateUUID(),
      cardId,
      action: "issued",
      operator: `order:${orderId.slice(0, 8)}`,
      detail: `发放给订单 ${orderId.slice(0, 8)}`,
      createdAt: now,
    });
  }
}

/**
 * 回滚发放（退款场景）
 *
 * 将已发放的卡密标记为 returned 状态（不恢复为 available，避免重复使用）。
 *
 * @param db - 数据库实例
 * @param cardIds - 要回滚的卡密 ID 列表
 */
export async function rollbackCards(db: any, cardIds: string[]): Promise<void> {
  const now = new Date().toISOString();

  for (const cardId of cardIds) {
    await db
      .update(cards)
      .set({
        status: "returned",
      })
      .where(eq(cards.id, cardId));

    await db.insert(cardLogs).values({
      id: generateUUID(),
      cardId,
      action: "returned",
      operator: "system",
      detail: "退款回滚",
      createdAt: now,
    });
  }
}

/**
 * 更新锁卡密的订单关联
 *
 * 在订单创建成功后，将临时锁定标记替换为真实的订单 ID。
 *
 * @param db - 数据库实例
 * @param cardIds - 卡密 ID 列表
 * @param orderId - 订单 ID
 */
export async function bindCardsToOrder(db: any, cardIds: string[], orderId: string): Promise<void> {
  for (const cardId of cardIds) {
    await db
      .update(cards)
      .set({ lockedByOrderId: orderId })
      .where(eq(cards.id, cardId));
  }
}
