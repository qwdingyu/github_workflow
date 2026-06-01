// GEO Check Engine — deeply inspired by:
// 1. geo-optimizer-skill (Auriti-Labs): 8-category 100-pt scoring, Princeton KDD 2024 citability,
//    robots.txt AI bot parsing, llms.txt v2 spec, schema completeness, content front-loading
// 2. geo-lint (IJONIS): 92-rule linter — E-E-A-T, RAG optimization, structure rules,
//    FAQ quality, source citations, heading density, OG rules
// 3. GEO-AI (madeburo): AI_BOTS registry (16 bots), BotRulesEngine, SeoGenerator JSON-LD,
//    LlmsGenerator, crawl tracking, e-commerce Product schema
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../index";
import { GEO_QUERIES, GEO_SCORE_QUERY, SITE_QUERIES, SCAN_QUERIES } from "../db/schema";
import { checkBrandEntity } from "../services/brand-entity-checker";
import { checkPrincetonMethods } from "../services/princeton-methods";
import { checkAiDiscovery } from "../services/ai-discovery-checker";

const geoApp = new Hono<{ Bindings: Env }>();

// ─── Auth helper ────────────────────────────────────────────────────────

interface User { id: string; email: string; plan: string; token: string; }

async function getUser(c: any): Promise<User | null> {
  const token = c.req.header("x-auth-token");
  if (!token) return null;
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE token = ?")
    .bind(token)
    .first();
  return (row as User) || null;
}

// ─── AI BOTS registry (from GEO-AI constants.ts, extended with geo-optimizer-skill) ───

interface AIBot { name: string; displayName: string; tier: "search" | "training" | "user"; }

const AI_BOTS: AIBot[] = [
  // Tier 1 — Citation-critical search engines (most important for GEO)
  { name: "GPTBot", displayName: "OpenAI / ChatGPT", tier: "search" },
  { name: "OAI-SearchBot", displayName: "OpenAI / Copilot", tier: "search" },
  { name: "Claude-Web", displayName: "Anthropic / Claude (Web)", tier: "search" },
  { name: "ClaudeBot", displayName: "Anthropic / Claude", tier: "search" },
  { name: "PerplexityBot", displayName: "Perplexity AI", tier: "search" },
  { name: "Google-Extended", displayName: "Google / Gemini", tier: "search" },
  { name: "cohere-ai", displayName: "Cohere", tier: "search" },
  { name: "omgilibot", displayName: "Omgili", tier: "search" },
  { name: "diffbot", displayName: "Diffbot", tier: "search" },
  { name: "ImagesiftBot", displayName: "Imagesift", tier: "search" },
  { name: "FacebookBot", displayName: "Meta / AI Search", tier: "search" },
  { name: "meta-externalagent", displayName: "Meta / LLaMA Search", tier: "search" },
  { name: "TeaBot", displayName: "Tea", tier: "search" },
  // Tier 2 — Training data collection
  { name: "DeepSeekBot", displayName: "DeepSeek", tier: "training" },
  { name: "GrokBot", displayName: "xAI / Grok", tier: "training" },
  { name: "Bytespider", displayName: "ByteDance", tier: "training" },
  { name: "PanguBot", displayName: "Alibaba / Qwen", tier: "training" },
  { name: "CCBot", displayName: "Common Crawl", tier: "training" },
  { name: "Amazonbot", displayName: "Amazon / Alexa", tier: "training" },
  { name: "GoogleOther", displayName: "Google / Other", tier: "training" },
  { name: "facebot", displayName: "Meta / Training", tier: "training" },
  { name: "Tastebot", displayName: "Taste / Training", tier: "training" },
  // Tier 3 — Regional / assistant
  { name: "YandexBot", displayName: "Yandex / YandexGPT", tier: "user" },
  { name: "SputnikBot", displayName: "Sber / GigaChat", tier: "user" },
  { name: "Baiduspider", displayName: "Baidu / ERNIE", tier: "user" },
  { name: "Applebot", displayName: "Apple / Siri", tier: "user" },
];

// Citation-critical bots (from geo-optimizer-skill CITATION_BOTS)
const CITATION_BOTS = ["GPTBot", "OAI-SearchBot", "Claude-Web", "ClaudeBot", "PerplexityBot", "Google-Extended", "cohere-ai"];

// ─── Schema.org required fields (from geo-optimizer-skill SCHEMA_ORG_REQUIRED) ───

interface SchemaRequiredFields {
  [type: string]: string[];
}

const SCHEMA_REQUIRED: SchemaRequiredFields = {
  product: ["name", "description", "image", "offers"],
  offer: ["price", "priceCurrency", "availability"],
  review: ["reviewRating", "author"],
  aggregaterating: ["bestRating", "reviewCount"],
  faqpage: ["mainEntity"],
  blogposting: ["headline", "datePublished", "author", "image"],
  newsarticle: ["headline", "datePublished", "author", "image"],
  howto: ["name", "step"],
  event: ["name", "startDate", "location"],
  localbusiness: ["name", "address", "telephone"],
  organization: ["name", "url"],
  person: ["name"],
  breadcrumblist: ["itemListElement"],
  webpage: ["url"],
  website: ["url"],
};

