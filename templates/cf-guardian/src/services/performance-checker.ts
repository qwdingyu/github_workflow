// Page Performance Checker — analyzes Core Web Vitals, load performance, and mobile-friendliness
export interface PerformanceAudit {
  score: number; // 0-100
  grade: string; // A-F
  loadTimeMs: number;
  pageSize: number;
  requestCount: number;
  isMobileFriendly: boolean;
  issues: PerfIssue[];

  // Core Web Vitals (estimated from HTML analysis)
  lcp: { score: number; value: string; status: "good" | "needs-improvement" | "poor" };
  cls: { score: number; value: string; status: "good" | "needs-improvement" | "poor" };
  inp: { score: number; value: string; status: "good" | "needs-improvement" | "poor" };

  // Resource analysis
  resources: ResourceAnalysis;

  // Mobile check
  mobileIssues: string[];
}

export interface PerfIssue {
  severity: "critical" | "warning" | "info";
  category: "performance" | "mobile" | "accessibility";
  title: string;
  message: string;
  savings?: string; // estimated bytes or ms savings
}

export interface ResourceAnalysis {
  images: { count: number; totalSize: number; lazy: number; missingAlt: number; oversized: number };
  scripts: { count: number; totalSize: number; blocking: number };
  stylesheets: { count: number; totalSize: number; renderBlocking: number };
  fonts: { count: number; totalSize: number; };
  iframes: { count: number; };
}

function estimateResourceSize(tag: string, html: string): { count: number; estimatedBytes: number } {
  const parser = new (globalThis as any).DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const elements = doc.querySelectorAll(tag);
  return {
    count: elements.length,
    estimatedBytes: 0, // Can't estimate without fetching, but we count
  };
}

function checkMobileFriendliness(doc: any): { isMobileFriendly: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check viewport meta
  const viewport = doc.querySelector('meta[name="viewport"]');
  if (!viewport) {
    issues.push("Missing viewport meta tag — page not mobile-friendly");
  }

  // Check for touch-friendly elements
  const buttons = doc.querySelectorAll("button, a, input[type='submit']");
  let smallTouchTargets = 0;
  for (const btn of buttons) {
    const style = btn.getAttribute("style") || "";
    // Heuristic: if no explicit size, assume potentially small
    if (!style.includes("min-height") && !style.includes("padding") && btn.textContent?.trim().length < 5) {
      smallTouchTargets++;
    }
  }
  if (smallTouchTargets > 5) {
    issues.push(`${smallTouchTargets} potentially small touch targets`);
  }

  // Check for horizontal overflow triggers
  const tables = doc.querySelectorAll("table");
  if (tables.length > 0) {
    issues.push(`${tables.length} table(s) detected — may cause horizontal scroll on mobile`);
  }

  // Check font sizes (heuristic)
  const body = doc.body;
  if (body) {
    const computedStyle = body.getAttribute("style") || "";
    if (computedStyle.includes("font-size") && /font-size:\s*\d+px/.test(computedStyle)) {
      const match = computedStyle.match(/font-size:\s*(\d+)px/);
      if (match && parseInt(match[1]) < 14) {
        issues.push("Font size too small for mobile (< 14px)");
      }
    }
  }

  return {
    isMobileFriendly: issues.length === 0,
    issues,
  };
}

function analyzeResources(doc: any): ResourceAnalysis {
  // Images
  const images = doc.querySelectorAll("img");
  let missingAlt = 0;
  let lazy = 0;
  for (const img of images) {
    if (!img.getAttribute("alt")?.trim()) missingAlt++;
    if (img.getAttribute("loading") === "lazy") lazy++;
  }

  // Check for srcset (responsive images)
  let responsive = 0;
  for (const img of images) {
    if (img.getAttribute("srcset") || img.getAttribute("sizes")) responsive++;
  }

  // Scripts
  const scripts = doc.querySelectorAll("script");
  let blocking = 0;
  for (const script of scripts) {
    if (!script.getAttribute("async") && !script.getAttribute("defer") && script.getAttribute("src")) {
      blocking++;
    }
  }

  // Stylesheets
  const stylesheets = doc.querySelectorAll("link[rel='stylesheet']");
  let renderBlocking = 0;
  for (const link of stylesheets) {
    if (!link.getAttribute("media") || link.getAttribute("media") === "all") {
      renderBlocking++;
    }
  }

  // Inline styles
  const inlineStyles = doc.querySelectorAll("style");

  // Fonts
  const fontFaces = (doc.documentElement?.outerHTML || "").match(/@font-face/g) || [];

  // Iframes
  const iframes = doc.querySelectorAll("iframe");

  return {
    images: { count: images.length, totalSize: 0, lazy, missingAlt, oversized: 0 },
    scripts: { count: scripts.length, totalSize: 0, blocking },
    stylesheets: { count: stylesheets.length, totalSize: 0, renderBlocking },
    fonts: { count: fontFaces.length, totalSize: 0 },
    iframes: { count: iframes.length },
  };
}

