// Multi-page Crawler — crawls a site's pages for full-site audit
// Replaces single-page scan with configurable depth/breadth crawl
import type { Env } from "../index";

export interface CrawledPage {
  url: string;
  html: string;
  status: number;
  contentType: string;
  loadTimeMs: number;
  doc: any; // DOMParser result
}

export interface CrawlResult {
  pages: CrawledPage[];
  totalDiscovered: number;
  totalCrawled: number;
  errors: { url: string; error: string }[];
}

export interface CrawlOptions {
  maxPages?: number;       // max pages to crawl (default 20)
  maxDepth?: number;       // max crawl depth (default 2)
  followExternal?: boolean; // follow external links (default false)
  respectRobots?: boolean;  // respect robots.txt (default true)
}

const DEFAULT_OPTIONS: Required<CrawlOptions> = {
  maxPages: 20,
  maxDepth: 2,
  followExternal: false,
  respectRobots: true,
};

function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(href, baseUrl);
    // Skip non-http, anchors, mailto, tel, etc.
    if (!resolved.protocol.startsWith("http")) return null;
    // Strip fragment
    resolved.hash = "";
    // Strip query params for dedup (treat ?utm=... as same page)
    const str = resolved.toString();
    return str;
  } catch {
    return null;
  }
}

function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).hostname === new URL(baseUrl).hostname;
  } catch {
    return false;
  }
}

// Extract internal links from HTML
function extractLinks(html: string, baseUrl: string, followExternal: boolean): string[] {
  const parser = new (globalThis as any).DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const links = doc.querySelectorAll("a[href]");
  const seen = new Set<string>();
  const base = new URL(baseUrl);

  for (const a of links) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    const normalized = normalizeUrl(href, baseUrl);
    if (!normalized || seen.has(normalized)) continue;
    if (!followExternal && !isSameDomain(normalized, baseUrl)) continue;
    seen.add(normalized);
  }

  return [...seen];
}

// Check if URL is allowed by robots.txt
async function isAllowedByRobots(baseUrl: string, targetUrl: string, env: Env): Promise<boolean> {
  try {
    const robotsUrl = new URL("/robots.txt", baseUrl).toString();
    const resp = await fetch(robotsUrl, { redirect: "follow" });
    if (resp.status !== 200) return true; // No robots.txt = allow all
    const content = await resp.text();
    // Simple disallow check
    const lines = content.split("\n");
    let currentAgent: string | null = null;
    const targetPath = new URL(targetUrl).pathname;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();

      if (key === "user-agent") {
        currentAgent = value.toLowerCase();
      } else if (key === "disallow" && currentAgent === "googlebot") {
        if (value && targetPath.startsWith(value.replace("*", ""))) return false;
      }
    }
    return true;
  } catch {
    return true; // If can't fetch robots.txt, allow
  }
}

export async function crawlSite(baseUrl: string, env: Env, options?: CrawlOptions): Promise<CrawlResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const normalized = normalizeUrl(baseUrl, baseUrl)!;
  const result: CrawlResult = { pages: [], totalDiscovered: 0, totalCrawled: 0, errors: [] };

  // BFS crawl
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: normalized, depth: 0 }];
  visited.add(normalized);

  while (queue.length > 0 && result.pages.length < opts.maxPages) {
    const item = queue.shift()!;

    if (item.depth > opts.maxDepth) continue;
    if (result.pages.length >= opts.maxPages) break;

    // Robots check
    if (opts.respectRobots && item.url !== normalized) {
      const allowed = await isAllowedByRobots(baseUrl, item.url, env);
      if (!allowed) continue;
    }

    // Fetch page
    const startTime = Date.now();
    try {
      const resp = await fetch(item.url, {
        redirect: "follow",
        cf: { scrapeShield: false },
      });
      const loadTimeMs = Date.now() - startTime;

      if (!resp.ok) {
        result.errors.push({ url: item.url, error: `HTTP ${resp.status}` });
        continue;
      }

      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue; // Skip non-HTML

      const html = await resp.text();
      const parser = new (globalThis as any).DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const page: CrawledPage = {
        url: item.url,
        html,
        status: resp.status,
        contentType,
        loadTimeMs,
        doc,
      };
      result.pages.push(page);
      result.totalCrawled++;

      // Extract and queue new links (only if we haven't hit max discovered)
      if (result.totalDiscovered < opts.maxPages * 2) {
        const links = extractLinks(html, baseUrl, opts.followExternal);
        for (const link of links) {
          if (visited.has(link)) continue;
          visited.add(link);
          result.totalDiscovered++;
          queue.push({ url: link, depth: item.depth + 1 });
        }
      }
    } catch (err: any) {
      result.errors.push({ url: item.url, error: err.message || "Fetch failed" });
    }
  }

  return result;
}
