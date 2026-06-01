// Competitor Comparison Service — fetch and compare competitor sites
import type { Env } from "../index";
import { analyzeContent } from "./content-analyzer";
import { runFullGeoAudit } from "../routes/geo";

export interface CompetitorSnapshot {
  url: string;
  name: string;
  scannedAt: string;
  seoScore: number;
  geoScore: number;
  geoBand: string;
  title: string;
  metaDescription: string;
  h1Count: number;
  wordCount: number;
  hasSchema: boolean;
  hasCanonical: boolean;
  loadTimeMs: number;
  contentAnalysis?: any;
}

export interface CompetitorComparison {
  yourSite: CompetitorSnapshot;
  competitors: CompetitorSnapshot[];
  ranking: { position: number; url: string; seoScore: number; geoScore: number }[];
}

// Quick scan a single URL (no DB, lightweight)
export async function quickScan(url: string, name?: string, env?: Env): Promise<CompetitorSnapshot> {
  const startTime = Date.now();
  let resp: Response;
  try {
    resp = await fetch(url, { redirect: "follow", cf: { scrapeShield: false } });
  } catch {
    return {
      url, name: name || url, scannedAt: new Date().toISOString(),
      seoScore: 0, geoScore: 0, geoBand: "", title: "", metaDescription: "",
      h1Count: 0, wordCount: 0, hasSchema: false, hasCanonical: false, loadTimeMs: 0,
    };
  }

  const html = await resp.text();
  const loadTimeMs = Date.now() - startTime;
  const parser = new (globalThis as any).DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const title = doc.querySelector("title")?.textContent?.trim() || "";
  const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "";
  const h1Count = doc.querySelectorAll("h1").length;
  const hasSchema = doc.querySelector('[type="application/ld+json"]') !== null;
  const hasCanonical = doc.querySelector('link[rel="canonical"]') !== null;

  // Content analysis
  const contentAnalysis = analyzeContent(doc, url);

  // Calculate SEO score
  let seoScore = 100;
  if (!title) seoScore -= 15;
  else if (title.length < 30) seoScore -= 5;
  else if (title.length > 60) seoScore -= 5;
  if (!metaDesc) seoScore -= 10;
  else if (metaDesc.length < 120) seoScore -= 3;
  if (h1Count === 0) seoScore -= 5;
  else if (h1Count > 1) seoScore -= 3;
  if (!hasCanonical) seoScore -= 5;
  if (!hasSchema) seoScore -= 3;
  if (contentAnalysis.wordCount < 300) seoScore -= 10;
  else if (contentAnalysis.wordCount < 600) seoScore -= 5;
  seoScore = Math.max(0, Math.min(100, seoScore));

  // GEO score (lightweight)
  let geoScore = 0;
  let geoBand = "";
  if (env) {
    try {
      const geoResult = await runFullGeoAudit(url, html, doc, env);
      geoScore = geoResult.totalScore;
      geoBand = geoResult.band;
    } catch { /* skip */ }
  }

  return {
    url,
    name: name || url,
    scannedAt: new Date().toISOString(),
    seoScore,
    geoScore,
    geoBand,
    title,
    metaDescription: metaDesc,
    h1Count,
    wordCount: contentAnalysis.wordCount,
    hasSchema,
    hasCanonical,
    loadTimeMs,
    contentAnalysis: {
      wordCount: contentAnalysis.wordCount,
      readabilityScore: contentAnalysis.readabilityScore,
      topKeywords: contentAnalysis.topKeywords.slice(0, 5),
      textToHtmlRatio: contentAnalysis.textToHtmlRatio,
      hasImages: contentAnalysis.hasImages,
    },
  };
}
