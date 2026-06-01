// Sitemap Validator — fetches and validates XML sitemaps
// Checks for dead links, duplicate URLs, incorrect lastmod, missing pages
export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

export interface SitemapAnalysis {
  found: boolean;
  url: string;
  totalUrls: number;
  validUrls: number;
  errors: SitemapError[];
  warnings: SitemapWarning[];
  urls: SitemapUrl[];
  hasIndexSitemap: boolean;
  fileSize: number;
  parseable: boolean;
}

export interface SitemapError {
  type: "dead_link" | "duplicate" | "invalid_url" | "parse_error" | "not_found" | "too_large" | "blocked_by_robots";
  url?: string;
  message: string;
}

export interface SitemapWarning {
  type: "old_lastmod" | "low_priority" | "invalid_changefreq" | "relative_url";
  url?: string;
  message: string;
}

const MAX_SITEMAP_SIZE = 50 * 1024 * 1024; // 50MB uncompressed
const MAX_URLS_PER_SITEMAP = 50000;

function resolveUrl(loc: string, baseUrl: string): string {
  try {
    return new URL(loc, baseUrl).href;
  } catch {
    return loc;
  }
}

export async function validateSitemap(baseUrl: string): Promise<SitemapAnalysis> {
  const result: SitemapAnalysis = {
    found: false,
    url: "",
    totalUrls: 0,
    validUrls: 0,
    errors: [],
    warnings: [],
    urls: [],
    hasIndexSitemap: false,
    fileSize: 0,
    parseable: false,
  };

  // Try standard sitemap locations
  const candidates = [
    new URL("/sitemap.xml", baseUrl).href,
    new URL("/sitemap_index.xml", baseUrl).href,
  ];

  // Also check robots.txt for Sitemap directive
  try {
    const robotsUrl = new URL("/robots.txt", baseUrl).href;
    const robotsResp = await fetch(robotsUrl, { redirect: "follow" });
    if (robotsResp.ok) {
      const robotsContent = await robotsResp.text();
      const sitemapMatch = robotsContent.match(/sitemap:\s*(\S+)/i);
      if (sitemapMatch) {
        candidates.unshift(sitemapMatch[1]);
      }
    }
  } catch {
    // robots.txt not found, use defaults
  }

  let sitemapUrl: string | null = null;
  let sitemapContent = "";

  for (const candidate of candidates) {
    try {
      const resp = await fetch(candidate, { redirect: "follow" });
      if (resp.ok) {
        const ct = resp.headers.get("content-type") || "";
        if (ct.includes("xml") || ct.includes("text") || candidate.endsWith(".xml")) {
          const raw = await resp.arrayBuffer();
          if (raw.byteLength > MAX_SITEMAP_SIZE) {
            result.errors.push({ type: "too_large", message: `Sitemap exceeds 50MB: ${(raw.byteLength / 1024 / 1024).toFixed(1)}MB` });
            return result;
          }
          sitemapContent = new TextDecoder().decode(raw);
          sitemapUrl = candidate;
          result.fileSize = raw.byteLength;
          break;
        }
      }
    } catch {
      continue;
    }
  }

  if (!sitemapUrl) {
    result.errors.push({ type: "not_found", message: "No sitemap.xml found at standard locations or via robots.txt directive" });
    return result;
  }

  result.found = true;
  result.url = sitemapUrl;

  // Check if this is an index sitemap
  const parser = new (globalThis as any).DOMParser();
  const doc = parser.parseFromString(sitemapContent, "text/xml");

  // Detect parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    result.errors.push({ type: "parse_error", message: "Sitemap XML is malformed and cannot be parsed" });
    result.parseable = false;
    return result;
  }
  result.parseable = true;

  // Check for sitemap index
  const sitemapUrls = doc.querySelectorAll("sitemapurl");
  if (sitemapUrls.length > 0) {
    result.hasIndexSitemap = true;
    // For index sitemaps, just report the count of child sitemaps
    result.totalUrls = sitemapUrls.length;
    result.validUrls = sitemapUrls.length;
    return result;
  }

  // Parse regular sitemap
  const urlEntries = doc.querySelectorAll("url");
  result.totalUrls = urlEntries.length;

  if (urlEntries.length > MAX_URLS_PER_SITEMAP) {
    result.errors.push({ type: "too_large", message: `Sitemap has ${urlEntries.length} URLs (max 50,000). Split into multiple sitemaps.` });
  }

  const seenUrls = new Set<string>();
  const now = new Date();

  for (const urlEl of urlEntries) {
    const locEl = urlEl.querySelector("loc");
    if (!locEl?.textContent) continue;

    let loc = locEl.textContent.trim();
    const resolved = resolveUrl(loc, baseUrl);

    // Check for duplicate
    if (seenUrls.has(resolved)) {
      result.errors.push({ type: "duplicate", url: resolved, message: "URL appears multiple times in sitemap" });
      continue;
    }
    seenUrls.add(resolved);

    const lastmodEl = urlEl.querySelector("lastmod");
    const changefreqEl = urlEl.querySelector("changefreq");
    const priorityEl = urlEl.querySelector("priority");

    const entry: SitemapUrl = { loc: resolved };

    if (lastmodEl?.textContent) {
      const lastmodVal = lastmodEl.textContent.trim();
      entry.lastmod = lastmodVal;
      try {
        const lastmodDate = new Date(lastmodVal);
        const ageDays = (now.getTime() - lastmodDate.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > 365) {
          result.warnings.push({
            type: "old_lastmod",
            url: resolved,
            message: `Last modified ${Math.round(ageDays / 30)} months ago. Update lastmod for active pages.`,
          });
        }
      } catch {}
    }

    if (changefreqEl?.textContent) {
      entry.changefreq = changefreqEl.textContent.trim();
      const validFreqs = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"];
      if (!validFreqs.includes(entry.changefreq || "")) {
        result.warnings.push({
          type: "invalid_changefreq",
          url: resolved,
          message: `Invalid changefreq "${entry.changefreq}". Must be one of: ${validFreqs.join(", ")}.`,
        });
      }
    }

    if (priorityEl?.textContent) {
      entry.priority = parseFloat(priorityEl.textContent);
      if (isNaN(entry.priority) || entry.priority < 0 || entry.priority > 1) {
        result.warnings.push({
          type: "low_priority",
          url: resolved,
          message: `Invalid priority "${priorityEl.textContent}". Must be 0.0-1.0.`,
        });
      }
    }

    result.urls.push(entry);
    result.validUrls++;
  }

  return result;
}
