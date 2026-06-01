// Report Routes — SEO vs GEO comparison, AI-powered fix recommendations
import { Hono } from "hono";
import type { Env } from "../index";
import { SCAN_QUERIES, GEO_QUERIES } from "../db/schema";
import { generateWeeklyReport, generateAllReports } from "../services/weekly-report";

const reportApp = new Hono<{ Bindings: Env }>();

interface User { id: string; email: string; plan: string; token: string; }

async function getUser(c: any): Promise<User | null> {
  const token = c.req.header("x-auth-token");
  if (!token) return null;
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE token = ?")
    .bind(token)
    .first();
  return (row as User) || null;
}

// ─── SEO vs GEO Comparison Report ─────────────────────────────────────────

// GET /api/report/:siteId/comparison — Full SEO + GEO comparison
reportApp.get("/:siteId/comparison", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id, url, name FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  // Get latest scan
  const scan = await c.env.DB.prepare(SCAN_QUERIES.GET_LATEST)
    .bind(siteId)
    .first();
  if (!scan) return c.json({ error: "No scan results yet" }, 404);

  const s = scan as any;

  // Parse issues
  let issues: any[] = [];
  if (s.issues_json) {
    try { issues = JSON.parse(s.issues_json); } catch {}
  }

  // Get GEO checks
  const { results: geoChecks } = await c.env.DB.prepare(GEO_QUERIES.LIST_BY_SCAN)
    .bind(s.id)
    .all();

  const geoChecksParsed = (geoChecks || []).map((g: any) => {
    let details;
    try { details = JSON.parse(g.details_json); } catch { details = {}; }
    return { check_type: g.check_type, status: g.status, score: g.score, details };
  });

  // Calculate pass rates
  const seoTotal = [
    s.title, s.meta_description, s.has_canonical, s.has_schema,
    s.h1_count > 0, s.image_missing_alt === 0, s.has_hreflang,
  ].length;
  const seoPassed = [
    s.title, s.meta_description, !!s.has_canonical, !!s.has_schema,
    s.h1_count > 0, s.image_missing_alt === 0, !!s.has_hreflang,
  ].filter(Boolean).length;

  const geoPassed = geoChecksParsed.filter((g: any) => g.status === "pass").length;

  // Categorize issues
  const criticalIssues = issues.filter((i: any) => i.severity === "critical");
  const warningIssues = issues.filter((i: any) => i.severity === "warning");
  const infoIssues = issues.filter((i: any) => i.severity === "info");

  const geoFailed = geoChecksParsed.filter((g: any) => g.status === "fail");
  const geoWarned = geoChecksParsed.filter((g: any) => g.status === "warn");

  return c.json({
    site: { id: s.site_id, url: site.url, name: site.name },
    seo: {
      score: s.score,
      pass_rate: Math.round((seoPassed / seoTotal) * 100),
      issues_count: issues.length,
      critical: criticalIssues.length,
      warnings: warningIssues.length,
      info: infoIssues.length,
    },
    geo: {
      score: s.geo_score || 0,
      band: s.geo_band || "",
      total_checks: geoChecksParsed.length,
      passed: geoPassed,
      warned: geoChecksParsed.filter((g: any) => g.status === "warn").length,
      failed: geoFailed.length,
    },
    scanned_at: s.scanned_at,
    issues: { critical: criticalIssues, warnings: warningIssues, info: infoIssues },
    geo_details: geoChecksParsed,
  });
});

// ─── Score Trend Report ───────────────────────────────────────────────────

// GET /api/report/:siteId/trend — SEO + GEO score trends
reportApp.get("/:siteId/trend", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");
  const limit = parseInt(c.req.query("limit") || "30");

  const site = await c.env.DB.prepare(
    "SELECT id FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT id, score, geo_score, geo_band, status, scanned_at FROM scans WHERE site_id = ? AND status = 'completed' ORDER BY scanned_at DESC LIMIT ?"
  ).bind(siteId, limit).all();

  const history = (results || []).reverse(); // oldest first

  // Calculate trend stats
  const seoScores = history.map((h: any) => h.score).filter(Boolean);
  const geoScores = history.map((h: any) => h.geo_score).filter((s: number) => s > 0);

  return c.json({
    history,
    stats: {
      seo: {
        current: seoScores[seoScores.length - 1] ?? null,
        best: seoScores.length ? Math.max(...seoScores) : null,
        avg: seoScores.length ? Math.round(seoScores.reduce((a: number, b: number) => a + b, 0) / seoScores.length) : null,
        trend: seoScores.length >= 2 ? seoScores[seoScores.length - 1] - seoScores[0] : 0,
      },
      geo: {
        current: geoScores[geoScores.length - 1] ?? null,
        best: geoScores.length ? Math.max(...geoScores) : null,
        avg: geoScores.length ? Math.round(geoScores.reduce((a: number, b: number) => a + b, 0) / geoScores.length) : null,
        trend: geoScores.length >= 2 ? geoScores[geoScores.length - 1] - geoScores[0] : 0,
      },
    },
  });
});

