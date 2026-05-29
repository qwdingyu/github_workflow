/**
 * cf-api — 数据库 Schema
 *
 * 导入 @eforge/cf-core 公共表，添加业务表：
 * 1. tokens        — 凭证/资源（核心表）
 * 2. channels      — 渠道配置
 * 3. service_logs  — 服务调用日志
 * 4. price_history — 价格变更记录
 * 5. price_snapshot — 价格快照
 *
 * 公共表（从 cf-core 继承）：
 * - system_config      — 系统配置 KV
 * - admin_audit_logs   — 管理员审计
 * - rate_limit_windows — 限流窗口
 * - idempotency_keys   — 幂等键
 * - api_keys           — API Key 认证
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ═══ 导入公共表（重新导出供 bootstrap 使用） ═══
export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "@eforge/cf-core/db/schema";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. tokens — 凭证/资源表（核心业务表）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 凭证状态机:
 *   unused → pending → active → completed / failed
 *   unused → expired（惰性清理）
 *   active → released（手动释放）
 */
export const tokens = sqliteTable("tokens", {
  /** 主键 UUID */
  id: text("id").primaryKey(),
  /** 服务类型（email_verify / sms_verify / ...） */
  serviceType: text("service_type").notNull(),
  /** 所属渠道 ID */
  channelId: text("channel_id").default(""),
  /** 关联的 API Key ID */
  apiKeyId: text("api_key_id").default("").notNull(),
  /** 凭证状态 */
  status: text("status").default("unused").notNull(),
  /** 加密后的凭证数据（JSON，AES-256-GCM） */
  encryptedPayload: text("encrypted_payload").default("").notNull(),
  /** 处理结果（明文 JSON） */
  resultJson: text("result_json").default("{}").notNull(),
  /** 外部追踪 ID（渠道返回） */
  externalId: text("external_id").default(""),
  /** 错误信息 */
  errorMessage: text("error_message").default(""),
  /** 客户端 IP 哈希（限流/审计） */
  ipHash: text("ip_hash").default("").notNull(),
  /** 过期时间（ISO 8601） */
  expiresAt: text("expires_at").notNull(),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
  /** 最后更新时间 */
  updatedAt: text("updated_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. channels — 渠道配置表
// ═══════════════════════════════════════════════════════════════════════════════

export const channels = sqliteTable("channels", {
  /** 主键 UUID */
  id: text("id").primaryKey(),
  /** 渠道名称（展示用） */
  name: text("name").notNull(),
  /** 渠道类型标识（channel_a / channel_b / ...） */
  type: text("type").notNull(),
  /** 渠道状态 */
  status: text("status").default("active").notNull(),
  /** 优先级（数字越小越优先） */
  priority: integer("priority").default(10).notNull(),
  /** 支持的服务类型（JSON 数组） */
  supportedServices: text("supported_services").default("[]").notNull(),
  /** 渠道配置（JSON，可含 API endpoint、超时等） */
  configJson: text("config_json").default("{}").notNull(),
  /** 成功率（0-100，滑动窗口统计） */
  successRate: integer("success_rate").default(100).notNull(),
  /** 今日调用次数 */
  todayCalls: integer("today_calls").default(0).notNull(),
  /** 今日失败次数 */
  todayFailures: integer("today_failures").default(0).notNull(),
  /** 最后使用时间 */
  lastUsedAt: text("last_used_at"),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
  /** 更新时间 */
  updatedAt: text("updated_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. service_logs — 服务调用日志表
// ═══════════════════════════════════════════════════════════════════════════════

export const serviceLogs = sqliteTable("service_logs", {
  /** 主键 UUID */
  id: text("id").primaryKey(),
  /** 关联的 Token ID */
  tokenId: text("token_id").default("").notNull(),
  /** 服务类型 */
  serviceType: text("service_type").notNull(),
  /** 渠道 ID */
  channelId: text("channel_id").default(""),
  /** 操作类型（generate / use / check / release） */
  action: text("action").notNull(),
  /** 操作结果（success / failure） */
  result: text("result").notNull(),
  /** 耗时（毫秒） */
  durationMs: integer("duration_ms").default(0).notNull(),
  /** 请求摘要（脱敏后的 JSON） */
  requestJson: text("request_json").default("{}").notNull(),
  /** 响应摘要 */
  responseJson: text("response_json").default("{}").notNull(),
  /** 错误信息 */
  errorMessage: text("error_message").default(""),
  /** IP 哈希 */
  ipHash: text("ip_hash").default("").notNull(),
  /** API Key ID */
  apiKeyId: text("api_key_id").default(""),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. price_history — 价格变更记录
// ═══════════════════════════════════════════════════════════════════════════════

export const priceHistory = sqliteTable("price_history", {
  /** 主键 UUID */
  id: text("id").primaryKey(),
  /** 服务类型 */
  serviceType: text("service_type").notNull(),
  /** 渠道 ID */
  channelId: text("channel_id").default(""),
  /** 旧价格（分） */
  oldPrice: integer("old_price").default(0).notNull(),
  /** 新价格（分） */
  newPrice: integer("new_price").default(0).notNull(),
  /** 变更原因 */
  reason: text("reason").default("").notNull(),
  /** 操作人 */
  operatorId: text("operator_id").default("").notNull(),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. price_snapshot — 价格快照（每日统计）
// ═══════════════════════════════════════════════════════════════════════════════

export const priceSnapshot = sqliteTable("price_snapshot", {
  /** 主键 UUID */
  id: text("id").primaryKey(),
  /** 快照日期（YYYY-MM-DD） */
  date: text("date").notNull(),
  /** 服务类型 */
  serviceType: text("service_type").notNull(),
  /** 渠道 ID */
  channelId: text("channel_id").default("").notNull(),
  /** 当日调用次数 */
  callCount: integer("call_count").default(0).notNull(),
  /** 当日成功次数 */
  successCount: integer("success_count").default(0).notNull(),
  /** 当日平均耗时（毫秒） */
  avgDurationMs: integer("avg_duration_ms").default(0).notNull(),
  /** 当日总费用（分） */
  totalCost: integer("total_cost").default(0).notNull(),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});
