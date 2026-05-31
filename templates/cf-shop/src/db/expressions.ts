/**
 * 共享 SQL 表达式 — 跨模块复用的 SQL 片段。
 *
 * 将重复出现的 SQL 逻辑提取为常量，避免 DRY 违规。
 */

import { sql } from "drizzle-orm";
import { cards } from "./schema";

/**
 * 可用库存计数表达式。
 *
 * 统计逻辑：
 * - status = 'available' → 直接可用
 * - status = 'locked' 且 lockExpiresAt 已过期 → 视为可回收，计入可用
 *
 * 用于 LEFT JOIN cards 后的 GROUP BY products.id 聚合查询。
 */
export const availableStockCount = sql<number>`COALESCE(
  SUM(CASE
    WHEN ${cards.status} = 'available'
       OR (${cards.status} = 'locked'
           AND ${cards.lockExpiresAt} IS NOT NULL
           AND ${cards.lockExpiresAt} < replace(datetime('now'), ' ', 'T') || 'Z')
    THEN 1
    ELSE 0
  END),
  0
)`;
