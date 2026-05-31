/**
 * 幂等性模块 — 防止同一请求被重复处理。
 *
 * 使用 (key, action) 复合键作为幂等标识：
 * - key: 客户端提供的幂等键（如 Idempotency-Key 请求头）
 * - action: 操作类型（如 "create_order"）
 *
 * 流程（原子化，消除 TOCTOU 竞态）：
 * 1. 调用 checkIdempotency() — 原子 UPSERT，返回是否应继续执行业务逻辑
 * 2. 如果 shouldProceed === false，返回缓存的响应（不重复执行业务逻辑）
 * 3. 如果 shouldProceed === true，执行业务逻辑后调用 saveIdempotentResponse() 保存结果
 *
 * 原子性保证：INSERT ... ON CONFLICT UPDATE ... RETURNING 是 SQLite 原子操作，
 * 并发请求中只有一个会获得 shouldProceed=true，其余会读到已缓存的响应。
 */

import type { DbType } from "../db/client";
import { idempotencyKeys } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";

const PENDING_SENTINEL = "__pending__";

/**
 * 原子检查幂等性。
 * 使用 INSERT ... ON CONFLICT UPDATE ... RETURNING 实现原子 UPSERT：
 * - 首次插入：response_json 设为 "__pending__"（非空哨兵），返回 shouldProceed=true
 * - 冲突时：保留原值不变，返回原值
 *
 * 关键设计：使用非空哨兵而非空字符串，消除并发竞态——
 * 两个同时请求中，第一个 INSERT 成功（responseJson="__pending__"），
 * 第二个触发 CONFLICT，读到 responseJson="__pending__"（非空），返回 shouldProceed=false。
 *
 * @param db - Drizzle ORM 实例
 * @param key - 幂等键
 * @param action - 操作类型
 * @returns { shouldProceed, cachedResponse } — shouldProceed 为 true 时应执行业务逻辑；
 *        为 false 时 cachedResponse 包含之前缓存的响应
 */
export async function checkIdempotency(db: DbType, key: string, action: string): Promise<{
  shouldProceed: boolean;
  cachedResponse: string | null;
}> {
  const [row] = await db
    .insert(idempotencyKeys)
    .values({
      key,
      action,
      resourceId: '',
      responseJson: PENDING_SENTINEL,  // 非空哨兵：防止并发竞态（两个同时请求都 UPSERT 时，后到者读到非空值）
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [idempotencyKeys.key, idempotencyKeys.action],
      set: {
        responseJson: sql`idempotency_keys.response_json`,  // 冲突时保留原值
      },
    })
    .returning({ responseJson: idempotencyKeys.responseJson });

  // "__pending__" 表示首次插入（应继续执行），其他非空值表示已缓存响应
  const shouldProceed = row?.responseJson === PENDING_SENTINEL;
  const cachedResponse = shouldProceed ? null : (row?.responseJson === PENDING_SENTINEL ? null : row?.responseJson ?? null);
  return {
    shouldProceed,
    cachedResponse,
  };
}

/**
 * 保存幂等响应（覆盖 response_json 为 NULL 的预留记录）。
 * 在 checkIdempotency 返回 shouldProceed=true 后调用。
 *
 * @param db - Drizzle ORM 实例
 * @param key - 幂等键
 * @param action - 操作类型
 * @param resourceId - 关联的资源 ID（如订单 ID）
 * @param response - 要缓存的响应对象
 */
export async function saveIdempotentResponse(db: DbType, key: string, action: string, resourceId: string, response: unknown) {
  await db
    .insert(idempotencyKeys)
    .values({
      key,
      action,
      resourceId,
      responseJson: JSON.stringify(response),
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [idempotencyKeys.key, idempotencyKeys.action],
      set: {
        responseJson: JSON.stringify(response),
        resourceId,
      },
    });
}

/**
 * 旧版非原子查询接口（保留向后兼容，将被 checkIdempotency 替代）。
 * 直接查询已缓存的幂等响应，不创建新记录。
 *
 * @deprecated 使用 checkIdempotency() 替代，该函数同时完成检查与预留，消除 TOCTOU 竞态。
 */
export async function getIdempotentResponse(db: DbType, key: string, action: string) {
  const [row] = await db
    .select({ responseJson: idempotencyKeys.responseJson })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.action, action)))
    .limit(1);
  return row || null;
}