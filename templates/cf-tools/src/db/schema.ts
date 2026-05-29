/**
 * cf-tools — 数据库 Schema
 *
 * 从 @eforge/cf-core/db/schema 导入公共表，
 * 添加本项目的业务表：users / tools / tool_usage_logs
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ═══ 导入 cf-core 公共表 ═══════════════════════════════════════════════════

export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "@eforge/cf-core/db/schema";

// ═══ 业务表：用户表 ═════════════════════════════════════════════════════════

/**
 * 用户表 — 邮箱 + 密码 + JWT 认证
 */
export const users = sqliteTable("users", {
  /** 用户 ID（UUID） */
  id: text("id").primaryKey(),
  /** 邮箱（唯一） */
  email: text("email").notNull().unique(),
  /** 密码哈希（PBKDF2-HMAC-SHA256） */
  passwordHash: text("password_hash").notNull(),
  /** 密码盐值（hex） */
  passwordSalt: text("password_salt").notNull(),
  /** 显示名称 */
  displayName: text("display_name").default("").notNull(),
  /** 角色：admin | user */
  role: text("role").default("user").notNull(),
  /** 是否启用（0 = 禁用，1 = 启用） */
  enabled: integer("enabled").default(1).notNull(),
  /** 最后登录时间（ISO 8601） */
  lastLoginAt: text("last_login_at"),
  /** 创建时间（ISO 8601） */
  createdAt: text("created_at").notNull(),
  /** 更新时间（ISO 8601） */
  updatedAt: text("updated_at").notNull(),
});

// ═══ 业务表：工具注册表 ═════════════════════════════════════════════════════

/**
 * 工具注册表 — 记录所有可用工具及其配置
 */
export const tools = sqliteTable("tools", {
  /** 工具 ID（UUID） */
  id: text("id").primaryKey(),
  /** 工具显示名称 */
  name: text("name").notNull(),
  /** 工具唯一标识（用于 URL 和驱动匹配） */
  slug: text("slug").notNull().unique(),
  /** 工具描述 */
  description: text("description").default("").notNull(),
  /** 图标（Emoji 或 SVG） */
  icon: text("icon").default("").notNull(),
  /** 分类标签 */
  category: text("category").default("其他").notNull(),
  /** 是否启用 */
  enabled: integer("enabled").default(1).notNull(),
  /** 排序权重（越大越靠前） */
  sortOrder: integer("sort_order").default(0).notNull(),
  /** 创建时间（ISO 8601） */
  createdAt: text("created_at").notNull(),
  /** 更新时间（ISO 8601） */
  updatedAt: text("updated_at").notNull(),
});

// ═══ 业务表：工具使用日志 ═══════════════════════════════════════════════════

/**
 * 工具使用日志 — 记录每次工具调用（用于统计分析）
 */
export const toolUsageLogs = sqliteTable("tool_usage_logs", {
  /** 日志 ID（UUID） */
  id: text("id").primaryKey(),
  /** 工具 slug */
  toolSlug: text("tool_slug").notNull(),
  /** 用户 ID（未登录则为空） */
  userId: text("user_id"),
  /** 客户端 IP 哈希（隐私保护） */
  ipHash: text("ip_hash").default("").notNull(),
  /** 执行耗时（毫秒） */
  durationMs: integer("duration_ms").default(0).notNull(),
  /** 执行结果：success | error */
  status: text("status").default("success").notNull(),
  /** 错误信息（仅失败时记录） */
  errorMessage: text("error_message"),
  /** 创建时间（ISO 8601） */
  createdAt: text("created_at").notNull(),
});
