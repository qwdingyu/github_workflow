/**
 * 限流模块 — 基于 IP + 操作类型的固定窗口限流。
 *
 * 原理：使用 rate_limit_windows 表，通过 onConflictDoUpdate().returning() 原子 upsert
 * 实现"计数+1"操作。一次数据库操作完成检查与计数，消除竞态条件。
 *
 * 注意：使用 IP 哈希（非明文 IP）保护隐私，哈希加盐防止反向查找。
 */

import type { Context } from "hono";
import type { AppEnv } from "../bindings";
import { getIpHash } from "./security";
import { rateLimitWindows, requestLogs } from "../db/schema";
import { sql } from "drizzle-orm";
import { getDb } from "./http";

/**
 * 检查并执行限流。
 *
 * 使用原子 upsert（INSERT ... ON CONFLICT DO UPDATE）实现：
 * 1. 计算当前 60 秒窗口的起始时间戳
 * 2. 尝试插入 (action, ipHash, windowStart) → requestCount=1
 * 3. 如果已存在，原子递增 requestCount + 1
 * 4. returning 获取最新计数，判断是否超限
 *
 * 相比旧版"SELECT COUNT + INSERT"两步模式，消除了并发竞态条件。
 *
 * @param c - Hono 上下文
 * @param action - 操作标识（如 "create_order"、"pay_callback"），不同操作独立计数
 * @param limit - 每分钟最大请求数，默认 8
 * @returns 通过时返回 { ok: true, ipHash }，被限流时返回 { ok: false, status: 429, message }
 */
export async function enforceRateLimit(c: Context<AppEnv>, action: string, limit = 8) {
  const ipHash = await getIpHash(c);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / 60) * 60;
  const db = getDb(c);

  // 原子 upsert：INSERT or UPDATE + RETURNING，一次数据库操作完成计数
  const qb = db
    .insert(rateLimitWindows)
    .values({
      action,
      ipHash,
      windowStart,
      requestCount: 1,
    })
    .onConflictDoUpdate({
      target: [rateLimitWindows.action, rateLimitWindows.ipHash, rateLimitWindows.windowStart],
      set: {
        requestCount: sql`${rateLimitWindows.requestCount} + 1`,
      },
    });

  const results = await ((qb.returning as any)({ count: rateLimitWindows.requestCount })) as { count: number }[] | undefined;

  const row = results?.[0];

  const currentCount = row?.count ?? 1;

  if (currentCount > limit) {
    await writeRequestLog(c, action, 429, ipHash);
    return { ok: false, status: 429, message: "请求过于频繁，请稍后再试" };
  }

  return { ok: true, ipHash };
}

/**
 * 写入请求日志到 request_logs 表。
 * 每次请求（包括被限流的请求）都应调用此函数记录，供审计使用。
 *
 * @param c - Hono 上下文
 * @param action - 操作标识
 * @param statusCode - HTTP 状态码
 * @param ipHash - 可选的 IP 哈希，不传则自动计算
 */
export async function writeRequestLog(c: Context<AppEnv>, action: string, statusCode: number, ipHash?: string) {
  const hash = ipHash || await getIpHash(c);
  const db = getDb(c);

  await db.insert(requestLogs).values({
    id: crypto.randomUUID(),
    ipHash: hash,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    action,
    statusCode,
    createdAt: new Date().toISOString(),
  });

  // 5% 概率清理超过 30 天的旧日志（fire-and-forget）
  if (Math.random() < 0.05) {
    try { db.$client.execute(`DELETE FROM request_logs WHERE created_at < datetime('now', '-30 days')`).catch(() => {}); } catch { /* mock DB may not have execute */ }
  }
}