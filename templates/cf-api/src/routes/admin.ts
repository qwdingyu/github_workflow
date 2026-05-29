/**
 * 管理端路由（需 ADMIN_TOKEN 认证）
 *
 * 端点列表:
 *   GET    /admin/channels        — 渠道列表
 *   POST   /admin/channels        — 创建渠道
 *   PUT    /admin/channels/:id    — 更新渠道
 *   DELETE /admin/channels/:id    — 删除渠道
 *   GET    /admin/tokens          — 凭证列表（分页）
 *   GET    /admin/stats           — 统计概览
 *   GET    /admin/api-keys        — API Key 列表
 *   POST   /admin/api-keys        — 创建 API Key
 *   PUT    /admin/api-keys/:id    — 更新 API Key
 *   DELETE /admin/api-keys/:id    — 删除 API Key
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, sql, count } from "drizzle-orm";
import type { AppEnv } from "../bindings";
import { ok, fail, safeJsonBody, maskContact } from "@eforge/cf-core/http";
import { createAdminAuth } from "@eforge/cf-core/middleware";
import { getIpHash, sha256 } from "@eforge/cf-core/security";
import { writeAdminAudit } from "@eforge/cf-core/audit";
import { generateUUID } from "@eforge/cf-core/crypto";
import { logger } from "@eforge/cf-core/logger";
import { channels, tokens, apiKeys, serviceLogs } from "../db/schema";
import { PAGINATION } from "../config";

const admin = new Hono<AppEnv>();

// ── 管理员认证 ──
admin.use("*", createAdminAuth({ mode: "both" }));

// ═══════════════════════════════════════════════════════════════════════════════
// 渠道管理
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /channels — 获取所有渠道 */
admin.get("/channels", async (c) => {
  const db = c.get("db");
  const list = await db.select().from(channels).orderBy(channels.priority);
  return ok(c, { channels: list });
});

/** POST /channels — 创建渠道 */
const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(50),
  priority: z.number().int().min(0).max(999).default(10),
  supportedServices: z.array(z.string()).default([]),
  configJson: z.record(z.unknown()).default({}),
});

admin.post("/channels", async (c) => {
  const body = await safeJsonBody(c);
  const parsed = createChannelSchema.safeParse(body);
  if (!parsed.success) return fail(c, "参数错误", 400, { issues: parsed.error.issues });

  const db = c.get("db");
  const now = new Date().toISOString();
  const id = generateUUID();

  await db.insert(channels).values({
    id,
    name: parsed.data.name,
    type: parsed.data.type,
    priority: parsed.data.priority,
    supportedServices: JSON.stringify(parsed.data.supportedServices),
    configJson: JSON.stringify(parsed.data.configJson),
    status: "active",
    successRate: 100,
    todayCalls: 0,
    todayFailures: 0,
    createdAt: now,
    updatedAt: now,
  });

  // 审计日志
  const ipHash = await getIpHash(c);
  await writeAdminAudit(db, {
    action: "channel.create",
    targetType: "channel",
    targetId: id,
    metadata: { name: parsed.data.name },
    ipHash,
  });

  logger.audit("channel.create", "admin", id, { name: parsed.data.name });
  return ok(c, { id }, 201);
});

/** PUT /channels/:id — 更新渠道 */
admin.put("/channels/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");
  const body = await safeJsonBody(c);
  const data = (body || {}) as Record<string, unknown>;
  const now = new Date().toISOString();

  // 构建更新字段
  const updates: Record<string, unknown> = { updatedAt: now };
  if (data.name !== undefined) updates.name = data.name;
  if (data.status !== undefined) updates.status = data.status;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.supportedServices !== undefined) {
    updates.supportedServices = JSON.stringify(data.supportedServices);
  }
  if (data.configJson !== undefined) {
    updates.configJson = JSON.stringify(data.configJson);
  }

  await db.update(channels).set(updates).where(eq(channels.id, id));

  const ipHash = await getIpHash(c);
  await writeAdminAudit(db, {
    action: "channel.update",
    targetType: "channel",
    targetId: id,
    metadata: data,
    ipHash,
  });

  return ok(c, { updated: true });
});

