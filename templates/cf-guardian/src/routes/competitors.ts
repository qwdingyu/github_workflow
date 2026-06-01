import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq, and, count } from "drizzle-orm";
import { competitors } from "../db/schema";
import type { Env, DB } from "../index";
import { checkAuth, unauthorized, verifySiteOr404 } from "../middleware/auth";
import { quickScan, type CompetitorSnapshot } from "../services/competitor";
import { generateUUID } from "@eforge/cf-core/crypto";
import { ok, fail } from "@eforge/cf-core/http";

const competitorApp = new Hono<{ Bindings: Env }>();

// POST /api/competitors/add — 添加竞品
const addCompetitorSchema = z.object({
  userId: z.string().uuid().optional(),
  url: z.string().url(),
  name: z.string().max(100).optional(),
});

competitorApp.post("/add", zValidator("json", addCompetitorSchema), async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const { url, name } = c.req.valid("json");
  const userId = user.id;

  const [{ compCount }] = await c.env.DB
    .select({ compCount: count() })
    .from(competitors)
    .where(eq(competitors.userId, userId));

  const limits: Record<string, number> = { free: 0, starter: 2, pro: 5, agency: 15 };
  if ((compCount ?? 0) >= (limits[user.plan] ?? 0)) {
    return fail(c, `Competitor limit reached (${limits[user.plan]} max). Upgrade for more.`, 403);
  }

  const id = generateUUID();
  await (c.env.DB as DB).insert(competitors).values({ id, userId, url, name: name || "" });

  return ok(c, { competitor: { id, url, name: name || "" } }, 201);
});

// GET /api/competitors — 列出竞品
competitorApp.get("/", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const rows = await c.env.DB.select().from(competitors).where(eq(competitors.userId, user.id));
  return ok(c, { competitors: rows });
});

// DELETE /api/competitors/:id — 删除竞品
competitorApp.delete("/:id", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const competitorId = c.req.param("id");
  await c.env.DB.delete(competitors).where(and(eq(competitors.id, competitorId), eq(competitors.userId, user.id)));

  return ok(c, { success: true });
});

// GET /api/competitors/:siteId/compare — 竞品对比
competitorApp.get("/:siteId/compare", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const siteId = c.req.param("siteId");
  const site = await verifySiteOr404(c, siteId, user.id);
  if (!site) return fail(c, "Site not found", 404);

  const compList = await c.env.DB.select().from(competitors).where(eq(competitors.userId, user.id));

  if (compList.length === 0) {
    return ok(c, { message: "No competitors added yet. Add competitors to compare.", comparison: null });
  }

  const yourSnapshot = await quickScan(site.url, site.name, c.env);

  const competitorSnapshots = await Promise.all(
    compList.map(async (comp) => {
      try {
        return await quickScan(comp.url, comp.name, c.env);
      } catch {
        return {
          url: comp.url, name: comp.name || comp.url, scannedAt: new Date().toISOString(),
          seoScore: 0, geoScore: 0, geoBand: "", title: "", metaDescription: "",
          h1Count: 0, wordCount: 0, hasSchema: false, hasCanonical: false, loadTimeMs: 0,
        } as CompetitorSnapshot;
      }
    })
  );

  const allSites = [
    { url: yourSnapshot.url, seoScore: yourSnapshot.seoScore, geoScore: yourSnapshot.geoScore, isYours: true as const },
    ...competitorSnapshots.map((s) => ({ url: s.url, seoScore: s.seoScore, geoScore: s.geoScore, isYours: false as const })),
  ];

  const seoRanking = [...allSites].sort((a, b) => b.seoScore - a.seoScore);
  const geoRanking = [...allSites].sort((a, b) => b.geoScore - a.geoScore);

  return ok(c, {
    yourSite: yourSnapshot,
    competitors: competitorSnapshots,
    rankings: {
      seo: seoRanking.map((s, i) => ({ position: i + 1, url: s.url, seoScore: s.seoScore, isYours: s.isYours })),
      geo: geoRanking.map((s, i) => ({ position: i + 1, url: s.url, geoScore: s.geoScore, isYours: s.isYours })),
    },
    yourPosition: {
      seo: seoRanking.findIndex((s) => s.isYours) + 1,
      geo: geoRanking.findIndex((s) => s.isYours) + 1,
    },
  });
});

export { competitorApp as competitorRoutes };
