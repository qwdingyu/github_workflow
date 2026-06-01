import { eq, and, desc, sql } from "drizzle-orm";
import { sites, alerts } from "../db/schema";
import type { DB } from "../db/schema";
import { generateUUID } from "@eforge/cf-core/crypto";

export interface AlertNotification {
  id: string;
  userId: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
  type: "new_issue" | "score_drop" | "critical_found" | "geo_degradation";
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export async function checkForNewAlerts(
  siteId: string,
  currentScan: any,
  previousScan: any | null,
  db: DB,
): Promise<AlertNotification[]> {
  const alertList: AlertNotification[] = [];
  if (!currentScan) return alertList;

  const [site] = await db.select({ id: sites.id, userId: sites.userId, name: sites.name, url: sites.url }).from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!site) return alertList;

  const siteName = site.name || site.url;
  const siteUrl = site.url;
  const userId = site.userId;
  const now = new Date().toISOString();

  let currentIssues: any[] = [];
  let previousIssues: any[] = [];
  try { currentIssues = JSON.parse(currentScan.issuesJson || "[]"); } catch {}
  if (previousScan) {
    try { previousIssues = JSON.parse(previousScan.issuesJson || "[]"); } catch {}
  }

  // 1. 新 critical 问题
  const previousIssueKeys = new Set(previousIssues.map((i: any) => `${i.severity}:${i.title}:${i.message}`));
  for (const issue of currentIssues) {
    const key = `${issue.severity}:${issue.title}:${issue.message}`;
    if (!previousIssueKeys.has(key)) {
      if (issue.severity === "critical") {
        alertList.push({
          id: generateUUID(), userId, siteId, siteName, siteUrl,
          type: "critical_found", severity: "critical",
          title: `Critical: ${issue.title}`, message: issue.message, createdAt: now, read: false,
        });
      } else if (issue.severity === "warning") {
        alertList.push({
          id: generateUUID(), userId, siteId, siteName, siteUrl,
          type: "new_issue", severity: "warning",
          title: `New issue: ${issue.title}`, message: issue.message, createdAt: now, read: false,
        });
      }
    }
  }

  // 2. 分数下降
  if (previousScan && previousScan.score != null) {
    const scoreDelta = (currentScan.score ?? 0) - (previousScan.score ?? 0);
    if (scoreDelta < -10) {
      alertList.push({
        id: generateUUID(), userId, siteId, siteName, siteUrl,
        type: "score_drop", severity: "warning",
        title: `SEO score dropped by ${Math.abs(scoreDelta)} points`,
        message: `Score went from ${previousScan.score} to ${currentScan.score}. Check for new issues.`,
        createdAt: now, read: false,
      });
    }
  }

  // 3. GEO 分数下降
  if (previousScan && previousScan.geoScore > 0) {
    const geoDelta = (currentScan.geoScore ?? 0) - (previousScan.geoScore ?? 0);
    if (geoDelta < -15) {
      alertList.push({
        id: generateUUID(), userId, siteId, siteName, siteUrl,
        type: "geo_degradation", severity: "warning",
        title: `GEO score dropped by ${Math.abs(geoDelta)} points`,
        message: `GEO score went from ${previousScan.geoScore} to ${currentScan.geoScore}. Review GEO checks.`,
        createdAt: now, read: false,
      });
    }
  }

  // 保存到数据库
  for (const alert of alertList) {
    try {
      await db.insert(alerts).values({
        id: alert.id, siteId, scanId: currentScan.id, severity: alert.severity,
        category: alert.type, title: alert.title, message: alert.message, aiExplanation: null,
      });
    } catch {}
  }

  return alertList;
}

export async function getUnreadNotifications(userId: string, db: DB): Promise<AlertNotification[]> {
  const rows = await db.select({
    id: alerts.id, siteId: alerts.siteId, severity: alerts.severity,
    type: alerts.category as any, title: alerts.title, message: alerts.message,
    createdAt: alerts.createdAt, siteName: sites.name, siteUrl: sites.url,
  })
  .from(alerts)
  .innerJoin(sites, eq(alerts.siteId, sites.id))
  .where(and(eq(sites.userId, userId), eq(alerts.notified, 0)))
  .orderBy(desc(alerts.createdAt))
  .limit(30);

  return rows.map((r) => ({
    id: r.id, userId, siteId: r.siteId,
    siteName: r.siteName || "", siteUrl: r.siteUrl || "",
    type: r.type || "new_issue", severity: r.severity,
    title: r.title || "", message: r.message || "",
    createdAt: r.createdAt, read: false,
  }));
}

export async function markAllRead(userId: string, db: DB): Promise<number> {
  const subQuery = db.select({ id: alerts.id })
    .from(alerts)
    .innerJoin(sites, eq(alerts.siteId, sites.id))
    .where(and(eq(sites.userId, userId), eq(alerts.notified, 0)));

  const result = await db.update(alerts).set({ notified: 1 }).where(sql`${alerts.id} IN ${subQuery}`);
  return (result as any).changes ?? 0;
}
