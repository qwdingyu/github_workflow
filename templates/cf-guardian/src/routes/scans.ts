import { Hono } from "hono";
import { eq, and, desc, asc } from "drizzle-orm";
import { users, sites, scans, alerts, geoChecks } from "../db/schema";
import type { Env, DB } from "../index";
import { checkAuth, unauthorized } from "../middleware/auth";
import { generateUUID } from "@eforge/cf-core/crypto";
import { ok, fail } from "@eforge/cf-core/http";
import { runFullGeoAudit, type GeoCheck } from "../routes/geo";

const scanApp = new Hono<{ Bindings: Env }>();

// POST /api/scans/:siteId/run — 触发扫描
scanApp.post("/:siteId/run", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const siteId = c.req.param("siteId");

  const [site] = await c.env.DB
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.id)))
    .limit(1);

  if (!site) return fail(c, "Site not found", 404);

  const scanId = generateUUID();
  await (c.env.DB as DB).insert(scans).values({ id: scanId, siteId, score: null, status: "running" });

  try {
    const response = await fetch(site.url, {
      redirect: "follow",
      cf: { scrapeShield: false },
    } as RequestInit);

    const html = await response.text();
    const parser = new (globalThis as any).DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const title = doc.querySelector("title")?.textContent?.trim() || "";
    const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "";
    const h1s = doc.querySelectorAll("h1");
    const h2s = doc.querySelectorAll("h2");
    const images = doc.querySelectorAll("img");
    const imagesMissingAlt = Array.from(images).filter((el: any) => !el.getAttribute("alt")?.trim()).length;
    const links = doc.querySelectorAll("a[href]");
    const internalLinks = Array.from(links).filter((a: any) => {
      const href = a.getAttribute("href") || "";
      return href.startsWith("/") || href.startsWith(site.url);
    });
    const externalLinks = Array.from(links).filter((a: any) => {
      const href = a.getAttribute("href") || "";
      return href.startsWith("http") && !href.startsWith(site.url);
    });
    const hasCanonical = doc.querySelector('link[rel="canonical"]') !== null;
    const hasHreflang = doc.querySelector('link[rel="alternate"][hreflang]') !== null;
    const hasSchema = doc.querySelector('[type="application/ld+json"]') !== null;

    // SEO 问题检测
    const issues: any[] = [];
    if (!title) issues.push({ severity: "critical", category: "content", title: "Missing title tag", message: "Page has no <title> tag." });
    else if (title.length < 30) issues.push({ severity: "warning", category: "content", title: "Title too short", message: `Title is ${title.length} chars. Aim for 50-60.` });
    else if (title.length > 60) issues.push({ severity: "warning", category: "content", title: "Title too long", message: `Title is ${title.length} chars. Google truncates at ~60.` });
    if (!metaDesc) issues.push({ severity: "critical", category: "content", title: "Missing meta description", message: "Add a meta description (120-160 chars)." });
    else if (metaDesc.length < 120) issues.push({ severity: "warning", category: "content", title: "Meta description too short", message: `Currently ${metaDesc.length} chars.` });
    if (h1s.length === 0) issues.push({ severity: "warning", category: "content", title: "No H1 tag", message: "Every page should have exactly one H1." });
    else if (h1s.length > 1) issues.push({ severity: "warning", category: "content", title: "Multiple H1 tags", message: `${h1s.length} H1 tags found.` });
    if (imagesMissingAlt > 0) issues.push({ severity: "info", category: "technical", title: "Images missing alt text", message: `${imagesMissingAlt} images lack alt attributes.` });
    if (!hasCanonical) issues.push({ severity: "warning", category: "technical", title: "No canonical tag", message: "Add a canonical link." });
    if (!hasSchema) issues.push({ severity: "info", category: "technical", title: "No structured data", message: "Add JSON-LD schema." });

    let score = 100;
    for (const issue of issues) {
      if (issue.severity === "critical") score -= 15;
      else if (issue.severity === "warning") score -= 8;
      else score -= 3;
    }
    score = Math.max(0, Math.min(100, score));

    // 保存扫描结果
    await c.env.DB.update(scans).set({
      score, status: "completed", httpStatus: response.status, loadTimeMs: null,
      pageSizeBytes: html.length, requestCount: 0, title, titleLength: title.length,
      metaDescription: metaDesc, metaDescriptionLength: metaDesc.length, h1Count: h1s.length,
      h2Count: h2s.length, imageCount: images.length, imageMissingAlt,
      internalLinkCount: internalLinks.length, externalLinkCount: externalLinks.length, brokenLinkCount: 0,
      hasCanonical: hasCanonical ? 1 : 0, hasHreflang: hasHreflang ? 1 : 0, hasRobotsTxt: 0,
      hasSitemap: 0, hasSchema: hasSchema ? 1 : 0, isMobileFriendly: 0, isHttps: 0,
      issuesJson: JSON.stringify(issues), aiSummary: null, aiRecommendations: null,
    }).where(eq(scans.id, scanId));

    await c.env.DB.update(sites).set({
      lastScanAt: new Date().toISOString(), lastScore: score, updatedAt: new Date().toISOString(),
    }).where(eq(sites.id, siteId));

    for (const issue of issues) {
      const alertId = generateUUID();
      await (c.env.DB as DB).insert(alerts).values({
        id: alertId, siteId, scanId, severity: issue.severity, category: issue.category,
        title: issue.title, message: issue.message, aiExplanation: "",
      });
    }

    // GEO audit
    const geoResult = await runFullGeoAudit(site.url, html, doc, c.env);
    for (const check of geoResult.checks) {
      const checkId = generateUUID();
      await (c.env.DB as DB).insert(geoChecks).values({
        id: checkId, siteId, scanId,
        checkType: check.check_type, status: check.status,
        detailsJson: JSON.stringify(check.details), score: check.score,
      });
    }
    await c.env.DB.update(sites).set({ lastGeoScore: geoResult.totalScore }).where(eq(sites.id, siteId));
    await c.env.DB.update(scans).set({
      geoScore: geoResult.totalScore, geoBand: geoResult.band,
      geoBreakdownJson: JSON.stringify(geoResult.scoreBreakdown),
    }).where(eq(scans.id, scanId));

    const [scan] = await c.env.DB.select().from(scans).where(eq(scans.id, scanId)).limit(1);
    return ok(c, { scan, geoScore: geoResult.totalScore, geoBand: geoResult.band });
  } catch (err: any) {
    await c.env.DB.update(scans).set({ status: "failed" }).where(eq(scans.id, scanId));
    return fail(c, "Scan failed: " + (err?.message || String(err)), 500);
  }
});

