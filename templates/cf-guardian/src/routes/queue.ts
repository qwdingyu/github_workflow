import type { Context } from "hono";
import { SITE_QUERIES, SCAN_QUERIES, ALERT_QUERIES, GEO_QUERIES } from "../db/schema";
import { createTursoDB } from "../db/turso";
import { runFullGeoAudit, type GeoCheck } from "../routes/geo";
import { analyzeContent } from "../services/content-analyzer";
import { checkRobotsTxt } from "../services/robots-checker";
import type { Env, ScanMessage } from "../index";

// Queue consumer — processes SEO scans asynchronously
export async function queueConsumer(
  messages: ScanMessage[],
  env: Env
) {
  // Queue doesn't go through HTTP middleware — create Turso client directly
  const db = createTursoDB(env.TURSO_DB_URL, env.TURSO_AUTH_TOKEN || undefined);
  Object.defineProperty(env, "DB", { value: db, writable: false, configurable: false });
  for (const msg of messages) {
    try {
      await performScan(msg.siteId, msg.scanId, env);
    } catch (err) {
      console.error(`[Queue] Scan failed for site ${msg.siteId}:`, err);
      await env.DB.prepare(
        "UPDATE scans SET status = 'failed' WHERE id = ?"
      ).bind(msg.scanId).run();
    }
  }
}