// ─── Chinese labels for check types ─────────────────────────────────────

const GEO_CHECK_LABELS: Record<string, string> = {
  robots_ai_access: "AI 爬虫可访问性",
  llms_txt: "llms.txt 文件",
  schema_product: "Product Schema",
  schema_offer: "Offer Schema（价格）",
  schema_review: "Review Schema（评价）",
  schema_faq: "FAQPage Schema",
  schema_breadcrumb: "面包屑导航 Schema",
  schema_organization: "Organization Schema",
  schema_completeness: "Schema 字段完整性",
  og_tags: "Open Graph 标签",
  twitter_cards: "Twitter Card 标签",
  content_depth: "内容深度与质量",
  content_structure: "内容结构（GEO）",
  content_front_loading: "首屏内容质量",
  heading_hierarchy: "标题层级结构",
  eeats_signals: "E-E-A-T 信任信号",
  citation_links: "外部引用链接",
  brand_entity: "品牌实体信号",
  princeton_methods: "Princeton 引用方法",
  ai_discovery: "AI 发现端点",
};

// ─── API Routes ─────────────────────────────────────────────────────────

// POST /api/geo/check — One-time GEO体检 (no auth required for free tier)
const checkSchema = z.object({
  url: z.string().url(),
});

geoApp.post("/check", zValidator("json", checkSchema), async (c) => {
  const { url } = c.req.valid("json");
  const env = c.env;

  console.log(`[GEO] Checking ${url}`);

  // Fetch the page
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      cf: { scrapeShield: false },
    });
  } catch (err) {
    return c.json({ error: `无法访问该网站: ${err}` }, 502);
  }

  const html = await response.text();
  const parser = new (globalThis as any).DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Run all GEO checks
  const result = await runFullGeoAudit(url, html, doc, env);

  return c.json({
    url,
    geo_score: result.totalScore,
    band: result.band,
    score_breakdown: result.scoreBreakdown,
    checks: result.checks.map((ck) => ({
      type: ck.check_type,
      label: GEO_CHECK_LABELS[ck.check_type] || ck.check_type,
      status: ck.status,
      score: ck.score,
      max_score: ck.maxScore,
      details: ck.details,
    })),
    ecommerce_profile: result.ecommerceProfile,
    scanned_at: new Date().toISOString(),
  });
});