// GET /api/scans/:siteId — 获取最新扫描
scanApp.get("/:siteId", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const siteId = c.req.param("siteId");

  const [site] = await c.env.DB
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.id)))
    .limit(1);

  if (!site) return fail(c, "Site not found", 404);

  const [scan] = await c.env.DB
    .select()
    .from(scans)
    .where(eq(scans.siteId, siteId))
    .orderBy(desc(scans.scannedAt))
    .limit(1);

  if (!scan) return fail(c, "No scan results yet", 404);

  const scanResult = { ...scan };
  if (scan.issuesJson) {
    try { (scanResult as any).issues = JSON.parse(scan.issuesJson); } catch { (scanResult as any).issues = []; }
  }
  if (scan.aiRecommendations) {
    try { (scanResult as any).ai_recommendations = JSON.parse(scan.aiRecommendations); } catch {}
  }

  return ok(c, { scan: scanResult });
});

// GET /api/scans/:siteId/history — 分数历史
scanApp.get("/:siteId/history", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const siteId = c.req.param("siteId");
  const limit = Math.min(parseInt(c.req.query("limit") || "30"), 100);

  const [site] = await c.env.DB
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.id)))
    .limit(1);

  if (!site) return fail(c, "Site not found", 404);

  const rows = await c.env.DB
    .select({ id: scans.id, score: scans.score, status: scans.status, scannedAt: scans.scannedAt })
    .from(scans)
    .where(eq(scans.siteId, siteId))
    .orderBy(asc(scans.scannedAt))
    .limit(limit);

  return ok(c, { history: rows });
});

// GET /api/scans/:siteId/alerts — 活跃告警
scanApp.get("/:siteId/alerts", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const siteId = c.req.param("siteId");

  const [site] = await c.env.DB
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.id)))
    .limit(1);

  if (!site) return fail(c, "Site not found", 404);

  const rows = await c.env.DB
    .select()
    .from(alerts)
    .where(and(eq(alerts.siteId, siteId), eq(alerts.resolved, 0)))
    .orderBy(desc(alerts.createdAt))
    .limit(20);

  return ok(c, { alerts: rows });
});

// PATCH /api/scans/:siteId/alerts/:alertId/resolve — 标记告警已解决
scanApp.patch("/:siteId/alerts/:alertId/resolve", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const alertId = c.req.param("alertId");
  await c.env.DB.update(alerts).set({ resolved: 1, resolvedAt: new Date().toISOString() }).where(eq(alerts.id, alertId));

  return ok(c, { success: true });
});

export { scanApp as scanRoutes };
