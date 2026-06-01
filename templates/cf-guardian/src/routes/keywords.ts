// Keyword Tracking Routes
import { Hono } from "hono";
import type { Env } from "../index";
import { extractTargetKeywords, generateKeywordReport, estimateSearchVolume } from "../services/keyword-tracker";

const keywordApp = new Hono<{ Bindings: Env }>();

interface User { id: string; email: string; plan: string; token: string; }

async function getUser(c: any): Promise<User | null> {
  const token = c.req.header("x-auth-token");
  if (!token) return null;
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE token = ?")
    .bind(token)
    .first();
  return (row as User) || null;
}

// GET /api/keywords/extract?url=https://example.com — Extract target keywords from page
keywordApp.get("/extract", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const url = c.req.query("url");
  if (!url) return c.json({ error: "url parameter required" }, 400);

  try {
    new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  try {
    const resp = await fetch(url, { cf: { scrapeShield: false } });
    if (!resp.ok) return c.json({ error: `Failed to fetch page: ${resp.status}` }, 422);
    const html = await resp.text();
    const keywords = extractTargetKeywords(html, url);

    // Enrich with volume estimates
    const enriched = keywords.map((kw) => ({
      ...kw,
      ...estimateSearchVolume(kw.keyword),
    }));

    return c.json({ keywords: enriched, count: enriched.length });
  } catch (err) {
    return c.json({ error: `Failed to crawl page: ${err}` }, 502);
  }
});

// GET /api/keywords/:siteId/report — Full keyword tracking report for monitored site
keywordApp.get("/:siteId/report", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Free tier limited
  if (user.plan === "free") {
    return c.json({ error: "Keyword tracking requires Starter plan or higher" }, 403);
  }

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id, url, name FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const siteUrl = (site as any).url;

  // Fetch and extract keywords
  try {
    const resp = await fetch(siteUrl, { cf: { scrapeShield: false } });
    if (!resp.ok) return c.json({ error: `Failed to fetch page: ${resp.status}` }, 422);
    const html = await resp.text();
    const keywords = extractTargetKeywords(html, siteUrl);
    const report = generateKeywordReport(siteId, siteUrl, keywords);

    return c.json({
      site: { id: siteId, url: siteUrl, name: (site as any).name },
      keywordReport: report,
    });
  } catch (err) {
    return c.json({ error: `Failed to crawl page: ${err}` }, 502);
  }
});

// POST /api/keywords/:siteId/add — Add keyword to tracking list
keywordApp.post("/:siteId/add", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  if (user.plan === "free") {
    return c.json({ error: "Custom keyword tracking requires Starter plan or higher" }, 403);
  }

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const body = await c.req.json();
  const { keyword } = body as { keyword: string };
  if (!keyword) return c.json({ error: "keyword is required" }, 400);

  const { volume, difficulty, cpc } = estimateSearchVolume(keyword);
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    "INSERT INTO tracked_keywords (id, user_id, site_id, keyword, search_volume, difficulty, current_rank, previous_rank, best_rank, last_checked, created_at) VALUES (?, ?, ?, ?, ?, ?, null, null, null, ?, ?)"
  ).bind(id, user.id, siteId, keyword, volume, difficulty, new Date().toISOString(), new Date().toISOString()).run();

  return c.json({
    id,
    keyword,
    searchVolume: volume,
    difficulty,
    cpc,
    message: "Keyword added to tracking",
  });
});

// GET /api/keywords/:siteId/list — List all tracked keywords for a site
keywordApp.get("/:siteId/list", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM tracked_keywords WHERE site_id = ? AND user_id = ? ORDER BY keyword"
  ).bind(siteId, user.id).all();

  return c.json({ keywords: results || [] });
});

export { keywordApp as keywordRoutes };
