// AI Discovery Endpoint Checker — forward-looking GEO signal
// Checks for dedicated AI search engine discovery endpoints
// Based on emerging best practices from AI-native web platforms

export interface AiDiscoveryResult {
  endpoints: {
    path: string;
    status: number | null;
    found: boolean;
  }[];
  aiSpecificMetaTags: string[];
  hasAiSitemap: boolean;
  llmsTxtReferenced: boolean;
  score: number;
  maxScore: number;
  details: Record<string, any>;
}

const DISCOVERY_ENDPOINTS = ["/agents.txt", "/ai-discovery", "/ai-context", "/ai-info"];
const AI_META_NAMES = ["ai-description", "ai-summary", "ai-context", "ai-priority"];

export async function checkAiDiscovery(
  baseUrl: string,
  html: string,
  doc: any,
): Promise<AiDiscoveryResult> {
  const details: Record<string, any> = {};
  let score = 0;

  // 1. Check AI discovery endpoints
  const endpoints: AiDiscoveryResult["endpoints"] = [];
  for (const path of DISCOVERY_ENDPOINTS) {
    const url = new URL(path, baseUrl).href;
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        cf: { scrapeShield: false },
      } as RequestInit);
      const text = await resp.text();
      endpoints.push({
        path,
        status: resp.status,
        found: resp.status === 200 && text.trim().length > 0,
      });
    } catch {
      endpoints.push({ path, status: null, found: false });
    }
  }
  details.endpoints = endpoints;

  const foundEndpoints = endpoints.filter((e) => e.found);
  if (foundEndpoints.length > 0) score += 2;

  // 2. AI-specific meta tags
  const aiMetaTags: string[] = [];
  for (const name of AI_META_NAMES) {
    const meta = doc.querySelector(`meta[name="${name}"]`);
    if (meta && meta.getAttribute("content")?.trim()) {
      aiMetaTags.push(name);
    }
  }
  if (aiMetaTags.length > 0) score += 1;

  // 3. AI sitemap
  let hasAiSitemap = false;
  try {
    const aiSitemapUrl = new URL("/ai-sitemap.xml", baseUrl).href;
    const resp = await fetch(aiSitemapUrl, {
      redirect: "follow",
      cf: { scrapeShield: false },
    } as RequestInit);
    if (resp.status === 200 && (await resp.text()).trim().length > 0) {
      hasAiSitemap = true;
    }
  } catch { /* not found */ }
  if (hasAiSitemap) score += 1;

  // 4. llms.txt referenced in page links
  const allLinks = doc.querySelectorAll("a[href]");
  const llmsTxtReferenced = Array.from(allLinks).some((a: any) => {
    const href = (a.getAttribute("href") || "").toLowerCase();
    const text = (a.textContent || "").toLowerCase();
    return href.includes("llms.txt") || text.includes("llms.txt");
  });
  if (llmsTxtReferenced) score += 1;

  // 5. Bonus: 2+ discovery signals
  const signalCount = [
    foundEndpoints.length > 0,
    aiMetaTags.length > 0,
    hasAiSitemap,
    llmsTxtReferenced,
  ].filter(Boolean).length;
  if (signalCount >= 2) score += 1;

  return {
    endpoints,
    aiSpecificMetaTags: aiMetaTags,
    hasAiSitemap,
    llmsTxtReferenced,
    score: Math.min(score, 6),
    maxScore: 6,
    details: {
      foundEndpointCount: foundEndpoints.length,
      aiMetaTagCount: aiMetaTags.length,
      totalSignals: signalCount,
    },
  };
}
