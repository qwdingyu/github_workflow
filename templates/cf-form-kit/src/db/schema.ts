import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const forms = sqliteTable("forms", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull()
});

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  formSlug: text("form_slug").notNull(),
  contact: text("contact").notNull(),
  payloadJson: text("payload_json").notNull(),
  source: text("source").notNull().default(""),
  status: text("status").notNull().default("new"),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: text("created_at").notNull()
});

export const requestLogs = sqliteTable("request_logs", {
  id: text("id").primaryKey(),
  ipHash: text("ip_hash").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  action: text("action").notNull(),
  statusCode: integer("status_code").notNull().default(0),
  createdAt: text("created_at").notNull()
});

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  action: text("action").notNull(),
  resourceId: text("resource_id").notNull(),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").notNull()
});

export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  detailJson: text("detail_json").notNull().default("{}"),
  createdAt: text("created_at").notNull()
});
