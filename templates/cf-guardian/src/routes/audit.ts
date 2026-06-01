// Full-Site Audit Routes — multi-page crawl + deep analysis
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../index";
import { checkAuth, unauthorized, verifySiteOr404 } from "../middleware/auth";
import { crawlSite } from "../services/crawler";
import { analyzeContent } from "../services/content-analyzer";
import { validateSitemap } from "../services/sitemap-validator";
import { auditSecurityHeaders } from "../services/security-checker";
import { auditPerformance } from "../services/performance-checker";
import { checkRobotsTxt } from "../services/robots-checker";
import { runFullGeoAudit } from "../routes/geo";
import { SCAN_QUERIES, GEO_QUERIES } from "../db/schema";

const auditApp = new Hono<{ Bindings: Env }>();

interface User { id: string; email: string; plan: string; token: string; }

// ─── POST /api/audit/:siteId/run — Full multi-page audit ──────────────────

const auditSchema = z.object({
  maxPages: z.number().min(1).max(50).optional(),
  maxDepth: z.number().min(1).max(3).optional(),
});

auditApp.post("/:siteId/run", zValidator("json", auditSchema), async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const siteId = c.req.param("siteId");
  const site = await verifySiteOr404(c, siteId, user.id);
  if (!site) return c.json({ error: "Site not found or access denied" }, 404);

  const { maxPages, maxDepth } = c.req.valid("json");

  // Plan limits
  const planLimits: Record<string, { maxPages: number; maxDepth: number }> = {
    free: { maxPages: 5, maxDepth: 1 },
    starter: { maxPages: 20, maxDepth: 2 },
    pro: { maxPages: 50, maxDepth: 3 },
    agency: { maxPages: 50, maxDepth: 3 },
  };
  const limit = planLimits[user.plan] || planLimits.free;
  const effectiveMaxPages = Math.min(maxPages || limit.maxPages, limit.maxPages);
  const effectiveMaxDepth = Math.min(maxDepth || limit.maxDepth, limit.maxDepth);

  const scanId = crypto.randomUUID();
  await c.env.DB.prepare(SCAN_QUERIES.CREATE).bind(scanId, site.id, null).run();

  try {
    // Step 1: Crawl
    const crawlResult = await crawlSite(site.url as string, c.env, {
      maxPages: effectiveMaxPages,
      maxDepth: effectiveMaxDepth,
      followExternal: false,
      respectRobots: true,
    });

    if (crawlResult.pages.length === 0) {
      await c.env.DB.prepare("UPDATE scans SET status = 'failed', issues_json = ? WHERE id = ?")
        .bind(JSON.stringify([{ severity: "critical", category: "technical", title: "Crawl failed", message: "Could not fetch any pages." }]), scanId)
        .run();
      return c.json({ error: "Crawl failed — no pages fetched" }, 422);
    }

    // Step 2: Analyze each page
    const pageResults: any[] = [];
    const allIssues: any[] = [];

    for (const page of crawlResult.pages) {
      const contentAnalysis = analyzeContent(page.doc, page.url);
      const isHomepage = page.url === site.url || page.url === new URL("/", site.url as string).href;

      const title = page.doc.querySelector("title")?.textContent?.trim() || "";
      const metaDesc = page.doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "";
      const h1s = page.doc.querySelectorAll("h1");
      const imagesMissingAlt = Array.from(page.doc.querySelectorAll("img")).filter((el: any) => !el.getAttribute("alt")?.trim()).length;
      const hasCanonical = page.doc.querySelector('link[rel="canonical"]') !== null;
      const hasSchema = page.doc.querySelector('[type="application/ld+json"]') !== null;

      let pageScore = 100;
      const pageIssues: any[] = [];

      if (!title) { pageScore -= 15; pageIssues.push({ severity: "critical", category: "content", title: "Missing title", message: `${page.url}: No <title>` }); }
      else if (title.length < 30) { pageScore -= 5; pageIssues.push({ severity: "warning", category: "content", title: "Short title", message: `${page.url}: ${title.length} chars` }); }
      else if (title.length > 60) { pageScore -= 5; pageIssues.push({ severity: "warning", category: "content", title: "Long title", message: `${page.url}: ${title.length} chars` }); }

      if (!metaDesc) { pageScore -= 10; pageIssues.push({ severity: "critical", category: "content", title: "Missing meta description", message: page.url }); }
      else if (metaDesc.length < 120) { pageScore -= 3; pageIssues.push({ severity: "info", category: "content", title: "Short meta description", message: `${page.url}: ${metaDesc.length} chars` }); }

      if (h1s.length === 0) { pageScore -= 5; pageIssues.push({ severity: "warning", category: "content", title: "No H1", message: page.url }); }
      else if (h1s.length > 1) { pageScore -= 3; pageIssues.push({ severity: "warning", category: "content", title: "Multiple H1s", message: `${page.url}: ${h1s.length} H1s` }); }

      if (imagesMissingAlt > 0) { pageScore -= 3; pageIssues.push({ severity: "info", category: "technical", title: "Missing alt text", message: `${page.url}: ${imagesMissingAlt} images` }); }
      if (!hasCanonical) { pageScore -= 5; pageIssues.push({ severity: "warning", category: "technical", title: "No canonical", message: page.url }); }
      if (!hasSchema && isHomepage) { pageScore -= 3; pageIssues.push({ severity: "info", category: "technical", title: "No structured data", message: page.url }); }

      for (const ci of contentAnalysis.issues) {
        const penalty = ci.severity === "critical" ? 10 : ci.severity === "warning" ? 5 : 2;
        pageScore -= penalty;
        pageIssues.push({ severity: ci.severity, category: ci.category, title: ci.title, message: `${page.url}: ${ci.message}` });
      }

      pageScore = Math.max(0, Math.min(100, pageScore));
      allIssues.push(...pageIssues);

      pageResults.push({
        url: page.url,
        score: pageScore,
        status: page.status,
        loadTimeMs: page.loadTimeMs,
        content: {
          wordCount: contentAnalysis.wordCount,
          readabilityScore: contentAnalysis.readabilityScore,
          readabilityGrade: contentAnalysis.readabilityGrade,
          topKeywords: contentAnalysis.topKeywords.slice(0, 5),
          textToHtmlRatio: contentAnalysis.textToHtmlRatio,
          hasImages: contentAnalysis.hasImages,
          hasVideos: contentAnalysis.hasVideos,
        },
        seo: { title, metaDesc, h1Count: h1s.length, hasCanonical, hasSchema, imagesMissingAlt },
      });
    }

    const totalScore = Math.round(pageResults.reduce((sum: number, p: any) => sum + p.score, 0) / pageResults.length);

    // Step 3: Sitemap + Robots.txt (parallel)
    const [sitemapResult, robotsResult] = await Promise.all([
      validateSitemap(site.url as string),
      checkRobotsTxt(site.url as string),
    ]);

    // Add robots.txt issues to allIssues
    for (const ri of robotsResult.issues) {
      allIssues.push({
        severity: ri.severity,
        category: "technical",
        title: "Robots: " + ri.title,
        message: ri.message,
      });
    }

    // Step 4: Security headers
    const securityResult = await auditSecurityHeaders(site.url as string);

    // Step 5: GEO audit on homepage
    const homepage = crawlResult.pages[0];
    let geoScore = 0;
    let geoBand = "";
    let geoBreakdown: Record<string, number> = {};
    let geoChecksSaved: any[] = [];

    try {
      const geoResult = await runFullGeoAudit(site.url as string, homepage.html, homepage.doc, c.env);
      geoScore = geoResult.totalScore;
      geoBand = geoResult.band;
      geoBreakdown = geoResult.scoreBreakdown;

      for (const check of geoResult.checks) {
        const checkId = crypto.randomUUID();
        await c.env.DB.prepare(GEO_QUERIES.CREATE).bind(
          checkId, site.id, scanId,
          check.check_type, check.status,
          JSON.stringify(check.details), check.score,
        ).run();
        geoChecksSaved.push({ type: check.check_type, status: check.status, score: check.score });
      }
    } catch (err) {
      console.warn("[Audit] GEO check failed:", err);
    }

    // Step 5.5: Performance audit on homepage
    const perfResult = await auditPerformance(site.url as string, homepage.html, new Response(homepage.html));

    // Step 6: Save results
    const hp = pageResults[0];
    await c.env.DB.prepare(SCAN_QUERIES.UPDATE_RESULT).bind(
      totalScore, "completed", 200, null,
      null, 0, hp?.seo.title || "", hp?.seo.title?.length || 0,
      hp?.seo.metaDesc || "", hp?.seo.metaDesc?.length || 0, hp?.seo.h1Count || 0,
      0, 0, hp?.seo.imagesMissingAlt || 0,
      0, 0, 0,
      hp?.seo.hasCanonical ? 1 : 0, 0, 0,
      sitemapResult.found ? 1 : 0, hp?.seo.hasSchema ? 1 : 0, 0, securityResult.isHttps ? 1 : 0,
      JSON.stringify(allIssues), null, null,
      scanId
    ).run();

    await c.env.DB.prepare(
      "UPDATE scans SET geo_score = ?, geo_band = ?, geo_breakdown_json = ? WHERE id = ?"
    ).bind(geoScore, geoBand, JSON.stringify(geoBreakdown), scanId).run();

    await c.env.DB.prepare("UPDATE sites SET last_scan_at = ?, last_score = ?, last_geo_score = ?, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), totalScore, geoScore, new Date().toISOString(), site.id)
      .run();

    return c.json({
      scanId,
      summary: {
        pagesCrawled: crawlResult.pages.length,
        pagesDiscovered: crawlResult.totalDiscovered,
        crawlErrors: crawlResult.errors.length,
        overallScore: totalScore,
        geoScore,
        geoBand,
        securityGrade: securityResult.grade,
        securityScore: securityResult.score,
        performanceGrade: perfResult.grade,
        performanceScore: perfResult.score,
        sitemapFound: sitemapResult.found,
        sitemapUrls: sitemapResult.totalUrls,
        totalIssues: allIssues.length,
        criticalIssues: allIssues.filter((i: any) => i.severity === "critical").length,
      },
      pages: pageResults,
      sitemap: {
        found: sitemapResult.found,
        url: sitemapResult.url,
        totalUrls: sitemapResult.totalUrls,
        errors: sitemapResult.errors,
        warnings: sitemapResult.warnings,
      },
      robots: {
        found: robotsResult.found,
        url: robotsResult.url,
        score: robotsResult.score,
        agents: robotsResult.agents,
        disallowedPaths: robotsResult.disallowedPaths,
        issues: robotsResult.issues,
      },
      security: {
        isHttps: securityResult.isHttps,
        score: securityResult.score,
        grade: securityResult.grade,
        headers: securityResult.headers,
        issues: securityResult.issues,
      },
      geo: {
        score: geoScore,
        band: geoBand,
        breakdown: geoBreakdown,
        checks: geoChecksSaved,
      },
      issues: allIssues.slice(0, 100),
    });

  } catch (err: any) {
    await c.env.DB.prepare("UPDATE scans SET status = 'failed' WHERE id = ?").bind(scanId).run();
    console.error("[Audit] Failed:", err);
    return c.json({ error: `Audit failed: ${err.message}` }, 500);
  }
});

