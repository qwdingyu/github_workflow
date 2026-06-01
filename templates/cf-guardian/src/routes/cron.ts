import type { Context } from "hono";
import { SITE_QUERIES, SCAN_QUERIES } from "../db/schema";
import { createTursoDB } from "../db/turso";
import type { Env, ScanMessage } from "../index";
import { generateAllReports } from "../services/weekly-report";
import { purgeOldData } from "../services/data-retention";

// Cron handler — runs daily at 9:00 UTC
// Queues scans for all active sites + generates weekly reports on Mondays
export async function cronHandler(c: Context) {
  const env = c.env as Env;
  // Cron doesn't go through HTTP middleware — create Turso client directly
  const db = createTursoDB(env.TURSO_DB_URL, env.TURSO_AUTH_TOKEN || undefined);
  Object.defineProperty(env, "DB", { value: db, writable: false, configurable: false });
  const now = new Date();
  const isMonday = now.getUTCDay() === 1; // Monday = 1 in UTC

  // Get all active sites
  const { results } = await env.DB.prepare(SITE_QUERIES.GET_ACTIVE_FOR_CRON).bind().all();
  const sites = (results || []) as { id: string }[];

  if (!sites || sites.length === 0) {
    console.log("[Cron] No active sites to scan");
    return c.body("OK");
  }

  console.log(`[Cron] Queuing scans for ${sites.length} sites`);

  // Create scan records and enqueue them
  const messages: ScanMessage[] = [];
  for (const site of sites) {
    const scanId = crypto.randomUUID();
    await env.DB.prepare(SCAN_QUERIES.CREATE).bind(scanId, site.id, null).run();
    messages.push({ siteId: site.id, scanId });
  }

  // Batch send to queue
  const batch = messages.map((m) => ({ body: m }));
  await env.SCAN_QUEUE.sendBatch(batch);

  // Weekly report generation on Mondays
  if (isMonday) {
    try {
      // Get all user IDs with active sites
      const userIds = [...new Set(sites.map((s: any) => s.user_id))];
      let totalReports = 0;
      for (const userId of userIds) {
        const reports = await generateAllReports(userId as string, { DB: env.DB });
        totalReports += reports.length;
        // In production, this would trigger email sending via Cloudflare Email Service
        // For now, log the report generation
        if (reports.length > 0) {
          console.log(`[Cron] Weekly reports generated for user ${userId}: ${reports.length} sites`);
        }
      }
      console.log(`[Cron] Total weekly reports: ${totalReports}`);
    } catch (err) {
      console.warn("[Cron] Weekly report generation failed:", err);
    }
  }

  // Data retention — purge old data daily to stay within Turso 8GB free tier
  try {
    const purged = await purgeOldData(env.DB);
    if (purged.scansDeleted + purged.alertsDeleted + purged.geoChecksDeleted > 0) {
      console.log(`[Cron] Data retention: purged ${purged.scansDeleted} scans, ${purged.alertsDeleted} alerts, ${purged.geoChecksDeleted} geo checks`);
    }
  } catch (err) {
    console.warn("[Cron] Data retention purge failed:", err);
  }

  return c.body(`OK — queued ${messages.length} scans${isMonday ? " + weekly reports generated" : ""}`);
}
