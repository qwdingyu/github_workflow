// Sitemap Generator Routes — generate and download XML sitemaps
import { Hono } from "hono";
import type { Env } from "../index";
import { createRecommendedSitemap, generateRobotsTxtRecommendation } from "../services/sitemap-generator";
import { analyzeInternalLinks } from "../services/internal-links";

const sitemapApp = new Hono<{ Bindings: Env }>();

interface User { id: string; email: string; plan: string; token: string; }

async function getUser(c: any): Promise<User | null> {
  const token = c.req.header("x-auth-token");
  if (!token) return null;
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE token = ?")
    .bind(token)
    .first();
  return (row as User) || null;
}

// GET /api/sitemap/:siteId/generate — Generate recommended sitemap XML
sitemapApp.get("/:siteId/generate", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id, url, name FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const sitemapResult = await createRecommendedSitemap((site as any).url);

  return c.body(sitemapResult.xml, 200, {
    "Content-Type": "application/xml",
    "Content-Disposition": `attachment; filename="sitemap-${siteId}.xml"`,
  });
});

// GET /api/sitemap/:siteId/json — Get sitemap data as JSON
sitemapApp.get("/:siteId/json", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id, url, name FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const sitemapResult = await createRecommendedSitemap((site as any).url);

  return c.json({
    site: { id: siteId, url: (site as any).url, name: (site as any).name },
    sitemap: {
      totalUrls: sitemapResult.totalUrls,
      urls: sitemapResult.sitemapUrls,
    },
  });
});

// GET /api/sitemap/:siteId/robots — Generate recommended robots.txt
sitemapApp.get("/:siteId/robots", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id, url, name FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const siteUrl = (site as any).url;
  const sitemapUrl = new URL("/sitemap.xml", siteUrl).href;
  const robotsTxt = generateRobotsTxtRecommendation(siteUrl, sitemapUrl);

  return c.body(robotsTxt, 200, {
    "Content-Type": "text/plain",
    "Content-Disposition": `attachment; filename="robots-${siteId}.txt"`,
  });
});

// GET /api/sitemap/:siteId/internal-links — Analyze internal link structure
sitemapApp.get("/:siteId/internal-links", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id, url, name FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const siteUrl = (site as any).url;

  // Fetch homepage for analysis
  try {
    const resp = await fetch(siteUrl, { cf: { scrapeShield: false } });
    if (!resp.ok) return c.json({ error: `Failed to fetch: ${resp.status}` }, 422);
    const html = await resp.text();

    // Simple single-page analysis (full crawl would need env)
    const pages = [{ url: siteUrl, html, title: (site as any).name, depth: 0 }];
    const report = analyzeInternalLinks(pages, siteUrl);

    return c.json({
      site: { id: siteId, url: siteUrl, name: (site as any).name },
      internalLinks: report,
    });
  } catch (err) {
    return c.json({ error: `Failed to crawl: ${err}` }, 502);
  }
});

export { sitemapApp as sitemapGenRoutes };