/** DELETE /channels/:id — 删除渠道 */
admin.delete("/channels/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  await db.delete(channels).where(eq(channels.id, id));

  const ipHash = await getIpHash(c);
  await writeAdminAudit(db, {
    action: "channel.delete",
    targetType: "channel",
    targetId: id,
    ipHash,
  });

  return ok(c, { deleted: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 凭证列表
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /tokens — 凭证列表（分页 + 筛选） */
admin.get("/tokens", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(
    PAGINATION.maxLimit,
    Math.max(1, parseInt(c.req.query("limit") || String(PAGINATION.defaultLimit))),
  );
  const offset = (page - 1) * limit;

  // 可选筛选条件
  const status = c.req.query("status");
  const serviceType = c.req.query("serviceType");

  let query = db.select().from(tokens);

  // 构建 where 条件（简化实现）
  if (status || serviceType) {
    const conditions = [];
    if (status) conditions.push(eq(tokens.status, status));
    if (serviceType) conditions.push(eq(tokens.serviceType, serviceType));
    if (conditions.length === 1) {
      query = query.where(conditions[0]) as typeof query;
    } else if (conditions.length > 1) {
      // 使用 AND 组合
      const { and } = await import("drizzle-orm");
      query = query.where(and(...conditions)) as typeof query;
    }
  }

  const list = await query.orderBy(desc(tokens.createdAt)).limit(limit).offset(offset);

  // 总数
  const totalResult = await db.select({ count: count() }).from(tokens);
  const total = totalResult[0]?.count ?? 0;

  return ok(c, {
    tokens: list,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 统计概览
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /stats — 仪表盘统计 */
admin.get("/stats", async (c) => {
  const db = c.get("db");
  const today = new Date().toISOString().slice(0, 10);

  // 并行查询各项统计
  const [
    totalTokens,
    todayTokens,
    activeChannels,
    todayLogs,
  ] = await Promise.all([
    db.select({ count: count() }).from(tokens),
    db.select({ count: count() }).from(tokens).where(
      sql`${tokens.createdAt} >= ${today}`,
    ),
    db.select({ count: count() }).from(channels).where(eq(channels.status, "active")),
    db.select({ count: count() }).from(serviceLogs).where(
      sql`${serviceLogs.createdAt} >= ${today}`,
    ),
  ]);

  return ok(c, {
    stats: {
      totalTokens: totalTokens[0]?.count ?? 0,
      todayTokens: todayTokens[0]?.count ?? 0,
      activeChannels: activeChannels[0]?.count ?? 0,
      todayCalls: todayLogs[0]?.count ?? 0,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// API Key 管理
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api-keys — 列表 */
admin.get("/api-keys", async (c) => {
  const db = c.get("db");
  const list = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));

  // 脱敏处理（不返回 keyHash）
  const safeList = list.map(({ keyHash, ...rest }) => rest);
  return ok(c, { apiKeys: safeList });
});

/** POST /api-keys — 创建 */
const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  tier: z.enum(["free", "basic", "pro", "enterprise"]).default("free"),
  userId: z.string().default(""),
  monthlyQuota: z.number().int().min(0).default(0),
  expiresAt: z.string().optional(),
});

admin.post("/api-keys", async (c) => {
  const body = await safeJsonBody(c);
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) return fail(c, "参数错误", 400, { issues: parsed.error.issues });

  const db = c.get("db");
  const now = new Date().toISOString();
  const id = generateUUID();

  // 生成 API Key（前缀 cfapi_ + 32 字节随机 hex）
  const rawKey = `cfapi_${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
  const keyHash = await sha256(rawKey);

  await db.insert(apiKeys).values({
    id,
    name: parsed.data.name,
    keyHash,
    userId: parsed.data.userId,
    tier: parsed.data.tier,
    enabled: 1,
    monthlyQuota: parsed.data.monthlyQuota,
    monthlyUsage: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: parsed.data.expiresAt || null,
  });

  const ipHash = await getIpHash(c);
  await writeAdminAudit(db, {
    action: "apikey.create",
    targetType: "api_key",
    targetId: id,
    metadata: { name: parsed.data.name, tier: parsed.data.tier },
    ipHash,
  });

  // 只在创建时返回一次明文 Key
  return ok(c, { id, key: rawKey, name: parsed.data.name }, 201);
});

/** PUT /api-keys/:id — 更新 */
admin.put("/api-keys/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");
  const body = await safeJsonBody(c);
  const data = (body || {}) as Record<string, unknown>;
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { updatedAt: now };
  if (data.name !== undefined) updates.name = data.name;
  if (data.enabled !== undefined) updates.enabled = data.enabled ? 1 : 0;
  if (data.tier !== undefined) updates.tier = data.tier;
  if (data.monthlyQuota !== undefined) updates.monthlyQuota = data.monthlyQuota;

  await db.update(apiKeys).set(updates).where(eq(apiKeys.id, id));

  const ipHash = await getIpHash(c);
  await writeAdminAudit(db, {
    action: "apikey.update",
    targetType: "api_key",
    targetId: id,
    metadata: data,
    ipHash,
  });

  return ok(c, { updated: true });
});

/** DELETE /api-keys/:id — 删除 */
admin.delete("/api-keys/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  await db.delete(apiKeys).where(eq(apiKeys.id, id));

  const ipHash = await getIpHash(c);
  await writeAdminAudit(db, {
    action: "apikey.delete",
    targetType: "api_key",
    targetId: id,
    ipHash,
  });

  return ok(c, { deleted: true });
});

export { admin };
