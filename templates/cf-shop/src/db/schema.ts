/**
 * 发卡商城数据库 Schema
 *
 * 从 @eforge/cf-core/db/schema 导入公共表，并添加商城业务表：
 * - products: 商品表
 * - cards: 卡密表
 * - card_batches: 卡密批次表
 * - orders: 订单表
 * - order_events: 订单事件日志
 * - coupons: 优惠码表
 * - email_logs: 邮件发送日志
 * - card_logs: 卡密操作日志
 */

import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ── 从 cf-core 导入公共表 ──
export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "@eforge/cf-core/db/schema";

// ═══════════════════════════════════════════════════════════════════════════════
// 商品表
// ═══════════════════════════════════════════════════════════════════════════════

export const products = sqliteTable("products", {
  /** 商品 ID（UUID） */
  id: text("id").primaryKey(),
  /** 商品名称 */
  name: text("name").notNull(),
  /** 商品别名（URL 友好，如 "netflix-premium"） */
  slug: text("slug").notNull().unique(),
  /** 商品描述（支持 Markdown） */
  description: text("description").default("").notNull(),
  /** 商品分类（对应 PRODUCT_CATEGORIES） */
  category: text("category").default("card").notNull(),
  /** 商品单价（分，避免浮点精度问题） */
  priceCents: integer("price_cents").notNull(),
  /** 原价（分，用于展示折扣） */
  originalPriceCents: integer("original_price_cents").default(0).notNull(),
  /** 商品图片 URL */
  imageUrl: text("image_url").default("").notNull(),
  /** 是否上架（0=下架，1=上架） */
  enabled: integer("enabled").default(1).notNull(),
  /** 排序权重（越大越靠前） */
  sortOrder: integer("sort_order").default(0).notNull(),
  /** 购买说明（支持 HTML） */
  instructions: text("instructions").default("").notNull(),
  /** 创建时间（ISO 8601） */
  createdAt: text("created_at").notNull(),
  /** 更新时间（ISO 8601） */
  updatedAt: text("updated_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 卡密批次表
// ═══════════════════════════════════════════════════════════════════════════════

export const cardBatches = sqliteTable("card_batches", {
  /** 批次 ID（UUID） */
  id: text("id").primaryKey(),
  /** 关联商品 ID */
  productId: text("product_id").notNull(),
  /** 批次名称（如 "2026年5月采购"） */
  name: text("name").default("").notNull(),
  /** 批次备注 */
  note: text("note").default("").notNull(),
  /** 采购成本（分，用于利润统计） */
  costCents: integer("cost_cents").default(0).notNull(),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 卡密表
// ═══════════════════════════════════════════════════════════════════════════════

export const cards = sqliteTable("cards", {
  /** 卡密 ID（UUID） */
  id: text("id").primaryKey(),
  /** 关联商品 ID */
  productId: text("product_id").notNull(),
  /** 关联批次 ID（可选） */
  batchId: text("batch_id"),
  /** 卡密内容（加密存储，如 "账号:密码" 或 "激活码"） */
  cardData: text("card_data").notNull(),
  /** 卡密状态：available / locked / issued / returned */
  status: text("status").default("available").notNull(),
  /** 锁定订单 ID（发放中时关联的订单） */
  lockedByOrderId: text("locked_by_order_id"),
  /** 发放时间 */
  issuedAt: text("issued_at"),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 订单表
// ═══════════════════════════════════════════════════════════════════════════════

export const orders = sqliteTable("orders", {
  /** 订单 ID（UUID） */
  id: text("id").primaryKey(),
  /** 订单号（用户可见，如 "S20260529ABC123"） */
  orderNo: text("order_no").notNull().unique(),
  /** 关联商品 ID */
  productId: text("product_id").notNull(),
  /** 购买数量 */
  quantity: integer("quantity").notNull(),
  /** 订单金额（分） */
  amountCents: integer("amount_cents").notNull(),
  /** 优惠金额（分） */
  discountCents: integer("discount_cents").default(0).notNull(),
  /** 实付金额（分） */
  paidCents: integer("paid_cents").default(0).notNull(),
  /** 买家邮箱（加密存储） */
  buyerEmail: text("buyer_email").notNull(),
  /** 买家 IP 哈希（用于防刷） */
  buyerIpHash: text("buyer_ip_hash").default("").notNull(),
  /** 订单状态：pending / paid / issued / cancelled / expired */
  status: text("status").default("pending").notNull(),
  /** 支付方式（alipay / manual） */
  paymentMethod: text("payment_method").default("").notNull(),
  /** 支付流水号（第三方支付单号） */
  paymentTradeNo: text("payment_trade_no").default("").notNull(),
  /** 使用的优惠码 */
  couponCode: text("coupon_code").default("").notNull(),
  /** 订单过期时间（ISO 8601） */
  expiresAt: text("expires_at").notNull(),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
  /** 更新时间 */
  updatedAt: text("updated_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 订单事件日志（状态变更追踪）
// ═══════════════════════════════════════════════════════════════════════════════

export const orderEvents = sqliteTable("order_events", {
  /** 事件 ID（UUID） */
  id: text("id").primaryKey(),
  /** 关联订单 ID */
  orderId: text("order_id").notNull(),
  /** 事件类型：created / paid / issued / cancelled / expired / refunded */
  eventType: text("event_type").notNull(),
  /** 事件详情（JSON） */
  metadataJson: text("metadata_json").default("{}").notNull(),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 优惠码表
// ═══════════════════════════════════════════════════════════════════════════════

export const coupons = sqliteTable("coupons", {
  /** 优惠码 ID（UUID） */
  id: text("id").primaryKey(),
  /** 优惠码（用户输入，如 "SAVE20"） */
  code: text("code").notNull().unique(),
  /** 优惠类型：percent（百分比）/ fixed（固定金额） */
  discountType: text("discount_type").default("percent").notNull(),
  /** 优惠值（百分比时为折扣百分比，固定金额时为分） */
  discountValue: integer("discount_value").notNull(),
  /** 最小订单金额（分，0 表示无限制） */
  minOrderCents: integer("min_order_cents").default(0).notNull(),
  /** 最大使用次数（0 表示无限） */
  maxUsage: integer("max_usage").default(0).notNull(),
  /** 已使用次数 */
  usedCount: integer("used_count").default(0).notNull(),
  /** 是否启用 */
  enabled: integer("enabled").default(1).notNull(),
  /** 过期时间（可选） */
  expiresAt: text("expires_at"),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 邮件发送日志
// ═══════════════════════════════════════════════════════════════════════════════

export const emailLogs = sqliteTable("email_logs", {
  /** 日志 ID（UUID） */
  id: text("id").primaryKey(),
  /** 收件人邮箱（脱敏） */
  toEmail: text("to_email").notNull(),
  /** 邮件主题 */
  subject: text("subject").notNull(),
  /** 发送状态：success / failed */
  status: text("status").notNull(),
  /** 错误信息（失败时） */
  errorMessage: text("error_message").default("").notNull(),
  /** 关联订单 ID（可选） */
  orderId: text("order_id"),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 卡密操作日志
// ═══════════════════════════════════════════════════════════════════════════════

export const cardLogs = sqliteTable("card_logs", {
  /** 日志 ID（UUID） */
  id: text("id").primaryKey(),
  /** 关联卡密 ID */
  cardId: text("card_id").notNull(),
  /** 操作类型：imported / locked / issued / returned / deleted */
  action: text("action").notNull(),
  /** 操作者（admin / system / order_id） */
  operator: text("operator").default("system").notNull(),
  /** 操作详情 */
  detail: text("detail").default("").notNull(),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});
