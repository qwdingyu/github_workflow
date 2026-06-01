// Internal Link Analysis Service — analyzes internal linking structure
export interface InternalLink {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  linkType: "nav" | "content" | "footer" | "sidebar" | "breadcrumb";
}

export interface PageAuthority {
  url: string;
  title: string;
  internalInlinks: number;  // how many pages link TO this page
  internalOutlinks: number; // how many pages this page links TO
  authorityScore: number;   // 0-100, based on inlinks and position in site
  depth: number;            // clicks from homepage
}

export interface InternalLinkReport {
  siteUrl: string;
  totalPages: number;
  totalInternalLinks: number;
  avgLinksPerPage: number;
  orphanPages: string[];    // pages with no internal inlinks
  deepPages: string[];      // pages more than 4 clicks from homepage
  topLinkedPages: PageAuthority[];
  linkDistribution: {
    nav: number;
    content: number;
    footer: number;
    sidebar: number;
    breadcrumb: number;
  };
  pageAuthority: PageAuthority[];
}

/**
 * Analyze internal linking structure from crawled pages.
 */
export function analyzeInternalLinks(
  pages: Array<{ url: string; html: string; title?: string; depth?: number }>,
  homepage: string,
): InternalLinkReport {
  const parser = new (globalThis as any).DOMParser();
  const allLinks: InternalLink[] = [];
  const pageMap = new Map<string, { title: string; inlinks: Set<string>; outlinks: Set<string>; depth: number }>();

  // Initialize page map
  for (const page of pages) {
    pageMap.set(page.url, {
      title: page.title || "",
      inlinks: new Set(),
      outlinks: new Set(),
      depth: page.depth || 0,
    });
  }

  // Parse internal links from each page
  for (const page of pages) {
    const doc = parser.parseFromString(page.html, "text/html");
    const links = doc.querySelectorAll("a[href]");

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const anchorText = link.textContent?.trim() || "";

      // Resolve relative URLs
      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(href, page.url).href;
      } catch {
        continue;
      }

      // Only count internal links
      const pageHostname = new URL(page.url).hostname;
      const linkHostname = new URL(absoluteUrl).hostname;
      if (pageHostname !== linkHostname) continue;

      // Remove fragments
      absoluteUrl = absoluteUrl.split("#")[0];

      // Determine link type based on position in DOM
      let linkType: InternalLink["linkType"] = "content";
      const parent = link.parentElement;
      if (parent) {
        const parentTag = parent.tagName.toLowerCase();
        const parentClasses = parent.getAttribute("class") || "";
        if (parentTag === "nav" || parentClasses.includes("nav") || parentClasses.includes("menu")) {
          linkType = "nav";
        } else if (parentTag === "footer" || parentClasses.includes("footer")) {
          linkType = "footer";
        } else if (parentClasses.includes("sidebar") || parentClasses.includes("widget")) {
          linkType = "sidebar";
        } else if (parentClasses.includes("breadcrumb")) {
          linkType = "breadcrumb";
        }
      }

      allLinks.push({
        sourceUrl: page.url,
        targetUrl: absoluteUrl,
        anchorText,
        linkType,
      });

      // Track inlinks/outlinks
      const source = pageMap.get(page.url);
      const target = pageMap.get(absoluteUrl);
      if (source) source.outlinks.add(absoluteUrl);
      if (target) target.inlinks.add(page.url);
    }
  }

  // Calculate page authority
  const pageAuthority: PageAuthority[] = [];
  for (const [url, data] of pageMap) {
    const inlinkCount = data.inlinks.size;
    const outlinkCount = data.outlinks.size;

    // Authority score: weighted by inlinks and inversely by depth
    const depthPenalty = Math.max(0, 1 - data.depth * 0.15);
    const authorityScore = Math.min(
      100,
      Math.round((inlinkCount * 15 + outlinkCount * 2) * depthPenalty),
    );

    pageAuthority.push({
      url,
      title: data.title,
      internalInlinks: inlinkCount,
      internalOutlinks: outlinkCount,
      authorityScore,
      depth: data.depth,
    });
  }

  // Sort by authority
  pageAuthority.sort((a, b) => b.authorityScore - a.authorityScore);

  // Find orphan pages (no internal inlinks, excluding homepage)
  const orphanPages = pageAuthority
    .filter((p) => p.internalInlinks === 0 && p.url !== homepage)
    .map((p) => p.url);

  // Find deep pages (> 4 clicks from homepage)
  const deepPages = pageAuthority
    .filter((p) => p.depth > 4)
    .map((p) => p.url);

  // Link type distribution
  const linkDistribution = { nav: 0, content: 0, footer: 0, sidebar: 0, breadcrumb: 0 };
  for (const link of allLinks) {
    linkDistribution[link.linkType]++;
  }

  return {
    siteUrl: homepage,
    totalPages: pages.length,
    totalInternalLinks: allLinks.length,
    avgLinksPerPage: Math.round(allLinks.length / pages.length),
    orphanPages,
    deepPages,
    topLinkedPages: pageAuthority.slice(0, 20),
    linkDistribution,
    pageAuthority,
  };
}
