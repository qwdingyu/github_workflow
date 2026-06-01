import { eq, desc, sql } from "drizzle-orm";
import { sites, scans, competitors } from "../db/schema";
import type { DB } from "../db/schema";

export interface WeeklyReport {
  siteId: string;
  siteName: string;
  siteUrl: string;
  reportWeek: string;
  generatedAt: string;

  seoScoreCurrent: number;
  seoScorePrevious: number;
  seoScoreDelta: number;

  geoScoreCurrent: number;
  geoScorePrevious: number;
  geoScoreDelta: number;

  totalIssues: number;
  criticalIssues: number;
  newIssues: number;
  resolvedIssues: number;

  pageChanges: {
    url: string;
    previousScore: number;
    currentScore: number;
    delta: number;
  }[];

  recommendations: {
    priority: "high" | "medium" | "low";
    category: string;
    title: string;
    description: string;
    impact: string;
  }[];

  competitorComparison?: {
    competitorUrl: string;
    competitorName: string;
    ourScore: number;
    theirScore: number;
    ourGeo: number;
    theirGeo: number;
  }[];
}

export async function generateWeeklyReport(
  siteId: string,
  db: DB,
): Promise<WeeklyReport | null> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!site) return null;

  const [latestScan] = await db
    .select()
    .from(scans)
    .where(eq(scans.siteId, siteId))
    .orderBy(desc(scans.scannedAt))
    .limit(1);

  const allScans = await db
    .select()
    .from(scans)
    .where(eq(scans.siteId, siteId))
    .orderBy(desc(scans.scannedAt))
    .limit(2);
  const prevScan = allScans[1] || null;

  if (!latestScan) return null;

  const seoCurrent = latestScan.score ?? 0;
  const seoPrevious = prevScan?.score ?? 0;
  const geoCurrent = latestScan.geoScore ?? 0;
  const geoPrevious = prevScan?.geoScore ?? 0;

  let latestIssues: any[] = [];
  let prevIssues: any[] = [];
  try { latestIssues = JSON.parse(latestScan.issuesJson || "[]"); } catch {}
  try { prevIssues = JSON.parse(prevScan?.issuesJson || "[]"); } catch {}

  const latestIssueKeys = new Set(latestIssues.map((i: any) => `${i.title}:${i.message}`));
  const prevIssueKeys = new Set(prevIssues.map((i: any) => `${i.title}:${i.message}`));

  const newIssues = latestIssues.filter((i: any) => !prevIssueKeys.has(`${i.title}:${i.message}`)).length;
  const resolvedIssues = prevIssues.filter((i: any) => !latestIssueKeys.has(`${i.title}:${i.message}`)).length;

  const recommendations = generateRecommendations(latestIssues);

  // 竞品对比
  let competitorComparison: WeeklyReport["competitorComparison"] = undefined;
  try {
    const compList = await db.select().from(competitors).where(eq(competitors.userId, site.userId));

    if (compList.length > 0) {
      competitorComparison = [];
      for (const comp of compList) {
        const [compScan] = await db
          .select()
          .from(scans)
          .where(eq(scans.siteId, comp.id))
          .orderBy(desc(scans.scannedAt))
          .limit(1);

        if (compScan) {
          competitorComparison.push({
            competitorUrl: comp.url,
            competitorName: comp.name || comp.url,
            ourScore: seoCurrent,
            theirScore: compScan.score || 0,
            ourGeo: geoCurrent,
            theirGeo: compScan.geoScore || 0,
          });
        }
      }
    }
  } catch {}

  const now = new Date();
  const oneJan = new Date(now.getFullYear(), 0, 1);
  const weeks = Math.ceil(((now.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
  const reportWeek = `${now.getFullYear()}-W${String(weeks).padStart(2, "0")}`;

  return {
    siteId,
    siteName: site.name || site.url,
    siteUrl: site.url,
    reportWeek,
    generatedAt: new Date().toISOString(),
    seoScoreCurrent: seoCurrent,
    seoScorePrevious: seoPrevious,
    seoScoreDelta: seoCurrent - seoPrevious,
    geoScoreCurrent: geoCurrent,
    geoScorePrevious: geoPrevious,
    geoScoreDelta: geoCurrent - geoPrevious,
    totalIssues: latestIssues.length,
    criticalIssues: latestIssues.filter((i: any) => i.severity === "critical").length,
    newIssues,
    resolvedIssues,
    pageChanges: [],
    recommendations,
    competitorComparison,
  };
}

function generateRecommendations(issues: any[]): WeeklyReport["recommendations"] {
  const recs: WeeklyReport["recommendations"] = [];

  const criticalIssues = issues.filter((i: any) => i.severity === "critical");
  const warningIssues = issues.filter((i: any) => i.severity === "warning");

  if (criticalIssues.some((i: any) => i.title.includes("title"))) {
    recs.push({
      priority: "high", category: "content", title: "Fix missing page titles",
      description: "Pages without titles lose up to 80% click-through rate in search results.",
      impact: "High — directly affects search visibility and click-through rates",
    });
  }
  if (criticalIssues.some((i: any) => i.title.includes("meta description"))) {
    recs.push({
      priority: "high", category: "content", title: "Add meta descriptions",
      description: "Meta descriptions are your ad copy in search results.",
      impact: "High — improves click-through rate by 5-10%",
    });
  }
  if (issues.some((i: any) => i.title.includes("canonical"))) {
    recs.push({
      priority: "high", category: "technical", title: "Add canonical tags",
      description: "Without canonical tags, search engines may index duplicate content.",
      impact: "High — prevents duplicate content penalties",
    });
  }
  if (warningIssues.some((i: any) => i.title.includes("H1"))) {
    recs.push({
      priority: "medium", category: "content", title: "Fix heading structure",
      description: "Each page should have exactly one H1 that describes the page content.",
      impact: "Medium — helps search engines understand page structure",
    });
  }
  if (issues.some((i: any) => i.title.includes("alt"))) {
    recs.push({
      priority: "medium", category: "technical", title: "Add alt text to images",
      description: "Alt text helps with accessibility and image search rankings.",
      impact: "Medium — improves accessibility and image search visibility",
    });
  }
  if (issues.some((i: any) => i.title.includes("structured") || i.title.includes("schema"))) {
    recs.push({
      priority: "medium", category: "technical", title: "Add structured data (Schema.org)",
      description: "Structured data enables rich snippets in search results.",
      impact: "High — rich snippets can increase CTR by 30%",
    });
  }
  if (issues.some((i: any) => i.category === "geo")) {
    recs.push({
      priority: "high", category: "geo", title: "Improve GEO optimization",
      description: "Your site needs better alignment with Google's AI-generated answers.",
      impact: "Critical — GEO visibility is becoming essential as AI search grows",
    });
  }

  return recs.slice(0, 5);
}

export async function generateAllReports(
  userId: string,
  db: DB,
): Promise<WeeklyReport[]> {
  const siteList = await db.select({ id: sites.id }).from(sites).where(eq(sites.userId, userId));

  const reports: WeeklyReport[] = [];
  for (const site of siteList) {
    const report = await generateWeeklyReport(site.id, db);
    if (report) reports.push(report);
  }
  return reports;
}
