// Data Retention Service — automatically purge old scan data to stay within Turso 8GB free tier
import type { DB } from "../db/turso";

export interface RetentionConfig {
  // How many days of scan history to keep (default: 90)
  scanRetentionDays: number;
  // How many days of alerts to keep (default: 180)
  alertRetentionDays: number;
  // How many days of API usage logs to keep (default: 30)
  apiUsageRetentionDays: number;
  // How many days of geo checks to keep (default: 90)
  geoRetentionDays: number;
  // How many days of optimization history to keep (default: 365)
  optimizationRetentionDays: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  scanRetentionDays: 90,
  alertRetentionDays: 180,
  apiUsageRetentionDays: 30,
  geoRetentionDays: 90,
  optimizationRetentionDays: 365,
};

export interface RetentionResult {
  scansDeleted: number;
  alertsDeleted: number;
  apiUsageDeleted: number;
  geoChecksDeleted: number;
  optimizationsDeleted: number;
  estimatedFreedMB: number;
}

/**
 * Purge old data based on retention policy.
 * This should run daily via cron to prevent database bloat.
 */
export async function purgeOldData(
  db: DB,
  config: RetentionConfig = DEFAULT_RETENTION,
): Promise<RetentionResult> {
  const now = new Date().toISOString();
  let totalDeleted = 0;

  // 1. Delete old scans (and cascade: alerts, geo_checks tied to those scans)
  const scanCutoff = daysAgo(config.scanRetentionDays);
  const scanResult = await db.prepare(
    "DELETE FROM scans WHERE scanned_at < ? AND status = 'completed'"
  ).bind(scanCutoff).run();
  const scansDeleted = scanResult.changes;
  totalDeleted += scansDeleted;

  // 2. Delete orphaned geo_checks (scans deleted above may leave orphans)
  const geoCutoff = daysAgo(config.geoRetentionDays);
  const geoResult = await db.prepare(
    "DELETE FROM geo_checks WHERE created_at < ?"
  ).bind(geoCutoff).run();
  const geoChecksDeleted = geoResult.changes;
  totalDeleted += geoChecksDeleted;

  // 3. Delete old resolved alerts
  const alertCutoff = daysAgo(config.alertRetentionDays);
  const alertResult = await db.prepare(
    "DELETE FROM alerts WHERE resolved = 1 AND resolved_at < ?"
  ).bind(alertCutoff).run();
  const alertsDeleted = alertResult.changes;
  totalDeleted += alertsDeleted;

  // 4. Delete old API usage logs
  const apiCutoff = daysAgo(config.apiUsageRetentionDays);
  const apiResult = await db.prepare(
    "DELETE FROM api_usage WHERE used_at < ?"
  ).bind(apiCutoff).run();
  const apiUsageDeleted = apiResult.changes;
  totalDeleted += apiUsageDeleted;

  // 5. Delete old optimization history
  const optCutoff = daysAgo(config.optimizationRetentionDays);
  const optResult = await db.prepare(
    "DELETE FROM optimizations WHERE created_at < ?"
  ).bind(optCutoff).run();
  const optimizationsDeleted = optResult.changes;
  totalDeleted += optimizationsDeleted;

  // Estimate freed space (rough: avg 2KB per scan, 500B per alert, 300B per geo, 150B per api, 1KB per opt)
  const estimatedFreedMB = (
    scansDeleted * 2048 +
    alertsDeleted * 500 +
    geoChecksDeleted * 300 +
    apiUsageDeleted * 150 +
    optimizationsDeleted * 1024
  ) / (1024 * 1024);

  const result: RetentionResult = {
    scansDeleted,
    alertsDeleted,
    apiUsageDeleted,
    geoChecksDeleted,
    optimizationsDeleted,
    estimatedFreedMB,
  };

  if (totalDeleted > 0) {
    console.log(
      `[Retention] Purged ${totalDeleted} rows: scans=${scansDeleted}, ` +
      `alerts=${alertsDeleted}, geo=${geoChecksDeleted}, api=${apiUsageDeleted}, ` +
      `opt=${optimizationsDeleted} (~${estimatedFreedMB.toFixed(2)}MB freed)`,
    );
  }

  return result;
}

/**
 * Get current database size estimate.
 */
export async function getDatabaseSizeEstimate(db: DB): Promise<{
  totalRows: number;
  tableBreakdown: Record<string, number>;
  estimatedSizeMB: number;
}> {
  const tables = [
    { name: "scans", avgRowBytes: 2048 },
    { name: "alerts", avgRowBytes: 500 },
    { name: "geo_checks", avgRowBytes: 300 },
    { name: "api_usage", avgRowBytes: 150 },
    { name: "optimizations", avgRowBytes: 1024 },
    { name: "sites", avgRowBytes: 200 },
    { name: "users", avgRowBytes: 150 },
    { name: "competitors", avgRowBytes: 200 },
  ];

  const breakdown: Record<string, number> = {};
  let totalRows = 0;
  let totalBytes = 0;

  for (const table of tables) {
    try {
      const row = await db.prepare(`SELECT COUNT(*) as cnt FROM ${table.name}`).bind().first();
      const count = (row as any)?.cnt ?? 0;
      breakdown[table.name] = count;
      totalRows += count;
      totalBytes += count * table.avgRowBytes;
    } catch {
      // Table may not exist yet
      breakdown[table.name] = 0;
    }
  }

  return {
    totalRows,
    tableBreakdown: breakdown,
    estimatedSizeMB: totalBytes / (1024 * 1024),
  };
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}