export async function auditPerformance(url: string, html: string, response: Response): Promise<PerformanceAudit> {
  const parser = new (globalThis as any).DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const issues: PerfIssue[] = [];
  const resources = analyzeResources(doc);
  const mobile = checkMobileFriendliness(doc);

  // Estimate load time from response
  const pageSize = html.length;
  const requestCount = resources.images.count + resources.scripts.count + resources.stylesheets.count + 1;

  // Estimate LCP (Largest Contentful Paint) from HTML structure
  const heroImage = doc.querySelector("img");
  const heroText = doc.querySelector("h1, h2");
  let lcpValue = "N/A";
  let lcpScore = 50;
  if (heroImage && heroImage.getAttribute("src")) {
    // Has hero image — estimate based on page size
    if (pageSize < 100000) { lcpValue = "~1.5s"; lcpScore = 80; }
    else if (pageSize < 300000) { lcpValue = "~2.5s"; lcpScore = 55; }
    else { lcpValue = "~4s"; lcpScore = 30; }
  } else if (heroText) {
    lcpValue = "~0.8s"; lcpScore = 90; // Text LCP is fast
  }

  // Estimate CLS (Cumulative Layout Shift)
  let clsScore = 100;
  let clsValue = "0.01";
  // Images without dimensions cause CLS
  let imagesWithoutDims = 0;
  for (const img of doc.querySelectorAll("img")) {
    if (!img.getAttribute("width") || !img.getAttribute("height")) imagesWithoutDims++;
  }
  if (imagesWithoutDims > 0) {
    clsScore = Math.max(0, 100 - imagesWithoutDims * 5);
    clsValue = (imagesWithoutDims * 0.02).toFixed(2);
    issues.push({
      severity: imagesWithoutDims > 5 ? "warning" : "info",
      category: "performance",
      title: "Images missing width/height",
      message: `${imagesWithoutDims} images lack explicit dimensions, causing layout shifts.`,
      savings: `${imagesWithoutDims * 15}ms estimated CLS reduction`,
    });
  }

  // INP (Interaction to Next Paint) — estimate from JS weight
  let inpScore = 80;
  let inpValue = "~120ms";
  if (resources.scripts.blocking > 3) {
    inpScore = 40;
    inpValue = "~350ms";
    issues.push({
      severity: "warning",
      category: "performance",
      title: "Blocking JavaScript",
      message: `${resources.scripts.blocking} render-blocking scripts detected. Use async/defer.`,
    });
  }

  // Resource issues
  if (resources.images.missingAlt > 0) {
    issues.push({
      severity: "info",
      category: "accessibility",
      title: "Images missing alt text",
      message: `${resources.images.missingAlt} images lack alt attributes.`,
    });
  }

  if (resources.stylesheets.renderBlocking > 2) {
    issues.push({
      severity: "warning",
      category: "performance",
      title: "Render-blocking stylesheets",
      message: `${resources.stylesheets.renderBlocking} stylesheets block rendering. Consider inlining critical CSS.`,
    });
  }

  if (resources.iframes.count > 3) {
    issues.push({
      severity: "info",
      category: "performance",
      title: "Many iframes",
      message: `${resources.iframes.count} iframes detected. Each adds a network request and render cost.`,
    });
  }

  // Mobile issues
  for (const mi of mobile.issues) {
    issues.push({
      severity: "warning",
      category: "mobile",
      title: "Mobile issue",
      message: mi,
    });
  }

  // Calculate overall score
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "critical") score -= 15;
    else if (issue.severity === "warning") score -= 8;
    else score -= 3;
  }
  score = Math.max(0, Math.min(100, score));

  const grades = ["F", "D", "C", "B", "A"];
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

  return {
    score,
    grade,
    loadTimeMs: Math.round(pageSize / 1000 * 15), // Rough estimate: 15ms per KB
    pageSize,
    requestCount,
    isMobileFriendly: mobile.isMobileFriendly,
    issues,
    lcp: {
      score: lcpScore,
      value: lcpValue,
      status: lcpScore >= 90 ? "good" : lcpScore >= 50 ? "needs-improvement" : "poor",
    },
    cls: {
      score: clsScore,
      value: clsValue,
      status: clsScore >= 90 ? "good" : clsScore >= 50 ? "needs-improvement" : "poor",
    },
    inp: {
      score: inpScore,
      value: inpValue,
      status: inpScore >= 90 ? "good" : inpScore >= 50 ? "needs-improvement" : "poor",
    },
    resources,
    mobileIssues: mobile.issues,
  };
}
