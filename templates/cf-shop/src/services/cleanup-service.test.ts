import { describe, it, expect, vi } from "vitest";
import type { DbType } from "../db/client";

// ---------------------------------------------------------------------------
// cleanupExpiredOrders 现在调用 checkAndExpireOrder（复用发邮件逻辑）
// 我们 mock order-service 的 checkAndExpireOrder
// ---------------------------------------------------------------------------

vi.mock("./order-service", () => ({
  checkAndExpireOrder: vi.fn().mockResolvedValue({ expired: true, releasedCards: 1 }),
}));

import { cleanupExpiredOrders } from "./cleanup-service";
import { checkAndExpireOrder } from "./order-service";
const mockCheckAndExpire = vi.mocked(checkAndExpireOrder);

/**
 * Create a mock DbType that supports the Drizzle ORM operations used by cleanupExpiredOrders.
 *
 * The cleanup service now does:
 *   1. db.select({id, status, expiresAt, orderNo, buyerEmail, productTitle})
 *      .from(orders).innerJoin(products, ...).where(...)
 *      → returns expired order rows
 *   2. For each expired order, calls checkAndExpireOrder(db, id, expiresAt, status, env, orderInfo)
 *   3. db.select({id, lockedOrderId}).from(cards).where(...) — orphaned cards
 *   4. db.update(cards).set({...}).where(...) — release orphaned cards
 *   5. db.insert(cardLogs).values({...}).catch(...) — audit log for orphaned releases
 */
function createMockDb(options: {
  expiredOrders?: Array<{
    id: string; status: string; expiresAt: string;
    orderNo: string | null; buyerEmail: string | null; productTitle: string;
  }>;
  orphanedCards?: Array<{ id: string; lockedOrderId: string | null }>;
} = {}): DbType {
  const { expiredOrders = [], orphanedCards = [] } = options;
  const insertedLogs: Array<{ cardId: string; action: string }> = [];

  const mockInsert = () => ({
    values: (data: Record<string, unknown>) => {
      // Capture audit log inserts
      if (data.cardId && data.action) {
        insertedLogs.push({ cardId: String(data.cardId), action: String(data.action) });
      }
      return {
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([{}]) }),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([{}]) }),
        // .catch() chain for audit logs (orphaned card release)
        catch: (_handler: (err: unknown) => void) => Promise.resolve(),
      };
    },
  });

  return {
    _insertedLogs: insertedLogs, // exposed for test assertions
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(expiredOrders),
        }),
        where: () => Promise.resolve(orphanedCards), // for orphaned cards query
      }),
    }),
    update: () => ({
      set: (_data: unknown) => ({
        where: () => ({
          returning: () => Promise.resolve([{}]),
        }),
      }),
    }),
    insert: mockInsert,
    run: () => Promise.resolve({ rows: [] }),
    delete: () => ({
      where: () => Promise.resolve({ rowsAffected: 0 }),
    }),
  } as unknown as DbType & { _insertedLogs: typeof insertedLogs };
}

describe("cleanupExpiredOrders", () => {
  it("returns zero counts when no expired orders", async () => {
    const db = createMockDb({ expiredOrders: [] });
    const result = await cleanupExpiredOrders(db);
    expect(result.expiredOrders).toBe(0);
    expect(result.releasedCards).toBe(0);
  });

  it("expires pending orders via checkAndExpireOrder", async () => {
    const db = createMockDb({
      expiredOrders: [
        { id: "order-1", status: "pending", expiresAt: "2020-01-01T00:00:00Z", orderNo: "NO-1", buyerEmail: "a@b.com", productTitle: "Product A" },
        { id: "order-2", status: "pending", expiresAt: "2020-01-01T00:00:00Z", orderNo: "NO-2", buyerEmail: "c@d.com", productTitle: "Product B" },
      ],
    });
    mockCheckAndExpire.mockResolvedValue({ expired: true, releasedCards: 1 });
    const result = await cleanupExpiredOrders(db);
    expect(result.expiredOrders).toBe(2);
    expect(result.releasedCards).toBeGreaterThanOrEqual(2); // 2 from checkAndExpire + orphaned
    expect(mockCheckAndExpire).toHaveBeenCalledTimes(2);
  });

  it("passes env and orderInfo to checkAndExpireOrder for email notification", async () => {
    const db = createMockDb({
      expiredOrders: [
        { id: "order-1", status: "pending", expiresAt: "2020-01-01T00:00:00Z", orderNo: "NO-1", buyerEmail: "a@b.com", productTitle: "Product A" },
      ],
    });
    mockCheckAndExpire.mockResolvedValue({ expired: true, releasedCards: 1 });
    const env = { RESEND_API_KEY: "re_key", EMAIL_FROM: "eshop <noreply@eforge.xyz>" };
    await cleanupExpiredOrders(db, env);
    expect(mockCheckAndExpire).toHaveBeenCalledWith(
      db,
      "order-1",
      "2020-01-01T00:00:00Z",
      "pending",
      env,
      { orderNo: "NO-1", productTitle: "Product A", buyerEmail: "a@b.com" },
      undefined // no executionCtx
    );
  });

  it("counts only orders where checkAndExpireOrder returns true", async () => {
    const db = createMockDb({
      expiredOrders: [
        { id: "order-1", status: "pending", expiresAt: "2020-01-01T00:00:00Z", orderNo: "NO-1", buyerEmail: "a@b.com", productTitle: "Product A" },
        { id: "order-2", status: "pending", expiresAt: "2020-01-01T00:00:00Z", orderNo: "NO-2", buyerEmail: "c@d.com", productTitle: "Product B" },
      ],
    });
    mockCheckAndExpire
      .mockResolvedValueOnce({ expired: true, releasedCards: 1 })   // order-1 expired
      .mockResolvedValueOnce({ expired: false, releasedCards: 0 }); // order-2 already handled
    const result = await cleanupExpiredOrders(db);
    expect(result.expiredOrders).toBe(1);
    expect(result.releasedCards).toBeGreaterThanOrEqual(1); // at least 1 from order-1
  });

  it("releases orphaned locked cards and writes audit logs", async () => {
    mockCheckAndExpire.mockResolvedValue({ expired: false, releasedCards: 0 });
    const db = createMockDb({
      expiredOrders: [],
      orphanedCards: [
        { id: "card-1", lockedOrderId: "old-order-1" },
        { id: "card-2", lockedOrderId: null },
      ],
    });
    const result = await cleanupExpiredOrders(db);
    expect(result.expiredOrders).toBe(0);
    expect(result.releasedCards).toBe(2);

    // 验证审计日志已写入
    const logs = (db as any)._insertedLogs;
    expect(logs).toHaveLength(2);
    expect(logs[0]).toEqual({ cardId: "card-1", action: "released_orphaned" });
    expect(logs[1]).toEqual({ cardId: "card-2", action: "released_orphaned" });
  });
});
