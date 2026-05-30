/**
 * cf-form 数据库 Schema
 *
 * 业务表：forms（表单定义）、submissions（提交记录）、request_logs（请求日志）
 * 公共表（幂等键、限流窗口等）由 @eforge/cf-core/db/schema 提供
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ── 公共表（从 cf-core 重导出，确保迁移脚本完整） ──
export {
  idempotencyKeys,
  rateLimitWindows,
  adminAuditLogs,
} from "@eforge/cf-core/db/schema";

// ═══════════════════════════════════════════════════════════════════════════════
// 业务表
// ═══════════════════════════════════════════════════════════════════════════════

/** 表单定义表 — 支持 JSON 驱动的动态表单 */
export const forms = sqliteTable("forms", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  formSchema: text("form_schema").notNull().default("[]"),  // JSON: 完整的表单字段定义数组
  settings: text("settings").notNull().default("{}"),       // JSON: 表单设置（submitText/successMessage 等）
  status: text("status").notNull().default("active"),       // active / draft / archived
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** 表单提交记录表 */
export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  formId: text("form_id").notNull(),          // 关联 forms 表
  formSlug: text("form_slug").notNull(),
  contact: text("contact").notNull(),
  payloadJson: text("payload_json").notNull(),
  source: text("source").notNull().default(""),
  status: text("status").notNull().default("new"),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: text("created_at").notNull(),
});

/** 请求日志表（审计/排查用） */
export const requestLogs = sqliteTable("request_logs", {
  id: text("id").primaryKey(),
  ipHash: text("ip_hash").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  action: text("action").notNull(),
  statusCode: integer("status_code").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