// GET /api/geo/report/:siteId — Get GEO report for a monitored site (requires auth)
geoApp.get("/report/:siteId", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");

  const site = await c.env.DB.prepare(
    "SELECT id, url, name FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();

  if (!site) return c.json({ error: "Site not found" }, 404);

  const { results } = await c.env.DB.prepare(GEO_QUERIES.LIST_BY_SITE_LATEST)
    .bind(siteId)
    .all();

  const checks = (results || []).map((r: any) => {
    let details;
    try { details = JSON.parse(r.details_json); } catch { details = {}; }
    return {
      type: r.check_type,
      label: GEO_CHECK_LABELS[r.check_type] || r.check_type,
      status: r.status,
      score: r.score,
      max_score: r.max_score,
      details,
    };
  });

  const latestScan = await c.env.DB.prepare(SCAN_QUERIES.GET_LATEST)
    .bind(siteId)
    .first();

  let geoScore = 0;
  if (latestScan) {
    const scoreRow = await c.env.DB.prepare(GEO_SCORE_QUERY)
      .bind((latestScan as any).id)
      .first();
    geoScore = (scoreRow as any)?.geo_score ?? 0;
  }

  return c.json({
    site: site as any,
    geo_score: geoScore,
    checks,
    scanned_at: latestScan ? (latestScan as any).scanned_at : null,
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GEO Audit Engine — ported from geo-optimizer-skill + geo-lint + GEO-AI
// ═══════════════════════════════════════════════════════════════════════

export interface GeoCheck {
  check_type: string;
  status: "pass" | "warn" | "fail";
  score: number;
  maxScore: number;
  details: Record<string, any>;
}

export interface GeoAuditResult {
  totalScore: number;
  band: string;
  scoreBreakdown: Record<string, number>;
  checks: GeoCheck[];
  ecommerceProfile?: Record<string, any>;
}

// Score bands (from geo-optimizer-skill SCORE_BANDS)
function getBand(score: number): string {
  if (score >= 86) return "excellent";
  if (score >= 68) return "good";
  if (score >= 36) return "foundation";
  return "critical";
}

// ─── robots.txt parser (ported from geo-optimizer-skill robots_parser.py) ───

interface RobotRule {
  allow: string[];
  disallow: string[];
  crawlDelay: number | null;
}

function parseRobotsTxt(content: string): Map<string, RobotRule> {
  const rules = new Map<string, RobotRule>();
  let currentAgent: string | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.substring(0, colonIdx).trim().toLowerCase();
    const value = line.substring(colonIdx + 1).trim();

    if (key === "user-agent") {
      currentAgent = value.toLowerCase();
      if (!rules.has(currentAgent)) {
        rules.set(currentAgent, { allow: [], disallow: [], crawlDelay: null });
      }
    } else if (currentAgent !== null) {
      const rule = rules.get(currentAgent)!;
      if (key === "allow" && value) rule.allow.push(value);
      if (key === "disallow" && value) rule.disallow.push(value);
      if (key === "crawl-delay") rule.crawlDelay = parseFloat(value) || null;
    }
  }
  return rules;
}

// Check if a bot is blocked (from geo-optimizer-skill classify_bot)
function isBotBlocked(botName: string, agentRules: Map<string, RobotRule>): { blocked: boolean; viaWildcard: boolean } {
  const botLower = botName.toLowerCase();

  // Check explicit rule first
  if (agentRules.has(botLower)) {
    const rule = agentRules.get(botLower)!;
    if (rule.disallow.length > 0 && rule.disallow.some((d) => d === "/" || d === "")) {
      return { blocked: true, viaWildcard: false };
    }
    if (rule.allow.length > 0) return { blocked: false, viaWildcard: false };
    // Has explicit rule but no disallow of / → allowed
    return { blocked: false, viaWildcard: false };
  }

  // Fall back to wildcard
  const wildcard = agentRules.get("*");
  if (wildcard) {
    const blocked = wildcard.disallow.length > 0 && wildcard.disallow.some((d) => d === "/" || d === "");
    return { blocked, viaWildcard: true };
  }

  // No rules at all → allowed by default
  return { blocked: false, viaWildcard: false };
}

// ─── JSON-LD extraction (from geo-optimizer-skill audit_schema.py) ───

function extractJsonLd(html: string, doc: any): any[] {
  const blocks: any[] = [];
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      let data = JSON.parse(script.textContent || "{}");
      // Handle @graph arrays (from geo-optimizer-skill @graph parser for Yoast/RankMath)
      if (data["@graph"]) {
        for (const item of data["@graph"]) {
          blocks.push(item);
        }
      } else {
        blocks.push(data);
      }
    } catch { /* skip invalid JSON-LD */ }
  }

  // Also check meta tags for non-JSON-LD schema (fallback)
  if (blocks.length === 0) {
    const metaType = doc.querySelector('meta[name="application/ld+json"]');
    if (metaType) {
      try { blocks.push(JSON.parse(metaType.getAttribute("content") || "{}")); } catch {}
    }
  }
  return blocks;
}

function getSchemaTypes(schemaObj: any): string[] {
  const t = schemaObj?.["@type"];
  if (Array.isArray(t)) return t.map((x: string) => x.toLowerCase());
  if (typeof t === "string") return [t.toLowerCase()];
  return [];
}

// ─── Schema completeness check (from geo-optimizer-skill SCHEMA_ORG_REQUIRED) ───

function checkSchemaCompleteness(jsonLdBlocks: any[]): { complete: string[]; incomplete: Record<string, string[]>; missingTotal: number } {
  const complete: string[] = [];
  const incomplete: Record<string, string[]> = {};
  let missingTotal = 0;

  for (const block of jsonLdBlocks) {
    const types = getSchemaTypes(block);
    for (const t of types) {
      if (t in SCHEMA_REQUIRED) {
        const required = SCHEMA_REQUIRED[t];
        const missing = required.filter((f) => !(f in block) || !block[f]);
        if (missing.length === 0) {
          complete.push(t);
        } else {
          incomplete[t] = missing;
          missingTotal += missing.length;
        }
      }
    }
  }
  return { complete, incomplete, missingTotal };
}

// ─── E-commerce profile (from geo-optimizer-skill ecommerce_signals + GEO-AI ProductResource) ───

function analyzeEcommerceSchema(jsonLdBlocks: any[]): Record<string, any> | null {
  for (const block of jsonLdBlocks) {
    const types = getSchemaTypes(block);
    if (!types.includes("product")) continue;

    const offers = (block.offers || block.offer || {});
    const offerList = Array.isArray(offers) ? offers[0] || {} : offers;

    return {
      has_price: !!(offerList.price || offerList.lowPrice),
      has_availability: !!offerList.availability,
      has_brand: !!block.brand,
      has_image: !!block.image,
      has_reviews: !!(block.aggregateRating || block.review),
      has_description: !!block.description,
      complete: false, // computed below
    };
  }
  return null;
}

// ─── Content quality checks (from geo-optimizer-skill audit_content.py + geo-lint) ───

function stripHtmlTags(html: string): string {
  const doc = new (globalThis as any).DOMParser().parseFromString(html, "text/html");
  // Remove script/style (from geo-optimizer-skill: soup_clean decomposition)
  const scripts = doc.querySelectorAll("script, style, nav, footer, header");
  scripts.forEach((el: Element) => el.remove());
  return doc.body?.innerText?.trim() || "";
}

// Content structure analysis (from geo-lint geo-structure-rules.ts)
function analyzeContentStructure(doc: any) {
  const h2Sections = doc.querySelectorAll("h2");
  const h3Sections = doc.querySelectorAll("h3");
  const paragraphs = doc.querySelectorAll("p");
  const lists = doc.querySelectorAll("ul, ol");
  const tables = doc.querySelectorAll("table");
  const blockquotes = doc.querySelectorAll("blockquote");
  const codeBlocks = doc.querySelectorAll("pre, code");

  // Check for FAQ section (from geo-lint hasFAQSection)
  const hasFaqSection = Array.from(h2Sections).some(
    (el: any) => /faq|常见问题|问答|frequently.asked/i.test(el.textContent)
  );

  // Check for question headings (from geo-lint countQuestionHeadings)
  const allHeadings = doc.querySelectorAll("h1, h2, h3, h4");
  const questionHeadings = Array.from(allHeadings).filter(
    (el: any) => /\?|¿/.test(el.textContent)
  );

  // Check for TL;DR / summary section (from geo-lint geo-missing-summary-section)
  const hasSummary = Array.from(allHeadings).some(
    (el: any) => /tl;?dr|总结|摘要|key.takeaway|结论|conclusion/i.test(el.textContent)
  );

  // Structural element count (from geo-lint countStructuralElements)
  const structuralCount = lists.length + tables.length + blockquotes.length + codeBlocks.length;

  return {
    h2Count: h2Sections.length,
    h3Count: h3Sections.length,
    paragraphCount: paragraphs.length,
    listCount: lists.length,
    tableCount: tables.length,
    structuralCount,
    hasFaqSection,
    questionHeadingCount: questionHeadings.length,
    hasSummary,
  };
}

// Front-loading check (from geo-optimizer-skill: first 30% must have >= 50 words + numbers)
function checkFrontLoading(bodyText: string): { pass: boolean; wordCount: number; first30Words: number; hasNumbers: boolean } {
  const words = bodyText.split(/\s+/).filter((w: string) => w.length > 0);
  const totalWords = words.length;
  if (totalWords === 0) return { pass: false, wordCount: 0, first30Words: 0, hasNumbers: false };

  const first30Idx = Math.max(Math.floor(totalWords * 0.3), 1);
  const first30Words = words.slice(0, first30Idx).length;
  const hasNumbers = words.slice(0, first30Idx).some((w: string) => /\d/.test(w));

  return {
    pass: first30Words >= 50 && hasNumbers,
    wordCount: totalWords,
    first30Words,
    hasNumbers,
  };
}

// External citation links (from geo-optimizer-skill: external_links)
function countExternalLinks(doc: any, baseUrl: string): { count: number; links: string[] } {
  try {
    const parsed = new URL(baseUrl);
    const baseDomain = parsed.hostname;
    const allLinks = doc.querySelectorAll("a[href]");
    const externals: string[] = [];
    allLinks.forEach((a: Element) => {
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("http")) return;
      try {
        const linkHost = new URL(href).hostname;
        if (linkHost !== baseDomain) externals.push(href);
      } catch { /* skip invalid URLs */ }
    });
    return { count: externals.length, links: externals.slice(0, 10) };
  } catch {
    return { count: 0, links: [] };
  }
}

