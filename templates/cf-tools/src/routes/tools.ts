/**
 * 工具路由（需认证）
 *
 * GET  /api/tools          — 工具列表（仅返回已启用的）
 * POST /api/tools/:slug/run — 执行指定工具
 */

import { Hono } from "hono";
import { ok, fail } from "@eforge/cf-core/http";
import { extractJwt, verifyJwt } from "@eforge/cf-core/auth/jwt";
import { getIpHash } from "@eforge/cf-core/security";
import { generateUUID } from "@eforge/cf-core/crypto";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../bindings";
import { tools, toolUsageLogs } from "../db/schema";
import { toolRegistry } from "../services/tools/registry";

export const toolRoutes = new Hono<AppEnv>();

// ── 认证中间件（可选认证 — 未登录也能使用部分工具） ───────────────────────────

async function optionalAuth(c: Parameters<Parameters<typeof toolRoutes.get>[1]>[0], next: () => Promise<void>) {
  const token = extractJwt(c);
  if (token) {
    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    if (payload) {
      c.set("userId", payload.sub);
      c.set("userEmail", payload.email);
    }
  }
  await next();
}

// ── GET /api/tools — 获取已启用的工具列表 ────────────────────────────────────

toolRoutes.get("/", optionalAuth, async (c) => {
  const db = c.get("db");

  // 从数据库查询已启用的工具
  const toolList = await db
    .select({
      id: tools.id,
      name: tools.name,
      slug: tools.slug,
      description: tools.description,
      icon: tools.icon,
      category: tools.category,
    })
    .from(tools)
    .where(eq(tools.enabled, 1))
    .orderBy(tools.sortOrder);

  // 附加驱动是否已注册的信息
  const result = toolList.map((t) => ({
    ...t,
    driverReady: toolRegistry.has(t.slug),
  }));

  return ok(c, { tools: result });
});

// ── POST /api/tools/:slug/run — 执行工具 ─────────────────────────────────────

toolRoutes.post("/:slug/run", optionalAuth, async (c) => {
  const slug = c.req.param("slug");
  const startTime = Date.now();
  const db = c.get("db");
  const userId = c.get("userId");

  // 查找工具驱动
  const driver = toolRegistry.get(slug);
  if (!driver) {
    return fail(c, `工具 "${slug}" 不存在或未注册`, 404);
  }

  // 检查工具是否在数据库中启用
  const toolRecord = await db
    .select()
    .from(tools)
    .where(eq(tools.slug, slug))
    .limit(1);

  if (toolRecord.length === 0 || !toolRecord[0].enabled) {
    return fail(c, `工具 "${slug}" 已禁用`, 403);
  }

  // 解析请求体
  const input = await c.req.json().catch(() => ({}));

  // 执行工具
  try {
    const result = await driver.run(input, { env: c.env, userId });
    const durationMs = Date.now() - startTime;
    const ipHash = await getIpHash(c);

    // 异步记录使用日志（不阻塞响应）
    const logId = generateUUID();
    const ctx = c.get("executionCtx");
    if (ctx) {
      ctx.waitUntil(
        db
          .insert(toolUsageLogs)
          .values({
            id: logId,
            toolSlug: slug,
            userId: userId || null,
            ipHash,
            durationMs,
            status: "success",
            createdAt: new Date().toISOString(),
          })
          .catch((err: Error) => console.error("[tools:log]", err)),
      );
    }

    return ok(c, { result, durationMs });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const ipHash = await getIpHash(c);

    // 记录失败日志
    const logId = generateUUID();
    const ctx = c.get("executionCtx");
    if (ctx) {
      ctx.waitUntil(
        db
          .insert(toolUsageLogs)
          .values({
            id: logId,
            toolSlug: slug,
            userId: userId || null,
            ipHash,
            durationMs,
            status: "error",
            errorMessage,
            createdAt: new Date().toISOString(),
          })
          .catch((e: Error) => console.error("[tools:log]", e)),
      );
    }

    console.error(`[tools:run:${slug}]`, err);
    return fail(c, `工具执行失败: ${errorMessage}`, 500);
  }
});
