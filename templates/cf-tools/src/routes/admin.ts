/**
 * 管理端 API 路由
 *
 * 所有管理端接口需要 ADMIN_TOKEN 认证（通过 Authorization: Bearer <token>）。
 *
 * 用户管理：
 *   GET    /api/admin/users          — 用户列表
 *   PATCH  /api/admin/users/:id      — 更新用户（启用/禁用/改角色）
 *   DELETE /api/admin/users/:id      — 删除用户
 *
 * 工具管理：
 *   GET    /api/admin/tools          — 工具列表（含禁用）
 *   PATCH  /api/admin/tools/:id      — 更新工具（启用/禁用/排序）
 *
 * 使用统计：
 *   GET    /api/admin/stats          — 概览统计
 *   GET    /api/admin/stats/usage    — 工具使用日志
 */

import { Hono } from "hono";
import { ok, fail } from "@eforge/cf-core/http";
import { getBearerToken } from "@eforge/cf-core/security";
import { constantTimeEqual } from "@eforge/cf-core/security";
import { generateUUID } from "@eforge/cf-core/crypto";
import { eq, desc, sql, count } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../bindings";
import { users, tools, toolUsageLogs } from "../db/schema";
import { adminConfig } from "../config";

export const adminRoutes = new Hono<AppEnv>();

// ── 管理员认证中间件 ─────────────────────────────────────────────────────────

async function requireAdmin(c: Parameters<Parameters<typeof adminRoutes.get>[1]>[0], next: () => Promise<void>) {
  const token = getBearerToken(c);
  const adminToken = c.env.ADMIN_TOKEN;

  if (!adminToken) {
    return fail(c, "管理端未配置", 503);
  }

  if (!token || !constantTimeEqual(token, adminToken)) {
    return fail(c, "管理端认证失败", 401);
  }

  // 检查是否为管理员角色（如果是 JWT 登录的管理员）
  c.set("isAdmin", true);
  await next();
}

// ── 应用管理员认证到所有路由 ─────────────────────────────────────────────────

adminRoutes.use("/*", requireAdmin);

// ═══ 用户管理 ═════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/users — 用户列表（分页）
 */
adminRoutes.get("/users", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const pageSize = adminConfig.pageSize;
  const offset = (page - 1) * pageSize;

  // 查询用户列表
  const userList = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      enabled: users.enabled,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset(offset);

  // 查询总数
  const totalResult = await db.select({ count: count() }).from(users);
  const total = totalResult[0]?.count || 0;

  return ok(c, {
    users: userList,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
});

/**
 * PATCH /api/admin/users/:id — 更新用户
 */
adminRoutes.patch("/users/:id", async (c) => {
  const db = c.get("db");
  const userId = c.req.param("id");

  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    role: z.enum(["admin", "user"]).optional(),
    enabled: z.number().min(0).max(1).optional(),
    displayName: z.string().max(50).optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(c, parsed.error.errors[0]?.message || "参数错误");
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
  if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName;

  await db.update(users).set(updates).where(eq(users.id, userId));

  return ok(c, { updated: true });
});

/**
 * DELETE /api/admin/users/:id — 删除用户
 */
adminRoutes.delete("/users/:id", async (c) => {
  const db = c.get("db");
  const userId = c.req.param("id");

  await db.delete(users).where(eq(users.id, userId));
  return ok(c, { deleted: true });
});

// ═══ 工具管理 ═════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/tools — 所有工具列表（含禁用的）
 */
adminRoutes.get("/tools", async (c) => {
  const db = c.get("db");

  const toolList = await db
    .select()
    .from(tools)
    .orderBy(desc(tools.sortOrder), tools.name);

  return ok(c, { tools: toolList });
});

/**
 * POST /api/admin/tools — 创建新工具
 */
adminRoutes.post("/tools", async (c) => {
  const db = c.get("db");

  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    name: z.string().min(1, "工具名称不能为空"),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "slug 只能包含小写字母、数字和连字符"),
    description: z.string().optional(),
    icon: z.string().optional(),
    category: z.string().optional(),
    enabled: z.number().min(0).max(1).optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(c, parsed.error.errors[0]?.message || "参数错误");
  }

  const now = new Date().toISOString();
  const id = generateUUID();

  await db.insert(tools).values({
    id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description || "",
    icon: parsed.data.icon || "",
    category: parsed.data.category || "其他",
    enabled: parsed.data.enabled ?? 1,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });

  return ok(c, { id }, 201);
});

/**
 * PATCH /api/admin/tools/:id — 更新工具
 */
adminRoutes.patch("/tools/:id", async (c) => {
  const db = c.get("db");
  const toolId = c.req.param("id");

  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    category: z.string().optional(),
    enabled: z.number().min(0).max(1).optional(),
    sortOrder: z.number().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(c, parsed.error.errors[0]?.message || "参数错误");
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.icon !== undefined) updates.icon = parsed.data.icon;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
  if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;

  await db.update(tools).set(updates).where(eq(tools.id, toolId));

  return ok(c, { updated: true });
});

// ═══ 使用统计 ═════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/stats — 概览统计
 */
adminRoutes.get("/stats", async (c) => {
  const db = c.get("db");

  // 并行查询各项统计
  const [userCount, toolCount, usageCount, todayUsage] = await Promise.all([
    db.select({ count: count() }).from(users),
    db.select({ count: count() }).from(tools),
    db.select({ count: count() }).from(toolUsageLogs),
    // 今日使用量
    db
      .select({ count: count() })
      .from(toolUsageLogs)
      .where(sql`${toolUsageLogs.createdAt} >= ${new Date().toISOString().slice(0, 10)}`),
  ]);

  // 按工具分组的使用统计（最近 7 天）
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const toolStats = await db
    .select({
      toolSlug: toolUsageLogs.toolSlug,
      usageCount: count(),
    })
    .from(toolUsageLogs)
    .where(sql`${toolUsageLogs.createdAt} >= ${sevenDaysAgo}`)
    .groupBy(toolUsageLogs.toolSlug)
    .orderBy(desc(count()));

  return ok(c, {
    users: userCount[0]?.count || 0,
    tools: toolCount[0]?.count || 0,
    totalUsage: usageCount[0]?.count || 0,
    todayUsage: todayUsage[0]?.count || 0,
    toolStats: toolStats.map((s) => ({
      slug: s.toolSlug,
      count: s.usageCount,
    })),
  });
});

/**
 * GET /api/admin/stats/usage — 工具使用日志（分页）
 */
adminRoutes.get("/stats/usage", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const pageSize = Math.min(100, parseInt(c.req.query("pageSize") || "50"));
  const offset = (page - 1) * pageSize;
  const slugFilter = c.req.query("slug");

  // 构建查询（可选按工具 slug 过滤）
  let query = db.select().from(toolUsageLogs);

  if (slugFilter) {
    query = query.where(eq(toolUsageLogs.toolSlug, slugFilter)) as typeof query;
  }

  const logs = await query
    .orderBy(desc(toolUsageLogs.createdAt))
    .limit(pageSize)
    .offset(offset);

  return ok(c, { logs, page, pageSize });
});
