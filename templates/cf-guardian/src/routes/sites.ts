import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, count } from "drizzle-orm";
import { sites } from "../db/schema";
import type { Env, DB } from "../index";
import { checkAuth, unauthorized } from "../middleware/auth";
import { generateUUID } from "@eforge/cf-core/crypto";
import { ok, fail } from "@eforge/cf-core/http";

const siteApp = new Hono<{ Bindings: Env }>();

// GET /api/sites — 列出用户的站点
siteApp.get("/", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const rows = await c.env.DB.select().from(sites).where(eq(sites.userId, user.id)).orderBy(desc(sites.createdAt));
  return ok(c, { sites: rows });
});

// POST /api/sites — 添加监控站点
const addSiteSchema = z.object({
  url: z.string().url(),
  name: z.string().max(100).optional(),
});

siteApp.post("/", zValidator("json", addSiteSchema), async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const { url, name } = c.req.valid("json");

  // 检查套餐限制
  const [{ siteCount }] = await c.env.DB
    .select({ siteCount: count() })
    .from(sites)
    .where(eq(sites.userId, user.id));

  const limits: Record<string, number> = { free: 1, starter: 3, pro: 10, agency: 30 };
  if ((siteCount ?? 0) >= (limits[user.plan] ?? 1)) {
    return fail(c, `Plan limit reached (${limits[user.plan]} sites). Upgrade to add more.`, 403);
  }

  const id = generateUUID();
  await (c.env.DB as DB).insert(sites).values({ id, userId: user.id, url, name: name || "" });

  return ok(c, { site: { id, url, name, status: "active" } }, 201);
});

// DELETE /api/sites/:id — 删除站点
siteApp.delete("/:id", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const siteId = c.req.param("id");
  await c.env.DB.delete(sites).where(and(eq(sites.id, siteId), eq(sites.userId, user.id)));

  return ok(c, { success: true });
});

export { siteApp as siteRoutes };
