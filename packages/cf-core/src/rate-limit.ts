/**
 * 统一限流模块 — 支持 DB / KV / 内存 三种存储后端
 *
 * 三项目的限流实现各有特点：
 * - eshop: DB 版（原子 upsert，最可靠，适合无 KV 的项目）
 * - xtools: KV 版（滑动窗口，跨实例共享）
 * - vcode: 内存版（最轻量，但重启丢失）
 *
 * 本模块统一接口，项目按自己的基础设施选择后端。
 */

import type { RateLimitResult } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
// 统一接口
// ═══════════════════════════════════════════════════════════════════════════════

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 内存版（最轻量 — 适合 vcode 类项目）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 内存固定窗口限流器
 *
 * Workers 实例级别，重启后重置。
 * 适合请求量不大、对精确性要求不高的场景。
 */
export class MemoryRateLimiter implements RateLimiter {
  private store = new Map<string, { count: number; resetAt: number }>();

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const record = this.store.get(key);

    if (!record || now > record.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, remaining: limit - 1 };
    }

    if (record.count >= limit) {
      const resetMs = Math.max(0, record.resetAt - now);
      return { ok: false, message: "请求过于频繁，请稍后再试", status: 429, resetMs };
    }

    record.count++;
    return { ok: true, remaining: limit - record.count };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// KV 版（跨实例共享 — 适合 xtools 类项目）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * KV 滑动窗口限流器
 *
 * 使用 Cloudflare KV 存储，跨 Workers 实例共享状态。
 * 滑动窗口算法，避免固定窗口边界突发。
 *
 * 来源：xtools src/lib/rate-limiter.ts
 */
export class KvRateLimiter implements RateLimiter {
  private kv: KVNamespace;
  private prefix: string;

  constructor(kv: KVNamespace, prefix = "rate") {
    this.kv = kv;
    this.prefix = prefix;
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const kvKey = `${this.prefix}:${key}`;

    try {
      const data = await this.kv.get(kvKey, "json");
      const timestamps: number[] = Array.isArray(data) ? data : [];
      const valid = timestamps.filter((ts) => ts > windowStart);

      if (valid.length >= limit) {
        const oldest = Math.min(...valid);
        const resetMs = Math.max(0, oldest + windowMs - now);
        return { ok: false, message: "请求过于频繁，请稍后再试", status: 429, remaining: 0, resetMs };
      }

      valid.push(now);
      const ttlSeconds = Math.ceil(windowMs / 1000) + 10;
      await this.kv.put(kvKey, JSON.stringify(valid), { expirationTtl: ttlSeconds });

      const remaining = Math.max(0, limit - valid.length);
      return { ok: true, remaining };
    } catch (err) {
      console.warn("[KvRateLimiter] KV error, failing open:", err instanceof Error ? err.message : String(err));
      return { ok: true, remaining: limit };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DB 版（最可靠 — 适合 eshop 类项目）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 数据库固定窗口限流器
 *
 * 使用 rate_limit_windows 表，通过原子 upsert（INSERT ON CONFLICT UPDATE）实现。
 * 一次数据库操作完成检查与计数，消除竞态条件。
 *
 * 来源：eshop src/lib/rate-limit.ts
 */
export class DbRateLimiter implements RateLimiter {
  private db: {
    insert: (table: unknown) => {
      values: (data: unknown) => {
        onConflictDoUpdate: (opts: unknown) => {
          returning: (cols: unknown) => Promise<{ count: number }[]>;
        };
      };
    };
  };
  private table: unknown;
  private actionColumn: unknown;
  private ipHashColumn: unknown;
  private windowStartColumn: unknown;
  private countColumn: unknown;

  constructor(
    db: DbRateLimiter["db"],
    table: unknown,
    columns: {
      action: unknown;
      ipHash: unknown;
      windowStart: unknown;
      requestCount: unknown;
    },
  ) {
    this.db = db;
    this.table = table;
    this.actionColumn = columns.action;
    this.ipHashColumn = columns.ipHash;
    this.windowStartColumn = columns.windowStart;
    this.countColumn = columns.requestCount;
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const windowSeconds = Math.floor(windowMs / 1000);
    const windowStart = Math.floor(now / windowSeconds) * windowSeconds;

    try {
      const results = await this.db
        .insert(this.table)
        .values({
          action: key,
          ipHash: "",
          windowStart,
          requestCount: 1,
        })
        .onConflictDoUpdate({
          target: [this.actionColumn, this.ipHashColumn, this.windowStartColumn],
          set: { requestCount: { sql: `${String(this.countColumn)} + 1` } },
        })
        .returning({ count: this.countColumn as { count: number } });

      const currentCount = results?.[0]?.count ?? 1;
      if (currentCount > limit) {
        return { ok: false, message: "请求过于频繁，请稍后再试", status: 429 };
      }
      return { ok: true, remaining: limit - currentCount };
    } catch {
      return { ok: true };
    }
  }
}
