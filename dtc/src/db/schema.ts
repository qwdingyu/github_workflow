/**
 * DTC 故障码查询服务 — 数据库 Schema
 *
 * 使用 Drizzle ORM 定义业务表。
 * 只做 ORM 操作，不写原生 SQL。
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ═══ 从 cf-core 导入公共表 ═══════════════════════════════════════════════════
export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "@usethink/cf-core/db/schema";

// ═══════════════════════════════════════════════════════════════════
// 1. dtc_codes — DTC 故障码主表（18,805 条）
// ═══════════════════════════════════════════════════════════════════

/**
 * DTC 故障码表，存储所有汽车 OBD-II 诊断故障码。
 * 数据来源：Wal33D/dtc-database（MIT License）+ wzr1337/dtcmapping
 *
 * 每条记录对应一个 DTC 代码在某个制造商下的定义。
 * 同一代码在 GENERIC 和特定制造商下可能存在多条记录。
 */
export const dtcCodes = sqliteTable("dtc_codes", {
  /** 自增主键 */
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** DTC 代码（如 "P0420"），全大写 */
  code: text("code").notNull(),
  /** 系统类型全称（Powertrain / Body / Chassis / Network） */
  system: text("system").notNull(),
  /** 系统类型缩写（P / B / C / U） */
  systemShort: text("system_short").notNull(),
  /** 英文故障描述 */
  description: text("description").notNull(),
  /** 中文故障描述（LLM 翻译后填充，初始空） */
  descriptionZh: text("description_zh").default("").notNull(),
  /** 制造商（"GENERIC" = 通用 OBD-II 码，其他 = 品牌特定码） */
  manufacturer: text("manufacturer").notNull(),
  /** 是否为通用码（1=通用，0=制造商特定） */
  isGeneric: integer("is_generic").default(1).notNull(),
  /** 语言（en/zh） */
  locale: text("locale").default("en").notNull(),
  /** 数据来源标识 */
  source: text("source").default("wal33d/dtc-database").notNull(),
  /** 可能原因 */
  cause: text("cause").default("").notNull(),
  /** 维修建议 */
  remedy: text("remedy").default("").notNull(),
  /** 故障严重程度（low/medium/high/critical） */
  severity: text("severity").default("medium").notNull(),
  /** 关联故障码列表（JSON 数组） */
  relatedCodes: text("related_codes").default("[]").notNull(),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
  /** 最后更新时间 */
  updatedAt: text("updated_at"),
});

// ═══════════════════════════════════════════════════════════════════
// 2. manufacturers — 制造商表（34 个）
// ═══════════════════════════════════════════════════════════════════

/**
 * 汽车制造商表，存储品牌信息和统计数据。
 */
export const manufacturers = sqliteTable("manufacturers", {
  /** 品牌代码主键（如 "BMW"、"FORD"、"GENERIC"） */
  id: text("id").primaryKey(),
  /** 品牌显示名称 */
  displayName: text("display_name").notNull(),
  /** 品牌全称 */
  fullName: text("full_name").default("").notNull(),
  /** 国家 */
  country: text("country").default("").notNull(),
  /** 旗下包含的品牌（JSON 数组） */
  brands: text("brands").default("[]").notNull(),
  /** 该品牌下 DTC 数量 */
  codeCount: integer("code_count").default(0).notNull(),
  /** 品牌 Logo URL */
  logoUrl: text("logo_url").default("").notNull(),
  /** 创建时间 */
  createdAt: text("created_at").notNull(),
});