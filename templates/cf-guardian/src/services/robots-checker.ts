// Robots.txt Deep Checker — validates robots.txt for common mistakes
export interface RobotsAnalysis {
  found: boolean;
  url: string;
  content: string;
  fileSize: number;
  issues: RobotsIssue[];
  agents: string[];
  sitemaps: string[];
  disallowedPaths: { agent: string; paths: string[] }[];
  score: number; // 0-100
}

export interface RobotsIssue {
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  fix: string;
}

export async function checkRobotsTxt(baseUrl: string): Promise<RobotsAnalysis> {
  const result: RobotsAnalysis = {
    found: false,
    url: "",
    content: "",
    fileSize: 0,
    issues: [],
    agents: [],
    sitemaps: [],
    disallowedPaths: [],
    score: 100,
  };

  const robotsUrl = new URL("/robots.txt", baseUrl).href;
  result.url = robotsUrl;

  try {
    const resp = await fetch(robotsUrl, { redirect: "follow" });
    if (resp.status !== 200) {
      result.issues.push({
        severity: "warning",
        title: "robots.txt not found",
        message: `robots.txt returned HTTP ${resp.status}. A basic robots.txt is recommended.`,
        fix: "Create /robots.txt with at least: User-agent: *\nAllow: /\nSitemap: " + new URL("/sitemap.xml", baseUrl).href,
      });
      result.score -= 10;
      return result;
    }

    const raw = await resp.arrayBuffer();
    result.fileSize = raw.byteLength;
    const content = new TextDecoder().decode(raw);
    result.content = content;
    result.found = true;

    // Parse
    const lines = content.split("\n");
    let currentAgents: string[] = [];
    const allDisallows: Map<string, string[]> = new Map();
    const seenAgents = new Set<string>();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();

      if (key === "user-agent") {
        seenAgents.add(value.toLowerCase());
        if (value.toLowerCase() === "*") currentAgents = ["*"];
        else currentAgents = [value.toLowerCase()];
      } else if (key === "disallow") {
        for (const agent of currentAgents) {
          if (!allDisallows.has(agent)) allDisallows.set(agent, []);
          allDisallows.get(agent)!.push(value);
        }
      } else if (key === "sitemap") {
        result.sitemaps.push(value);
      }
    }

    result.agents = [...seenAgents];
    for (const [agent, paths] of allDisallows) {
      result.disallowedPaths.push({ agent, paths });
    }

    // ── Checks ──

    // Critical: Disallow all
    if (allDisallows.has("*") && allDisallows.get("*")!.includes("")) {
      result.issues.push({
        severity: "critical",
        title: "All crawlers blocked",
        message: 'Disallow: (empty) blocks ALL search engines from crawling your entire site.',
        fix: "Remove 'Disallow: ' or change to 'Allow: /' to allow crawling.",
      });
      result.score -= 30;
    }

    // Check for disallowing important paths
    const criticalPaths = ["/blog", "/products", "/pricing", "/about", "/contact", "/docs"];
    for (const [agent, paths] of allDisallows) {
      for (const path of paths) {
        const cleanPath = path.replace("*", "").toLowerCase();
        for (const cp of criticalPaths) {
          if (cleanPath === cp || cleanPath.startsWith(cp + "/")) {
            result.issues.push({
              severity: "warning",
              title: `Important path blocked for ${agent}`,
              message: `Path "${path}" blocks crawling of important content at ${cp}.`,
              fix: `Remove or modify the disallow rule for "${path}".`,
            });
            result.score -= 5;
          }
        }
      }
    }

    // Missing sitemap directive
    if (result.sitemaps.length === 0) {
      result.issues.push({
        severity: "info",
        title: "No Sitemap directive",
        message: "robots.txt doesn't reference your sitemap. This helps crawlers find it faster.",
        fix: `Add: Sitemap: ${new URL("/sitemap.xml", baseUrl).href}`,
      });
      result.score -= 5;
    }

    // No user-agent specified
    if (seenAgents.size === 0) {
      result.issues.push({
        severity: "warning",
        title: "No User-agent directive",
        message: "robots.txt has no User-agent lines. Rules without User-agent may not be parsed correctly.",
        fix: "Add 'User-agent: *' at the top of your robots.txt.",
      });
      result.score -= 10;
    }

    // File size check
    if (result.fileSize > 512000) {
      result.issues.push({
        severity: "warning",
        title: "robots.txt too large",
        message: `robots.txt is ${(result.fileSize / 1024).toFixed(1)}KB. Google recommends under 500KB.`,
        fix: "Simplify rules or use dynamic robots.txt generation.",
      });
      result.score -= 5;
    }

    // Crawl-delay check (informational)
    if (content.toLowerCase().includes("crawl-delay")) {
      result.issues.push({
        severity: "info",
        title: "Crawl-delay used",
        message: "Crawl-delay is only respected by some crawlers (Bing, Yahoo). Googlebot ignores it.",
        fix: "For Google, use Google Search Console's crawl rate settings instead.",
      });
    }

    // Wildcard usage
    const wildcardCount = (content.match(/\*/g) || []).length;
    if (wildcardCount > 5) {
      result.issues.push({
        severity: "info",
        title: "Many wildcard rules",
        message: `${wildcardCount} wildcard (*) patterns found. Complex rules can confuse some crawlers.`,
        fix: "Simplify rules where possible. Use explicit paths instead of wildcards.",
      });
    }

    result.score = Math.max(0, Math.min(100, result.score));

  } catch (err: any) {
    result.issues.push({
      severity: "warning",
      title: "Could not fetch robots.txt",
      message: err.message,
      fix: "Ensure robots.txt is accessible at " + robotsUrl,
    });
  }

  return result;
}