// ─── Full GEO Audit (orchestrates all checks, scoring from geo-optimizer-skill) ───

export async function runFullGeoAudit(baseUrl: string, html: string, doc: any, env: Env): Promise<GeoAuditResult> {
  const checks: GeoCheck[] = [];
  const scoreBreakdown: Record<string, number> = {};

  // Parse once
  const jsonLdBlocks = extractJsonLd(html, doc);
  const bodyText = stripHtmlTags(html);
  const words = bodyText.split(/\s+/).filter((w: string) => w.length > 0);

  // Fetch robots.txt and llms.txt in parallel (from geo-optimizer-skill async audit pattern)
  const robotsUrl = new URL("/robots.txt", baseUrl).href;
  const llmsUrl = new URL("/llms.txt", baseUrl).href;
  const llmsFullUrl = new URL("/llms-full.txt", baseUrl).href;

  let robotsResp: Response | null = null;
  let llmsResp: Response | null = null;
  let llmsFullResp: Response | null = null;

  try { robotsResp = await fetch(robotsUrl, { redirect: "follow", cf: { scrapeShield: false } }); } catch {}
  try { llmsResp = await fetch(llmsUrl, { redirect: "follow", cf: { scrapeShield: false } }); } catch {}
  try { llmsFullResp = await fetch(llmsFullUrl, { redirect: "follow", cf: { scrapeShield: false } }); } catch {}

  // ═══════════════════════════════════════════════════════════════════
  // Category 1: Robots / AI Crawler Access (max 18 pts, from geo-optimizer-skill)
  // ═══════════════════════════════════════════════════════════════════
  {
    const maxScore = 18;
    let score = 0;
    const details: Record<string, any> = { bots_allowed: [], bots_blocked: [], bots_missing: [], citation_bots_explicit: false };

    if (robotsResp && robotsResp.status === 200) {
      const robotsText = await robotsResp.text();
      const agentRules = parseRobotsTxt(robotsText);
      details.found = true;

      // Classify each bot (from geo-optimizer-skill classify_bot logic)
      for (const bot of AI_BOTS) {
        const { blocked, viaWildcard } = isBotBlocked(bot.name, agentRules);
        if (blocked) {
          details.bots_blocked.push(bot.name);
        } else if (!agentRules.has(bot.name.toLowerCase()) && !agentRules.has("*")) {
          details.bots_missing.push(bot.name);
        } else {
          details.bots_allowed.push(bot.name);
        }
      }

      // Citation bots explicit check (from geo-optimizer-skill #111)
      const citationExplicit = CITATION_BOTS.filter((cb) => {
        const { blocked, viaWildcard } = isBotBlocked(cb, agentRules);
        return !blocked && !viaWildcard;
      });
      details.citation_bots_explicit = citationExplicit.length === CITATION_BOTS.length;

      // Scoring (from geo-optimizer-skill robots scoring):
      // +6 for robots.txt found
      score += 6;
      // +4 for all citation bots allowed
      if (details.bots_blocked.filter((b: string) => CITATION_BOTS.includes(b)).length === 0) score += 4;
      // +4 for citation bots explicitly allowed (not via wildcard)
      if (details.citation_bots_explicit) score += 4;
      // +4 for no search-tier bots blocked
      const searchTierBlocked = AI_BOTS.filter((b) => b.tier === "search" && details.bots_blocked.includes(b.name));
      if (searchTierBlocked.length === 0) score += 4;
    } else {
      details.found = false;
      details.message = "未找到 robots.txt 文件";
    }

    details.blocked_citation_bots = details.bots_blocked.filter((b: string) => CITATION_BOTS.includes(b));
    details.total_bots_checked = AI_BOTS.length;

    checks.push({
      check_type: "robots_ai_access",
      status: score >= maxScore * 0.7 ? "pass" : score >= maxScore * 0.3 ? "warn" : "fail",
      score: Math.min(score, maxScore),
      maxScore,
      details,
    });
    scoreBreakdown.robots = Math.min(score, maxScore);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Category 2: llms.txt (max 14 pts, from geo-optimizer-skill llms scoring)
  // ═══════════════════════════════════════════════════════════════════
  {
    const maxScore = 14;
    let score = 0;
    const details: Record<string, any> = { found: false };

    if (llmsResp && llmsResp.status === 200) {
      const content = (await llmsResp.text()).trim();
      details.found = true;
      details.word_count = content.split(/\s+/).length;

      const lines = content.split("\n");
      // Check spec v2 compliance (from geo-optimizer-skill _validate_llms_content)
      const h1Lines = lines.filter((l: string) => l.startsWith("# "));
      const h2Lines = lines.filter((l: string) => l.startsWith("## "));
      const blockquoteLines = lines.filter((l: string) => l.startsWith("> "));

      details.has_h1 = h1Lines.length > 0;
      details.has_description = blockquoteLines.length > 0;
      details.has_sections = h2Lines.length > 0;
      details.sections_count = h2Lines.length;

      // Scoring (graduated from geo-optimizer-skill v3.14+):
      // +4 for llms.txt found
      score += 4;
      // +2 for H1 title
      if (details.has_h1) score += 2;
      // +2 for blockquote description
      if (details.has_description) score += 2;
      // +2 for sections (H2)
      if (details.has_sections) score += 2;
      // +2 for 50+ words
      if (details.word_count >= 50) score += 2;
      // +2 for llms-full.txt
      if (llmsFullResp && llmsFullResp.status === 200 && (await llmsFullResp!.text()).trim().length > 0) {
        details.has_full = true;
        score += 2;
      }
    }

    checks.push({
      check_type: "llms_txt",
      status: score >= maxScore * 0.7 ? "pass" : score >= maxScore * 0.3 ? "warn" : "fail",
      score: Math.min(score, maxScore),
      maxScore,
      details,
    });
    scoreBreakdown.llms = Math.min(score, maxScore);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Category 3: Schema.org (max 16 pts, from geo-optimizer-skill + geo-lint)
  // ═══════════════════════════════════════════════════════════════════
  {
    const maxScore = 16;
    let score = 0;
    const schemaTypes = new Set<string>();
    jsonLdBlocks.forEach((b) => getSchemaTypes(b).forEach((t) => schemaTypes.add(t)));

    const completeness = checkSchemaCompleteness(jsonLdBlocks);

    // Schema richness scoring (from geo-optimizer-skill SCHEMA_RICHNESS tiers)
    const hasProduct = schemaTypes.has("product");
    const hasFAQ = schemaTypes.has("faqpage");
    const hasBreadcrumb = schemaTypes.has("breadcrumblist");
    const hasOrg = schemaTypes.has("organization");
    const hasBlog = schemaTypes.has("blogposting") || schemaTypes.has("newsarticle");
    const hasHowTo = schemaTypes.has("howto");
    const hasReview = schemaTypes.has("review") || schemaTypes.has("aggregaterating");
    const hasOffer = schemaTypes.has("offer");

    const richnessCount = [hasProduct, hasFAQ, hasBreadcrumb, hasOrg, hasBlog, hasHowTo, hasReview, hasOffer].filter(Boolean).length;

    // +6 for richness (0-1 for low, 2-3 for medium, 4+ for high)
    if (richnessCount >= 4) score += 6;
    else if (richnessCount >= 2) score += 3;
    else if (richnessCount >= 1) score += 1;

    // +5 for completeness (all found types have required fields)
    if (completeness.complete.length > 0 && completeness.missingTotal === 0) score += 5;
    else if (completeness.complete.length > 0) score += Math.round(5 * (completeness.complete.length / (completeness.complete.length + completeness.missingTotal)));

    // +5 for e-commerce specific schemas
    if (hasProduct && hasOffer && hasReview) score += 5;
    else if (hasProduct && (hasOffer || hasReview)) score += 3;
    else if (hasProduct) score += 1;

    checks.push({
      check_type: "schema_completeness",
      status: score >= maxScore * 0.7 ? "pass" : score >= maxScore * 0.3 ? "warn" : "fail",
      score: Math.min(score, maxScore),
      maxScore,
      details: {
        types_found: Array.from(schemaTypes),
        richness_count: richnessCount,
        complete_types: completeness.complete,
        incomplete_types: completeness.incomplete,
        has_product: hasProduct,
        has_faq: hasFAQ,
        has_breadcrumb: hasBreadcrumb,
        has_organization: hasOrg,
      },
    });

    // Individual schema checks for granular reporting
    const individualSchemas = [
      { type: "product", checkType: "schema_product", label: "Product" },
      { type: "offer", checkType: "schema_offer", label: "Offer" },
      { type: "review", checkType: "schema_review", label: "Review" },
      { type: "faqpage", checkType: "schema_faq", label: "FAQPage" },
      { type: "breadcrumblist", checkType: "schema_breadcrumb", label: "BreadcrumbList" },
      { type: "organization", checkType: "schema_organization", label: "Organization" },
    ];

    for (const s of individualSchemas) {
      const found = schemaTypes.has(s.type);
      const incompleteForType = completeness.incomplete[s.type] || [];
      checks.push({
        check_type: s.checkType,
        status: found && incompleteForType.length === 0 ? "pass" : found ? "warn" : "fail",
        score: found ? (incompleteForType.length === 0 ? 100 : 50) : 0,
        maxScore: 100,
        details: found
          ? { found: true, missing_fields: incompleteForType }
          : { found: false, fix: `添加 ${s.label} JSON-LD 结构化数据` },
      });
    }

    scoreBreakdown.schema = Math.min(score, maxScore);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Category 4: Meta / OG Tags (max 10 pts)
  // ═══════════════════════════════════════════════════════════════════
  {
    const maxScore = 10;
    let score = 0;
    const details: Record<string, any> = {};

    // OG tags (from geo-lint og-rules.ts)
    const ogTags: Record<string, string> = {};
    doc.querySelectorAll('meta[property^="og:"]').forEach((m: Element) => {
      ogTags[m.getAttribute("property") || ""] = m.getAttribute("content") || "";
    });

    const requiredOg = ["og:title", "og:description", "og:image", "og:url"];
    const missingOg = requiredOg.filter((t) => !ogTags[t] || !ogTags[t].trim());
    details.og_found = requiredOg.filter((t) => ogTags[t]).length;
    details.og_missing = missingOg;

    if (missingOg.length === 0) score += 4;
    else if (missingOg.length <= 1) score += 2;

    // Twitter cards
    const twTags: Record<string, string> = {};
    doc.querySelectorAll('meta[name^="twitter:"]').forEach((m: Element) => {
      twTags[m.getAttribute("name") || ""] = m.getAttribute("content") || "";
    });
    const requiredTw = ["twitter:card", "twitter:title", "twitter:description"];
    const missingTw = requiredTw.filter((t) => !twTags[t]);
    details.twitter_found = requiredTw.filter((t) => twTags[t]).length;

    if (missingTw.length === 0) score += 3;
    else if (missingTw.length <= 1) score += 1;

    // Meta description
    const metaDesc = doc.querySelector('meta[name="description"]');
    if (metaDesc && metaDesc.getAttribute("content") && metaDesc.getAttribute("content")!.length >= 50) {
      score += 3;
      details.has_meta_description = true;
    } else {
      details.has_meta_description = false;
    }

    checks.push({
      check_type: "og_tags",
      status: score >= maxScore * 0.7 ? "pass" : score >= maxScore * 0.3 ? "warn" : "fail",
      score: Math.min(score, maxScore),
      maxScore,
      details,
    });
    scoreBreakdown.meta = Math.min(score, maxScore);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Category 5: Content Quality (max 12 pts, from geo-optimizer-skill + geo-lint)
  // ═══════════════════════════════════════════════════════════════════
  {
    const maxScore = 12;
    let score = 0;
    const structure = analyzeContentStructure(doc);
    const frontLoad = checkFrontLoading(bodyText);
    const extLinks = countExternalLinks(doc, baseUrl);
    const h1 = doc.querySelector("h1");

    // +3 for content depth (word count >= 300, ratio >= 0.1)
    const htmlLen = html.length;
    const textLen = bodyText.length;
    const ratio = htmlLen > 0 ? textLen / htmlLen : 0;
    if (words.length >= 300 && ratio >= 0.1) score += 3;
    else if (words.length >= 100) score += 1;

    // +3 for front-loading (from geo-optimizer-skill)
    if (frontLoad.pass) score += 3;
    else if (frontLoad.wordCount >= 50) score += 1;

    // +2 for heading hierarchy (H1 + H2 + H3)
    if (h1 && structure.h2Count > 0 && structure.h3Count > 0) score += 2;
    else if (h1 && structure.h2Count > 0) score += 1;

    // +2 for external citation links (from geo-optimizer-skill)
    if (extLinks.count >= 3) score += 2;
    else if (extLinks.count >= 1) score += 1;

    // +2 for numbers/statistics in content (from geo-optimizer-skill has_numbers)
    const numbers = bodyText.match(/\b\d+[%€$£]|\b\d+\.\d+|\b\d{3,}\b/g);
    if (numbers && numbers.length >= 3) score += 2;
    else if (numbers && numbers.length >= 1) score += 1;

    checks.push({
      check_type: "content_depth",
      status: score >= maxScore * 0.7 ? "pass" : score >= maxScore * 0.3 ? "warn" : "fail",
      score: Math.min(score, maxScore),
      maxScore,
      details: {
        word_count: words.length,
        text_ratio: Math.round(ratio * 100) / 100,
        has_h1: !!h1,
        h1_text: h1?.textContent?.trim()?.slice(0, 80),
      },
    });

    // Content structure check (from geo-lint geo-structure-rules)
    {
      const structMax = 6;
      let structScore = 0;
      if (structure.listCount > 0) structScore += 2;
      if (structure.tableCount > 0) structScore += 1;
      if (structure.hasFaqSection) structScore += 1;
      if (structure.questionHeadingCount >= 2) structScore += 1;
      if (structure.hasSummary) structScore += 1;

      checks.push({
        check_type: "content_structure",
        status: structScore >= 4 ? "pass" : structScore >= 2 ? "warn" : "fail",
        score: structScore * 100 / structMax,
        maxScore: 100,
        details: {
          h2_count: structure.h2Count,
          h3_count: structure.h3Count,
          list_count: structure.listCount,
          table_count: structure.tableCount,
          has_faq_section: structure.hasFaqSection,
          question_headings: structure.questionHeadingCount,
          has_summary: structure.hasSummary,
        },
      });
    }

    // Front-loading detail (from geo-optimizer-skill)
    checks.push({
      check_type: "content_front_loading",
      status: frontLoad.pass ? "pass" : frontLoad.wordCount >= 30 ? "warn" : "fail",
      score: frontLoad.pass ? 100 : frontLoad.hasNumbers ? 50 : 20,
      maxScore: 100,
      details: {
        total_words: frontLoad.wordCount,
        first_30pct_words: frontLoad.first30Words,
        has_numbers_in_first_30: frontLoad.hasNumbers,
        fix: frontLoad.pass ? undefined : "在文章前 30% 加入具体数据和核心信息",
      },
    });

    // Heading hierarchy
    checks.push({
      check_type: "heading_hierarchy",
      status: h1 && structure.h2Count > 0 && structure.h3Count > 0 ? "pass" : structure.h2Count > 0 ? "warn" : "fail",
      score: h1 && structure.h2Count > 0 && structure.h3Count > 0 ? 100 : structure.h2Count > 0 ? 60 : 20,
      maxScore: 100,
      details: { has_h1: !!h1, h2_count: structure.h2Count, h3_count: structure.h3Count },
    });

    // Citation links (from geo-optimizer-skill external_links)
    checks.push({
      check_type: "citation_links",
      status: extLinks.count >= 3 ? "pass" : extLinks.count >= 1 ? "warn" : "fail",
      score: Math.min(extLinks.count * 25, 100),
      maxScore: 100,
      details: { count: extLinks.count, sample_links: extLinks.links.slice(0, 5) },
    });

    scoreBreakdown.content = Math.min(score, maxScore);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Category 6: E-E-A-T / Trust signals (max 6 pts, from geo-lint geo-eeat-rules)
  // ═══════════════════════════════════════════════════════════════════
  {
    const maxScore = 6;
    let score = 0;
    const details: Record<string, any> = {};

    // Check for author signals (from geo-lint geo-missing-author)
    const hasAuthorSchema = jsonLdBlocks.some((b) => {
      const types = getSchemaTypes(b);
      return types.includes("person") || types.includes("organization");
    });
    details.has_author_signal = hasAuthorSchema;
    if (hasAuthorSchema) score += 2;

    // Check for contact info (from geo-lint E-E-A-T)
    const hasPhone = /tel:|(\+\d{1,3}[\s\-]?\d+)/.test(bodyText);
    const hasEmail = /[\w.+-]+@[\w-]+\.\w{2,}/.test(bodyText);
    details.has_contact = hasPhone || hasEmail;
    if (hasPhone || hasEmail) score += 1;

    // Check for "about" or "team" page links
    const allLinks = doc.querySelectorAll("a[href]");
    const hasAbout = Array.from(allLinks).some((a: any) => {
      const text = (a.textContent || "").toLowerCase();
      const href = (a.getAttribute("href") || "").toLowerCase();
      return /about|关于我们|团队|team/.test(text) || /about|团队/.test(href);
    });
    details.has_about_page = hasAbout;
    if (hasAbout) score += 1;

    // Check for source citations in content (from geo-lint geo-missing-source-citations)
    const citationPatterns = bodyText.match(/\(.*?\)/g);
    const hasCitations = citationPatterns && citationPatterns.length >= 2;
    details.citation_count = citationPatterns?.length || 0;
    if (hasCitations) score += 2;

    checks.push({
      check_type: "eeats_signals",
      status: score >= maxScore * 0.7 ? "pass" : score >= maxScore * 0.3 ? "warn" : "fail",
      score,
      maxScore,
      details,
    });
    scoreBreakdown.signals = Math.min(score, maxScore);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Category 7: Brand & Entity (max 10 pts, from Auriti-Labs)
  // ═══════════════════════════════════════════════════════════════════
  {
    const brandResult = checkBrandEntity(html, bodyText, baseUrl, jsonLdBlocks);
    checks.push({
      check_type: "brand_entity",
      status: brandResult.score >= 7 ? "pass" : brandResult.score >= 4 ? "warn" : "fail",
      score: brandResult.score,
      maxScore: brandResult.maxScore,
      details: brandResult.details,
    });
    scoreBreakdown.brand = brandResult.score;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Category 8: Princeton Citation Methods (max 12 pts)
  // ═══════════════════════════════════════════════════════════════════
  {
    const princetonResult = checkPrincetonMethods(bodyText, doc, html);
    checks.push({
      check_type: "princeton_methods",
      status: princetonResult.score >= 8 ? "pass" : princetonResult.score >= 4 ? "warn" : "fail",
      score: princetonResult.score,
      maxScore: princetonResult.maxScore,
      details: {
        ...princetonResult.details,
        methods: princetonResult.methods.map((m) => ({
          name: m.name,
          impact: m.impact,
          detected: m.detected,
        })),
      },
    });
    scoreBreakdown.princeton = princetonResult.score;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Category 9: AI Discovery (max 6 pts, forward-looking)
  // ═══════════════════════════════════════════════════════════════════
  {
    try {
      const aiDiscoveryResult = await checkAiDiscovery(baseUrl, html, doc);
      checks.push({
        check_type: "ai_discovery",
        status: aiDiscoveryResult.score >= 4 ? "pass" : aiDiscoveryResult.score >= 2 ? "warn" : "fail",
        score: aiDiscoveryResult.score,
        maxScore: aiDiscoveryResult.maxScore,
        details: aiDiscoveryResult.details,
      });
      scoreBreakdown.aiDiscovery = aiDiscoveryResult.score;
    } catch {
      // AI discovery is forward-looking — don't fail if check errors
      scoreBreakdown.aiDiscovery = 0;
    }
  }

  // ─── Compute total score ──────────────────────────────────────────
  const totalScore = Math.round(
    (scoreBreakdown.robots || 0) +
    (scoreBreakdown.llms || 0) +
    (scoreBreakdown.schema || 0) +
    (scoreBreakdown.meta || 0) +
    (scoreBreakdown.content || 0) +
    (scoreBreakdown.signals || 0) +
    (scoreBreakdown.brand || 0) +
    (scoreBreakdown.princeton || 0) +
    (scoreBreakdown.aiDiscovery || 0)
  );

  // E-commerce profile (from geo-optimizer-skill ecommerce_signals + GEO-AI)
  const ecommerceProfile = analyzeEcommerceSchema(jsonLdBlocks);
  if (ecommerceProfile) {
    ecommerceProfile.complete = Object.entries(ecommerceProfile)
      .filter(([k]) => k !== "complete")
      .every(([, v]) => v === true);
  }

  return {
    totalScore,
    band: getBand(totalScore),
    scoreBreakdown,
    checks,
    ecommerceProfile: ecommerceProfile ?? undefined,
  };
}

export default geoApp;
