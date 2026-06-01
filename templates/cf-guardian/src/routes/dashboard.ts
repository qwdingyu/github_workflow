import { Hono } from "hono";
import type { Env } from "../index";

const dashboardApp = new Hono<{ Bindings: Env }>();

async function getUser(c: any): Promise<any> {
  const token = c.req.header("x-auth-token");
  if (!token) return null;
  return await c.env.DB.prepare("SELECT * FROM users WHERE token = ?")
    .bind(token)
    .first();
}

// GET /api/dashboard — Overview for all user's sites (with GEO scores)
dashboardApp.get("/", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Get all sites with their latest SEO + GEO scores
  const { results: sites } = await c.env.DB.prepare(`
    SELECT s.id, s.url, s.name, s.status, s.last_scan_at, s.last_score, s.last_geo_score
    FROM sites s WHERE s.user_id = ? ORDER BY s.created_at DESC
  `).bind(user.id).all();

  // Get unresolved alert count
  const alertResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM alerts a
    JOIN sites s ON a.site_id = s.id
    WHERE s.user_id = ? AND a.resolved = 0
  `).bind(user.id).first();

  // Get sites with SEO + GEO score trends
  const sitesWithTrend = await Promise.all(
    sites.map(async (site: any) => {
      const { results } = await c.env.DB.prepare(`
        SELECT score, geo_score FROM scans WHERE site_id = ? AND status = 'completed'
        ORDER BY scanned_at DESC LIMIT 2
      `).bind(site.id).all();

      const scores = results.map((r: any) => r.score);
      const geoScores = results.map((r: any) => r.geo_score).filter((s: number) => s != null);
      const seoTrend = scores.length >= 2 ? scores[0] - scores[1] : 0;
      const geoTrend = geoScores.length >= 2 ? geoScores[0] - geoScores[1] : 0;

      return {
        ...site,
        seo_trend: seoTrend,
        seo_trend_direction: seoTrend > 0 ? "up" : seoTrend < 0 ? "down" : "stable",
        geo_trend: geoTrend,
        geo_trend_direction: geoTrend > 0 ? "up" : geoTrend < 0 ? "down" : "stable",
      };
    })
  );

  const count = alertResult ? (alertResult as any).count : 0;

  return c.json({
    overview: {
      total_sites: sites.length,
      unresolved_alerts: count,
      plan: user.plan,
      trial_ends_at: user.trial_ends_at,
    },
    sites: sitesWithTrend,
  });
});

export { dashboardApp as dashboardRoutes };