// ─── GET /api/audit/:siteId/latest ────────────────────────────────────────

auditApp.get("/:siteId/latest", async (c) => {
  const user = await checkAuth(c);
  if (!user) return unauthorized(c);

  const siteId = c.req.param("siteId");
  const site = await verifySiteOr404(c, siteId, user.id);
  if (!site) return c.json({ error: "Site not found or access denied" }, 404);

  const scan = await c.env.DB.prepare(SCAN_QUERIES.GET_LATEST)
    .bind(site.id)
    .first();

  if (!scan) return c.json({ error: "No audit results yet" }, 404);

  const s = scan as any;
  let issues: any[] = [];
  if (s.issues_json) {
    try { issues = JSON.parse(s.issues_json); } catch {}
  }

  const { results: geoChecks } = await c.env.DB.prepare(GEO_QUERIES.LIST_BY_SCAN)
    .bind(s.id)
    .all();

  return c.json({
    scanId: s.id,
    scannedAt: s.scanned_at,
    seoScore: s.score,
    geoScore: s.geo_score || 0,
    geoBand: s.geo_band || "",
    issues,
    geoChecks: (geoChecks || []).map((g: any) => ({
      type: g.check_type,
      status: g.status,
      score: g.score,
    })),
  });
});

export { auditApp as auditRoutes };
