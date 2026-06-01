// Brand & Entity Checker — GEO audit dimension (10 pts)
// Based on Auriti-Labs brand_entity_signals.py:
// brand consistency, knowledge graph links, about page, geo signals, topic authority

export interface BrandEntityResult {
  brandName: string;
  knowledgeGraph: {
    wikipedia: boolean;
    wikidata: boolean;
    linkedin: boolean;
  };
  aboutPage: boolean;
  geoSignals: {
    hasAddress: boolean;
    hasPhone: boolean;
    hasLocationSchema: boolean;
  };
  topicAuthority: {
    brandMentions: number;
    consistentBranding: boolean;
  };
  score: number;
  maxScore: number;
  details: Record<string, any>;
}

export function checkBrandEntity(
  html: string,
  bodyText: string,
  baseUrl: string,
  jsonLdBlocks: any[],
): BrandEntityResult {
  const parser = new (globalThis as any).DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const details: Record<string, any> = {};
  let score = 0;

  // 1. Extract brand name from title or Organization schema
  const titleEl = doc.querySelector("title");
  const titleText = titleEl?.textContent?.trim() || "";

  let brandName = "";
  // Try Organization schema first
  for (const block of jsonLdBlocks) {
    const t = block?.["@type"];
    const types = Array.isArray(t) ? t : [t];
    if (types?.includes("Organization") && block.name) {
      brandName = block.name;
      break;
    }
  }
  // Fallback: use title text as brand proxy
  if (!brandName && titleText) {
    // Strip common suffixes like " | SiteName", " - Home", etc.
    brandName = titleText.split(/[\s|\-–—]+/).find((part: string) => {
      const lower = part.toLowerCase().trim();
      return lower && !["home", "welcome", "index", "page", "blog", "shop", "store"].includes(lower);
    }) || titleText;
  }
  details.brandName = brandName;
  if (brandName) score += 2;

  // 2. Knowledge graph links — scan all <a href> for authority domains
  const allLinks = doc.querySelectorAll("a[href]");
  const hrefs = Array.from(allLinks).map((a: any) => a.getAttribute("href") || "").filter(Boolean);

  const knowledgeGraph = {
    wikipedia: hrefs.some((h: string) => /wikipedia\.org/i.test(h)),
    wikidata: hrefs.some((h: string) => /wikidata\.org/i.test(h)),
    linkedin: hrefs.some((h: string) => /linkedin\.com/i.test(h)),
  };

  if (knowledgeGraph.wikipedia) score += 1;
  if (knowledgeGraph.wikidata) score += 1;
  if (knowledgeGraph.linkedin) score += 1;

  // 3. About page link
  const linkTexts = Array.from(allLinks).map((a: any) => (a.textContent || "").toLowerCase());
  const aboutPatterns = [/about/i, /关于我们/i, /团队/i, /team/i, /about\.html/i, /about\.php/i];
  const aboutPage =
    hrefs.some((h: string) => aboutPatterns.some((p) => p.test(h))) ||
    linkTexts.some((t: string) => aboutPatterns.some((p) => p.test(t)));
  if (aboutPage) score += 1;

  // 4. Contact / geo signals
  const hasPhone = /tel:|(\+\d{1,3}[\s\-]?\d{3,})/.test(bodyText);
  const hasEmail = /[\w.+-]+@[\w-]+\.\w{2,}/.test(bodyText);
  const hasAddress = /street|road|avenue|地址|路|街|号/.test(bodyText.toLowerCase());

  // Check for LocalBusiness schema
  let hasLocationSchema = false;
  for (const block of jsonLdBlocks) {
    const t = block?.["@type"];
    const types = Array.isArray(t) ? t : [t];
    if (types?.includes("LocalBusiness") || types?.includes("Organization")) {
      if (block.address || block.hasAddress) {
        hasLocationSchema = true;
        break;
      }
    }
  }

  const geoSignals = { hasAddress, hasPhone, hasLocationSchema };
  if (hasPhone || hasEmail) score += 1;
  if (hasLocationSchema || hasAddress) score += 1;

  // 5. Topic authority — brand mentions and consistency
  if (brandName && brandName.length > 1) {
    const brandRegex = new RegExp(brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const brandMentions = (bodyText.match(brandRegex) || []).length;
    details.brandMentions = brandMentions;
    if (brandMentions >= 3) score += 1;
  } else {
    details.brandMentions = 0;
  }

  // Consistent branding: brand in title + meta description + first H1
  const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const h1Text = doc.querySelector("h1")?.textContent?.trim() || "";
  let consistentBranding = false;
  if (brandName && brandName.length > 1) {
    const brandLower = brandName.toLowerCase();
    const inTitle = titleText.toLowerCase().includes(brandLower);
    const inMeta = metaDesc.toLowerCase().includes(brandLower);
    const inH1 = h1Text.toLowerCase().includes(brandLower);
    consistentBranding = [inTitle, inMeta, inH1].filter(Boolean).length >= 2;
  }
  details.consistentBranding = consistentBranding;
  if (consistentBranding) score += 1;

  return {
    brandName,
    knowledgeGraph,
    aboutPage,
    geoSignals,
    topicAuthority: {
      brandMentions: details.brandMentions || 0,
      consistentBranding,
    },
    score: Math.min(score, 10),
    maxScore: 10,
    details: {
      brandName,
      knowledgeGraph,
      aboutPage,
      geoSignals,
      consistentBranding,
      brandMentions: details.brandMentions || 0,
    },
  };
}
