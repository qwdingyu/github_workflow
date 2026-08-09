/**
 * 持久化限流（对齐 lottery `checkDbRateLimit` 原子 INSERT 模式）。
 *
 * 为什么用 DB 而不是纯内存 Map：
 * - Workers 多 isolate 时内存 Map 不一致
 * - 本地 Node 与生产同一语义，单测可断言 429
 *
 * 覆盖面（P0-2）：sign-up、authorize、token、admin 写操作入口。
 *
 * 自 v0.5.0 起：委托 @usethink/cf-core/rate-limit 的 DbAtomicRateLimiter。
 */
import type { AtomicRateLimitDb } from "@usethink/cf-core/rate-limit";
import { checkDbRateLimit as coreCheckDbRateLimit, cleanExpiredRateLimits as coreCleanExpiredRateLimits } from "@usethink/cf-core/rate-limit";
import type { AuthDb } from "../db/client";

/**
 * @returns true = 允许；false = 超限应返回 429
 */
export async function checkDbRateLimit(
  db: AuthDb,
  key: string,
  limit: number,
  windowMs: number = 60_000,
): Promise<boolean> {
  return coreCheckDbRateLimit(db as unknown as AtomicRateLimitDb, key, limit, windowMs);
}

/** 清理过期行；可由 cron / 启动时偶尔调用 */
export async function cleanExpiredRateLimits(
  db: AuthDb,
  olderThanMs: number = 3_600_000,
): Promise<number> {
  return coreCleanExpiredRateLimits(db as unknown as AtomicRateLimitDb, olderThanMs);
}

/** 常用桶：与路径绑定，便于文档与单测对齐 */
export const RATE_LIMITS = {
  /** 邮箱注册：同 IP 每分钟 */
  signUp: { limit: 10, windowMs: 60_000 },
  /** 邮箱登录 */
  signIn: { limit: 30, windowMs: 60_000 },
  /** authorize 入口 */
  authorize: { limit: 60, windowMs: 60_000 },
  /** token 兑换 */
  token: { limit: 60, windowMs: 60_000 },
  /** admin 写操作 */
  adminWrite: { limit: 30, windowMs: 60_000 },
} as const;
