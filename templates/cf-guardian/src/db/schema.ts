/**
 * SEO Guardian 数据库 Schema
 *
 * 使用 Drizzle ORM 定义表结构。
 * 5 张基础设施表从 @eforge/cf-core 导入，业务表在此定义。
 */

// ── 基础设施表（来自 cf-core，严禁在此重复定义） ──
export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "@eforge/cf-core/db/schema";

// ── Drizzle 导入 ──
import {
  sqliteTable,
  text,
  integer,
  varchar,
} from "drizzle-orm/sqlite-core";

// ── 业务表定义 ──

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  token: text("token").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  plan: varchar("plan", { length: 20 }).notNull().default("free"),
  trialEndsAt: text("trial_ends_at"),
  createdAt: text("created_at").notNull().default(() => new Date().toISOString()),
});

export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  url: text("url").notNull(),
  name: text("name").notNull().default(""),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  lastScanAt: text("last_scan_at"),
  lastScore: integer("last_score"),
  lastGeoScore: integer("last_geo_score"),
  createdAt: text("created_at").notNull().default(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(() => new Date().toISOString()),
});

export const scans = sqliteTable("scans", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id),
  score: integer("score"),
  geoScore: integer("geo_score"),
  geoBand: text("geo_band"),
  geoBreakdownJson: text("geo_breakdown_json"),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  httpStatus: integer("http_status"),
  loadTimeMs: integer("load_time_ms"),
  pageSizeBytes: integer("page_size_bytes"),
  requestCount: integer("request_count"),
  title: text("title"),
  titleLength: integer("title_length"),
  metaDescription: text("meta_description"),
  metaDescriptionLength: integer("meta_description_length"),
  h1Count: integer("h1_count"),
  h2Count: integer("h2_count"),
  imageCount: integer("image_count"),
  imageMissingAlt: integer("image_missing_alt"),
  internalLinkCount: integer("internal_link_count"),
  externalLinkCount: integer("external_link_count"),
  brokenLinkCount: integer("broken_link_count"),
  hasCanonical: integer("has_canonical"),
  hasHreflang: integer("has_hreflang"),
  hasRobotsTxt: integer("has_robots_txt"),
  hasSitemap: integer("has_sitemap"),
  hasSchema: integer("has_schema"),
  isMobileFriendly: integer("is_mobile_friendly"),
  isHttps: integer("is_https"),
  issuesJson: text("issues_json"),
  aiSummary: text("ai_summary"),
  aiRecommendations: text("ai_recommendations"),
  scannedAt: text("scanned_at").notNull().default(() => new Date().toISOString()),
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id),
  scanId: text("scan_id").references(() => scans.id),
  severity: varchar("severity", { length: 20 }).notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  aiExplanation: text("ai_explanation"),
  resolved: integer("resolved").notNull().default(0),
  resolvedAt: text("resolved_at"),
  notified: integer("notified").notNull().default(0),
  createdAt: text("created_at").notNull().default(() => new Date().toISOString()),
});

export const competitors = sqliteTable("competitors", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  url: text("url").notNull(),
  name: text("name").notNull().default(""),
  createdAt: text("created_at").notNull().default(() => new Date().toISOString()),
});

export const geoChecks = sqliteTable("geo_checks", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id),
  scanId: text("scan_id").references(() => scans.id),
  checkType: text("check_type").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  detailsJson: text("details_json"),
  score: integer("score"),
  createdAt: text("created_at").notNull().default(() => new Date().toISOString()),
});

// ── Drizzle DB 实例类型 ──
import type { DrizzleInstance } from "@eforge/cf-core/db/connection";
export type DB = DrizzleInstance<typeof schema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schema: Record<string, any> = {
  users,
  sites,
  scans,
  alerts,
  competitors,
  geoChecks,
  systemConfig: {} as never,
  adminAuditLogs: {} as never,
  rateLimitWindows: {} as never,
  idempotencyKeys: {} as never,
  apiKeys: {} as never,
};