// The actual scan logic — enhanced with content analysis + robots.txt check
async function performScan(siteId: string, scanId: string, env: Env) {
  let site = await env.DB.prepare(SITE_QUERIES.GET_BY_ID)
    .bind(siteId, "") // Note: cron-scanned sites skip user check
    .first();

  if (!site) {
    // Try without user filter (cron context)
    const result = await env.DB.prepare("SELECT * FROM sites WHERE id = ?")
      .bind(siteId)
      .first();
    if (!result) return;
    site = result;
  }

  if (!site) return;

  console.log(`[Scan] Scanning ${site.url}`);

  // Fetch the page
  let response: Response;
  try {
    response = await fetch(site.url as string, {
      redirect: "follow",
      cf: { scrapeShield: false },
    });
  } catch {
    await env.DB.prepare(
      "UPDATE scans SET status = 'failed' WHERE id = ?"
    ).bind(scanId).run();
    return;
  }

  const html = await response.text();
  const parser = new (globalThis as any).DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // --- Extract metrics ---
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

  // --- Detect SEO issues ---
  const issues: any[] = [];

  if (!title) issues.push({ severity: "critical", category: "content", title: "Missing title tag", message: "Page has no <title> tag." });
  else if (title.length < 30) issues.push({ severity: "warning", category: "content", title: "Title too short", message: `Title is ${title.length} chars. Aim for 50-60.` });
  else if (title.length > 60) issues.push({ severity: "warning", category: "content", title: "Title too long", message: `Title is ${title.length} chars. Google truncates at ~60.` });

  if (!metaDesc) issues.push({ severity: "critical", category: "content", title: "Missing meta description", message: "Add a meta description (120-160 chars) for better CTR." });
  else if (metaDesc.length < 120) issues.push({ severity: "warning", category: "content", title: "Meta description too short", message: `Currently ${metaDesc.length} chars. Aim for 120-160.` });

  if (h1s.length === 0) issues.push({ severity: "warning", category: "content", title: "No H1 tag", message: "Every page should have exactly one H1." });
  else if (h1s.length > 1) issues.push({ severity: "warning", category: "content", title: "Multiple H1 tags", message: `${h1s.length} H1 tags found. Use only one.` });

  if (imagesMissingAlt > 0) issues.push({ severity: "info", category: "technical", title: "Images missing alt text", message: `${imagesMissingAlt} images lack alt attributes.` });

  if (!hasCanonical) issues.push({ severity: "warning", category: "technical", title: "No canonical tag", message: "Add a canonical link to prevent duplicate content." });
  if (!hasSchema) issues.push({ severity: "info", category: "technical", title: "No structured data", message: "Add JSON-LD schema for rich results." });

  // --- Content Analysis ---
  let contentAnalysis: any = null;
  try {
    contentAnalysis = analyzeContent(doc, site.url as string);
    // Add content issues (prefixed with page URL for multi-page context)
    for (const ci of contentAnalysis.issues) {
      issues.push({
        severity: ci.severity,
        category: ci.category,
        title: ci.title,
        message: ci.message,
      });
    }
  } catch (err) {
    console.warn("[Scan] Content analysis failed:", err);
  }

  // --- Robots.txt Check ---
  try {
    const robotsResult = await checkRobotsTxt(site.url as string);
    for (const ri of robotsResult.issues) {
      issues.push({
        severity: ri.severity,
        category: "technical",
        title: `robots.txt: ${ri.title}`,
        message: ri.message,
      });
    }
  } catch (err) {
    console.warn("[Scan] Robots check failed:", err);
  }

  // --- Calculate score ---
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "critical") score -= 15;
    else if (issue.severity === "warning") score -= 8;
    else score -= 3;
  }
  score = Math.max(0, Math.min(100, score));

  // --- AI Summary (if available and user has paid plan) ---
  let aiSummary = null;
  let aiRecommendations = null;

  if (env.AI && issues.length > 0) {
    try {
      const prompt = `You are an SEO expert. A website at ${site.url} has these issues:
${issues.map((i) => `- [${i.severity}] ${i.title}: ${i.message}`).join("\n")}

Give a brief 2-sentence summary of the most important issues and top 3 prioritized recommendations. Respond in JSON: {"summary": "...", "recommendations": [{"priority": 1, "action": "...", "impact": "..."}]}`;

      const aiResult = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
      });

      const aiText = aiResult.response?.trim() || "";
      aiSummary = aiText;

      // Try to parse JSON from AI response
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { aiRecommendations = JSON.parse(jsonMatch[0]); } catch {}
      }
    } catch (err) {
      console.warn("[Scan] AI summary failed:", err);
    }
  }

  // --- Save scan result ---
  await env.DB.prepare(SCAN_QUERIES.UPDATE_RESULT).bind(
    score, "completed", response.status, null,
    html.length, 0, title, title.length,
    metaDesc, metaDesc.length, h1s.length,
    h2s.length, images.length, imagesMissingAlt,
    internalLinks.length, externalLinks.length, 0,
    hasCanonical ? 1 : 0, hasHreflang ? 1 : 0, 0,
    0, hasSchema ? 1 : 0, 0, 0,
    JSON.stringify(issues), aiSummary, aiRecommendations ? JSON.stringify(aiRecommendations) : null,
    scanId
  ).run();

  // Update site's last scan info
  await env.DB.prepare(SITE_QUERIES.UPDATE_LAST_SCAN)
    .bind(new Date().toISOString(), score, new Date().toISOString(), siteId)
    .run();

  // --- Create alerts for new issues ---
  for (const issue of issues) {
    const alertId = crypto.randomUUID();
    const aiExplanation = aiSummary || "";
    await env.DB.prepare(ALERT_QUERIES.CREATE)
      .bind(alertId, siteId, scanId, issue.severity, issue.category, issue.title, issue.message, aiExplanation)
      .run();
  }

  console.log(`[Scan] Completed ${site.url}: score=${score}, issues=${issues.length}`);

  // --- GEO Checks ---
  try {
    const geoResult = await runFullGeoAudit(site.url as string, html, doc, env);
    const geoChecks: GeoCheck[] = geoResult.checks;
    for (const check of geoChecks) {
      const checkId = crypto.randomUUID();
      await env.DB.prepare(GEO_QUERIES.CREATE).bind(
        checkId, siteId, scanId,
        check.check_type, check.status,
        JSON.stringify(check.details), check.score,
      ).run();
    }
    // Save GEO score to sites table
    const geoScore = geoResult.totalScore;
    await env.DB.prepare("UPDATE sites SET last_geo_score = ? WHERE id = ?")
      .bind(geoScore, siteId)
      .run();

    // Save GEO score + breakdown to scans table for trend tracking
    await env.DB.prepare(
      "UPDATE scans SET geo_score = ?, geo_band = ?, geo_breakdown_json = ? WHERE id = ?"
    ).bind(geoScore, geoResult.band, JSON.stringify(geoResult.scoreBreakdown), scanId).run();

    console.log(`[GEO] ${site.url}: geo_score=${geoScore}, checks=${geoChecks.length}`);
  } catch (err) {
    console.warn(`[GEO] Check failed for ${site.url}:`, err);
  }
}