// ─── AI Fix Recommendations (uses Workers AI) ────────────────────────────

// POST /api/report/:siteId/recommend — AI-powered fix recommendations
reportApp.post("/:siteId/recommend", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Check plan — AI recommendations require paid plan
  if (user.plan === "free") {
    return c.json({ error: "AI recommendations require Starter plan or higher" }, 403);
  }

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id, url, name FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const env = c.env;

  // Get latest scan issues
  const scan = await env.DB.prepare(SCAN_QUERIES.GET_LATEST)
    .bind(siteId)
    .first();
  if (!scan) return c.json({ error: "No scan results yet" }, 404);

  let issues: any[] = [];
  if ((scan as any).issues_json) {
    try { issues = JSON.parse((scan as any).issues_json); } catch {}
  }

  // Get GEO checks
  const { results: geoChecks } = await env.DB.prepare(GEO_QUERIES.LIST_BY_SCAN)
    .bind((scan as any).id)
    .all();

  const geoIssues = (geoChecks || []).filter((g: any) => g.status !== "pass").map((g: any) => {
    let details;
    try { details = JSON.parse(g.details_json); } catch { details = {}; }
    return { type: g.check_type, status: g.status, score: g.score, details };
  });

  if (issues.length === 0 && geoIssues.length === 0) {
    return c.json({ message: "No issues found! Your site is in great shape.", recommendations: [] });
  }

  // Use AI to generate prioritized recommendations
  if (!env.AI) {
    return c.json({ error: "AI service not configured" }, 503);
  }

  const prompt = `You are an expert SEO and GEO (Generative Engine Optimization) consultant. A website at ${site.url} has these issues:

SEO Issues:
${issues.map((i: any) => `- [${i.severity}] ${i.title}: ${i.message}`).join("\n") || "None"}

GEO Issues (AI Search Optimization):
${geoIssues.map((g: any) => `- [${g.status}] ${g.type}: score=${g.score}`).join("\n") || "None"}

Provide a prioritized action plan in JSON format:
{
  "summary": "2-sentence overview of the biggest opportunities",
  "recommendations": [
    {
      "priority": 1,
      "category": "seo" or "geo",
      "title": "Short title",
      "action": "Specific step-by-step fix",
      "code_snippet": "Copy-paste ready HTML/JSON-LD code if applicable, or null",
      "impact": "High/Medium/Low",
      "effort": "Quick/Medium/Advanced"
    }
  ]
}

Rank by impact. Include actual code snippets for schema, meta tags, and structured data fixes.`;

  try {
    const aiResult = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    });

    const aiText = aiResult.response?.trim() || "";
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return c.json({ recommendations: parsed });
      } catch {
        return c.json({ recommendations: { summary: aiText, raw: aiText } });
      }
    }
    return c.json({ recommendations: { summary: aiText, raw: aiText } });
  } catch (err) {
    console.warn("[Report] AI recommendation failed:", err);
    return c.json({ error: "AI service temporarily unavailable" }, 503);
  }
});

// ─── Weekly Report ────────────────────────────────────────────────────────

// GET /api/report/:siteId/weekly — Weekly performance report
reportApp.get("/:siteId/weekly", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const report = await generateWeeklyReport(siteId, { DB: c.env.DB });
  if (!report) return c.json({ error: "No data available for report" }, 404);

  return c.json({ report });
});

// GET /api/report/weekly/all — Weekly reports for all sites
reportApp.get("/weekly/all", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const reports = await generateAllReports(user.id, { DB: c.env.DB });
  return c.json({ reports });
});

export { reportApp as reportRoutes };
