import type { DbType } from "../db/client";
import { orderEvents, adminAuditLogs } from "../db/schema";
import { sql } from "drizzle-orm";

/**
 * 写入订单事件日志
 * @param db - Drizzle ORM 实例
 * @param orderId - 订单 ID
 * @param type - 事件类型（如 issued, expired, paid）
 * @param message - 事件描述
 * @param metadata - 附加元数据
 */
export async function writeOrderEvent(db: DbType, orderId: string, type: string, message = "", metadata: unknown = {}) {
  await db.insert(orderEvents).values({
    id: crypto.randomUUID(),
    orderId,
    type,
    message,
    metadataJson: JSON.stringify(metadata),
    createdAt: new Date().toISOString(),
  });

  // 5% 概率清理超过 90 天的旧日志（fire-and-forget）
  if (Math.random() < 0.05) {
    try { db.$client.execute(`DELETE FROM order_events WHERE created_at < datetime('now', '-90 days')`).catch(() => {}); } catch { /* mock DB may not have execute */ }
  }
}

/**
 * 写入管理员审计日志
 * @param db - Drizzle ORM 实例
 * @param input - 审计日志内容
 */
export async function writeAdminAudit(db: DbType, input: {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: unknown;
  ipHash?: string;
}) {
  await db.insert(adminAuditLogs).values({
    id: crypto.randomUUID(),
    action: input.action,
    targetType: input.targetType || "",
    targetId: input.targetId || "",
    metadataJson: JSON.stringify(input.metadata || {}),
    ipHash: input.ipHash || "",
    createdAt: new Date().toISOString(),
  });

  // 5% 概率清理超过 90 天的旧日志（fire-and-forget）
  if (Math.random() < 0.05) {
    try { db.$client.execute(`DELETE FROM admin_audit_logs WHERE created_at < datetime('now', '-90 days')`).catch(() => {}); } catch { /* mock DB may not have execute */ }
  }
}