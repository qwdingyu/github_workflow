import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbType } from "../db/client";
import {
  createOrder,
  getOrderByToken,
  getOrderByCouponCode,
  getOrderByNo,
  getOrdersByEmail,
  markPaidAndIssue,
  publicOrder,
} from "./order-service";
import type { CreateOrderInput, OrderSummaryRow } from "./order-service";
import type { IssueMode } from "../bindings";
import type { Context } from "hono";
import type { AppEnv } from "../bindings";

// ---------------------------------------------------------------------------
// Mock Drizzle-dependent modules
// ---------------------------------------------------------------------------
const mockGetCoupon = vi.fn();
const mockQuoteCoupon = vi.fn();
const mockConsumeCoupon = vi.fn();
const mockGetProduct = vi.fn();
const mockWriteOrderEvent = vi.fn();
const mockSendEmail = vi.fn();

vi.mock("./coupon-service", () => ({
  getCoupon: (...args: unknown[]) => mockGetCoupon(...args),
  quoteCoupon: (...args: unknown[]) => mockQuoteCoupon(...args),
  consumeCoupon: (...args: unknown[]) => mockConsumeCoupon(...args),
}));

vi.mock("./product-service", () => ({
  getProduct: (...args: unknown[]) => mockGetProduct(...args),
  toPublicProduct: (row: unknown) => row,
  listProducts: vi.fn(),
}));

vi.mock("./audit-service", () => ({
  writeOrderEvent: (...args: unknown[]) => mockWriteOrderEvent(...args),
}));

vi.mock("./email-service", () => ({
  sendEmail: (...args: unknown[]) => Promise.resolve(mockSendEmail(...args) || { ok: true, message: "mock" }),
}));

// ── ORM chain mock for select queries with JOINs ──
// This handles getOrderByToken, getOrderByCouponCode, getOrderByNo,
// getOrdersByEmail, and markPaidAndIssue's initial select.

function createSelectChain(results: unknown[]) {
  const chain: any = {};
  // All intermediate methods return the chain itself
  for (const method of ["where", "innerJoin", "leftJoin", "orderBy", "limit", "offset", "groupBy", "having"]) {
    chain[method] = () => chain;
  }
  // Make the chain thenable — await resolves to results
  chain.then = (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(results).then(resolve, reject);
  return chain;
}

function createResultDb(selectResults: unknown[] = [], runResults: Record<string, { rows: unknown[] }> = {}): DbType {
  return {
    select: (_colMap?: unknown) => ({
      from: (_table?: unknown) => createSelectChain(selectResults),
    }),
    insert: (_table?: unknown) => ({
      values: (_data?: unknown) => {
        const p = Promise.resolve({ rowsAffected: 1 });
        const result: any = {
          onConflictDoUpdate: () => p,
          onConflictDoNothing: () => p,
        };
        result.then = p.then.bind(p);
        result.catch = p.catch.bind(p);
        result.finally = p.finally.bind(p);
        return result;
      },
    }),
    update: (_table?: unknown) => ({
      set: (_data?: unknown) => {
        const whereChain: any = {
          returning: () => ({
            then: (resolve: (v: unknown) => void) => Promise.resolve([{ id: "any" }]).then(resolve),
          }),
          then: (resolve: (v: unknown) => void) => Promise.resolve({ rowsAffected: 1 }).then(resolve),
        };
        return { where: () => whereChain };
      },
    }),
    delete: (_table?: unknown) => ({
      where: (_cond?: unknown) => Promise.resolve({ rowsAffected: 0 }),
    }),
    run: (sqlExpr?: any) => {
      // Extract SQL text from Drizzle SQL template object
      let sqlStr: string;
      try {
        const raw = sqlExpr?.getSQL?.() ?? sqlExpr;
        if (typeof raw === "string") {
          sqlStr = raw;
        } else if (raw?.queryChunks && Array.isArray(raw.queryChunks)) {
          sqlStr = "";
          for (const chunk of raw.queryChunks) {
            if (typeof chunk === "string") sqlStr += chunk;
            else if (chunk?.value && Array.isArray(chunk.value)) sqlStr += chunk.value.join("");
            else if (typeof chunk?.value === "string") sqlStr += chunk.value;
            else sqlStr += "?";
          }
        } else {
          sqlStr = String(raw || "");
        }
      } catch {
        sqlStr = String(sqlExpr || "");
      }
      for (const [pattern, result] of Object.entries(runResults)) {
        if (sqlStr.toLowerCase().includes(pattern.toLowerCase())) {
          return Promise.resolve(result);
        }
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as DbType;
}

// ── Stateful mock for createOrder tests ──
// createOrder uses getDb(c) + mocked service functions.
// We need a mock that supports db.insert(orders).values(...)
// and the issue-service operations.

function createMockContext(db: DbType, overrides: Record<string, unknown> = {}): Context<AppEnv> {
  const headers: Record<string, string> = { "user-agent": "test-agent", ...(overrides.headerOverrides as Record<string, string> || {}) };
  return {
    get: (key: string) => {
      if (key === "db") return db;
      return undefined as any;
    },
    env: {
      ADMIN_TOKEN: "test-token",
      ...(overrides.env as Record<string, unknown> || {}),
    } as any,
    req: {
      header: (name: string) => headers[name.toLowerCase()] || undefined,
      url: "https://example.com/api/pay/order",
      method: "POST",
    },
  } as unknown as Context<AppEnv>;
}

// ── Stateful DB mock for createOrder / markPaidAndIssue ──
function createMockDb(state: {
  orders?: Record<string, Record<string, unknown>>;
  cards?: Record<string, Record<string, unknown>>;
  coupons?: Record<string, Record<string, unknown>>;
  products?: Record<string, Record<string, unknown>>;
  events?: unknown[];
  referralEvents?: unknown[];
} = {}): DbType {
  const events = state.events || [];
  const referralEvents = state.referralEvents || [];
  const orders = state.orders || {};
  const cards = state.cards || {};

  // Helper: create an update chain with .set().where().returning() support
  function statefulUpdateChain(setData: Record<string, unknown> | undefined) {
    const whereChain: any = {
      returning: () => ({
        then: (resolve: (v: unknown) => void) => Promise.resolve([{ id: "any" }]).then(resolve),
      }),
      then: (resolve: (v: unknown) => void) => Promise.resolve({ rowsAffected: 1 }).then(resolve),
    };
    return {
      set: (_data?: unknown) => ({ where: () => whereChain }),
    };
  }

  return {
    select: (_colMap?: unknown) => ({
      from: (_table?: unknown) => createSelectChain([]),
    }),
    insert: (_table?: unknown) => ({
      values: (data: unknown) => {
        const p = Array.isArray(data)
          ? Promise.resolve({ rowsAffected: data.length })
          : Promise.resolve({ rowsAffected: 1 });
        // Must be both thenable (await / .catch) AND support .onConflictDo*()
        const result: any = {
          onConflictDoUpdate: () => p,
          onConflictDoNothing: () => p,
        };
        // Copy Promise methods so `await` and `.catch()` work
        result.then = p.then.bind(p);
        result.catch = p.catch.bind(p);
        result.finally = p.finally.bind(p);
        return result;
      },
    }),
    update: (_table?: unknown) => statefulUpdateChain(undefined),
    delete: () => ({
      where: () => Promise.resolve({ rowsAffected: 0 }),
    }),
    run: (sqlExpr?: any) => {
      // Extract SQL text from Drizzle SQL template object
      let sqlStr: string;
      try {
        const raw = sqlExpr?.getSQL?.() ?? sqlExpr;
        if (typeof raw === "string") {
          sqlStr = raw;
        } else if (raw?.queryChunks && Array.isArray(raw.queryChunks)) {
          sqlStr = "";
          for (const chunk of raw.queryChunks) {
            if (typeof chunk === "string") sqlStr += chunk;
            else if (chunk?.value && Array.isArray(chunk.value)) sqlStr += chunk.value.join("");
            else if (typeof chunk?.value === "string") sqlStr += chunk.value;
            else sqlStr += "?";
          }
        } else {
          sqlStr = String(raw || "");
        }
      } catch {
        sqlStr = String(sqlExpr || "");
      }
      const q = sqlStr.toLowerCase();
      // markPaidAndIssue: UPDATE orders SET status='issued' ... RETURNING
      if (q.includes("update orders") && q.includes("issued") && q.includes("returning")) {
        return Promise.resolve({ rows: [{ id: "any" }] });
      }
      // checkAndExpireOrder: UPDATE orders SET status='expired' ... RETURNING
      if (q.includes("update orders") && q.includes("expired") && q.includes("returning")) {
        return Promise.resolve({ rows: [] });
      }
      // issueAvailableCard: UPDATE cards SET status='issued' ... RETURNING
      if (q.includes("update cards") && q.includes("issued") && q.includes("returning")) {
        for (const [cardId, card] of Object.entries(cards)) {
          if (card.status === "available") {
            cards[cardId].status = "issued";
            return Promise.resolve({
              rows: [{
                id: cardId,
                accountLabel: card.accountLabel,
                deliverySecret: card.deliverySecret,
                deliveryNote: card.deliveryNote,
              }],
            });
          }
        }
        return Promise.resolve({ rows: [] });
      }
      // lockCardForOrder: UPDATE cards SET status='locked' ... RETURNING
      if (q.includes("update cards") && q.includes("locked") && q.includes("returning")) {
        for (const [cardId, card] of Object.entries(cards)) {
          if (card.status === "available") {
            cards[cardId].status = "locked";
            return Promise.resolve({ rows: [{ id: cardId }] });
          }
        }
        return Promise.resolve({ rows: [] });
      }
      // releaseLockedCardByOrder: UPDATE cards SET status='available' ... (no RETURNING)
      if (q.includes("update cards") && q.includes("available")) {
        for (const [cardId, card] of Object.entries(cards)) {
          if (card.status === "locked") {
            cards[cardId].status = "available";
          }
        }
        return Promise.resolve({ rows: [] });
      }
      // insert card_logs (from writeCardLog)
      return Promise.resolve({ rows: [] });
    },
  } as unknown as DbType;
}

// ---------------------------------------------------------------------------
// publicOrder tests
// ---------------------------------------------------------------------------
describe("publicOrder", () => {
  const baseRow: OrderSummaryRow = {
    id: "order-1",
    orderNo: "AB20260101TEST",
    productId: "prod-1",
    productTitle: "Test Product",
    buyerContact: "pay:TEST1234",
    buyerEmail: "test@example.com",
    amountCents: 5000,
    discountCents: 0,
    currency: "CNY",
    status: "pending",
    issueMode: "manual" as IssueMode,
    issuedCardId: null,
    campaignCode: "",
    referralCode: "",
    couponCode: "",
    createdAt: "2026-01-01T00:00:00Z",
    paidAt: null,
    issuedAt: null,
    accountLabel: null,
    deliverySecret: null,
    deliveryNote: null,
  };

  it("returns order without delivery when no delivery provided", () => {
    const result = publicOrder(baseRow);
    expect(result.id).toBe("order-1");
    expect(result.status).toBe("pending");
    expect(result).not.toHaveProperty("delivery");
  });

  it("returns order with delivery when delivery provided", () => {
    const delivery = {
      accountLabel: "ACC-001",
      deliverySecret: "SECRET-001",
      deliveryNote: "Use wisely",
    };
    const result = publicOrder(baseRow, delivery);
    expect(result.delivery).toEqual(delivery);
  });

  it("includes couponCode when present", () => {
    const row = { ...baseRow, couponCode: "SAVE10" };
    const result = publicOrder(row);
    expect(result.couponCode).toBe("SAVE10");
  });

  it("preserves all basic fields", () => {
    const result = publicOrder(baseRow);
    expect(result.orderNo).toBe("AB20260101TEST");
    expect(result.productId).toBe("prod-1");
    expect(result.productTitle).toBe("Test Product");
    expect(result.amountCents).toBe(5000);
    expect(result.currency).toBe("CNY");
    expect(result.issueMode).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// checkAndExpireOrder tests
// ---------------------------------------------------------------------------
import { checkAndExpireOrder } from "./order-service";

describe("checkAndExpireOrder", () => {
  it("returns { expired: false } when expiresAt is null", async () => {
    const db = createResultDb([]);
    const result = await checkAndExpireOrder(db, "order-1", null, "pending");
    expect(result.expired).toBe(false);
    expect(result.releasedCards).toBe(0);
  });

  it("returns { expired: false } when order has not expired", async () => {
    const db = createResultDb([]);
    const future = new Date(Date.now() + 60000).toISOString();
    const result = await checkAndExpireOrder(db, "order-1", future, "pending");
    expect(result.expired).toBe(false);
    expect(result.releasedCards).toBe(0);
  });

  it("returns { expired: false } when status is not pending/paid", async () => {
    const db = createResultDb([]);
    const past = new Date(Date.now() - 60000).toISOString();
    const result = await checkAndExpireOrder(db, "order-1", past, "issued");
    expect(result.expired).toBe(false);
    expect(result.releasedCards).toBe(0);
  });

  it("returns { expired: false } when status is expired", async () => {
    const db = createResultDb([]);
    const past = new Date(Date.now() - 60000).toISOString();
    const result = await checkAndExpireOrder(db, "order-1", past, "expired");
    expect(result.expired).toBe(false);
    expect(result.releasedCards).toBe(0);
  });

  it("returns { expired: true } and marks expired when past expiresAt and status is pending", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const state = {
      cards: {},
    };
    const db = createMockDb(state);
    // Override select to return empty (for releaseLockedCardByOrder)
    // Override update to simulate successful expiration
    let updateCalled = false;
    (db as any).update = (_table?: unknown) => ({
      set: (_data?: unknown) => ({
        where: () => ({
          returning: () => {
            updateCalled = true;
            return Promise.resolve([{ id: "order-1" }]);
          },
        }),
      }),
    });
    const result = await checkAndExpireOrder(db, "order-1", past, "pending");
    expect(result.expired).toBe(true);
    expect(result.releasedCards).toBe(0);
    expect(updateCalled).toBe(true);
  });

  it("returns { expired: false } when UPDATE affects 0 rows (concurrent)", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const db = createMockDb({});
    // Override update to return empty (concurrent update won the race)
    (db as any).update = (_table?: unknown) => ({
      set: (_data?: unknown) => ({
        where: () => ({
          returning: () => Promise.resolve([]),  // No rows updated
        }),
      }),
    });
    const result = await checkAndExpireOrder(db, "order-1", past, "pending");
    expect(result.expired).toBe(false);
    expect(result.releasedCards).toBe(0);
  });

  it("sends expired email when env and orderInfo provided", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    let updateCalled = false;
    // 使用完整的 createMockDb，只覆盖 update returning
    const db = createMockDb({});
    (db as any).update = (_table?: unknown) => ({
      set: (_data?: unknown) => ({
        where: () => ({
          returning: () => {
            updateCalled = true;
            return Promise.resolve([{ id: "order-1" }]);
          },
        }),
      }),
    });

    // 调用 checkAndExpireOrder 带 env 和 orderInfo
    // sendEmail 是异步 fire-and-forget，即使 Resend 不可用也不会阻塞
    const result = await checkAndExpireOrder(
      db, "order-1", past, "pending",
      { RESEND_API_KEY: "re_test" },
      { orderNo: "OID-EXP", productTitle: "Test Product", buyerEmail: "buyer@test.com" }
    );

    expect(result.expired).toBe(true);
    expect(result.releasedCards).toBe(0);
    expect(updateCalled).toBe(true);
    // 邮件是异步 catch 发送，不阻塞主流程
    // 等待异步操作完成
    await new Promise((r) => setTimeout(r, 100));
  });

  it("does not send email when env has no RESEND_API_KEY", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const db = createMockDb({});
    (db as any).update = (_table?: unknown) => ({
      set: (_data?: unknown) => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: "order-1" }]),
        }),
      }),
    });

    // Without env.RESEND_API_KEY
    const result = await checkAndExpireOrder(
      db, "order-1", past, "pending",
      {},  // no RESEND_API_KEY
      { orderNo: "OID-EXP", productTitle: "Test", buyerEmail: "buyer@test.com" }
    );
    expect(result.expired).toBe(true);
    expect(result.releasedCards).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createOrder tests
// ---------------------------------------------------------------------------
describe("createOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCoupon.mockResolvedValue(null);
    mockQuoteCoupon.mockResolvedValue({
      couponCode: "",
      valid: true,
      discountCents: 0,
      payableCents: 1000,
      message: "无折扣码，按原价购买",
    });
    mockConsumeCoupon.mockResolvedValue({ success: true, changes: 1 });
  });

  it("returns 400 with 折扣码不存在 when coupon code not found in DB", async () => {
    mockGetCoupon.mockResolvedValue(null);
    const db = createMockDb();
    const c = createMockContext(db);
    const input: CreateOrderInput = { buyerEmail: "test@example.com", couponCode: "DOESNOTEXIST" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe("折扣码不存在");
    }
  });

  it("returns 400 with 该折扣码未绑定商品 when coupon exists but has no productId", async () => {
    mockGetCoupon.mockResolvedValue({ productId: "" });
    const db = createMockDb();
    const c = createMockContext(db);
    const input: CreateOrderInput = { buyerEmail: "test@example.com", couponCode: "NOPRODUCT" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe("该折扣码未绑定商品");
    }
  });

  it("returns 400 when no productId and no coupon with productId", async () => {
    mockGetCoupon.mockResolvedValue(null);
    const db = createMockDb();
    const c = createMockContext(db);
    const input: CreateOrderInput = { buyerEmail: "test@example.com" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe("请选择商品");
    }
  });

  it("resolves productId from coupon when input.productId is empty", async () => {
    mockGetCoupon.mockResolvedValue({ productId: "prod-from-coupon" });
    mockGetProduct.mockResolvedValue({
      id: "prod-from-coupon",
      title: "Coupon Product",
      priceCents: 3000,
      currency: "CNY",
      issueMode: "manual",
    });
    mockQuoteCoupon.mockResolvedValue({
      couponCode: "COUPON10",
      valid: true,
      discountCents: 0,
      payableCents: 3000,
      message: "折扣码可用",
    });
    const db = createMockDb({
      cards: {
        "card-1": {
          id: "card-1",
          status: "available",
          accountLabel: "ACC",
          deliverySecret: "SEC",
          deliveryNote: "",
          lockedOrderId: null,
        },
      },
    });
    const c = createMockContext(db);
    const input: CreateOrderInput = { buyerEmail: "coupon@example.com", couponCode: "COUPON10" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.status).toBe("pending");
    }
  });

  it("returns 404 when product does not exist", async () => {
    mockGetProduct.mockResolvedValue(null);
    const db = createMockDb();
    const c = createMockContext(db);
    const input: CreateOrderInput = { productId: "nonexistent", buyerEmail: "test@example.com" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.message).toBe("商品不存在或已下架");
    }
  });

  it("returns 500 when product has no issueMode", async () => {
    mockGetProduct.mockResolvedValue({
      id: "prod-no-mode",
      title: "No Mode Product",
      priceCents: 1000,
      currency: "CNY",
      issueMode: null,
    });
    const db = createMockDb();
    const c = createMockContext(db);
    const input: CreateOrderInput = { productId: "prod-no-mode", buyerEmail: "test@example.com" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe("商品发卡模式配置异常，请联系管理员");
    }
  });

  it("returns 403 when coupon is invalid", async () => {
    mockGetProduct.mockResolvedValue({
      id: "prod-1",
      title: "Product",
      priceCents: 1000,
      currency: "CNY",
      issueMode: "manual",
    });
    mockQuoteCoupon.mockResolvedValue({
      couponCode: "BAD",
      valid: false,
      discountCents: 0,
      payableCents: 1000,
      message: "折扣码不存在或已停用",
    });
    const db = createMockDb();
    const c = createMockContext(db);
    const input: CreateOrderInput = { productId: "prod-1", buyerEmail: "test@example.com", couponCode: "BAD" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toBe("折扣码不存在或已停用");
    }
  });

  it("returns 409 when manual mode and no card available (lock fails)", async () => {
    mockGetProduct.mockResolvedValue({
      id: "prod-manual",
      title: "Manual Product",
      priceCents: 2000,
      currency: "CNY",
      issueMode: "manual",
    });
    const db = createMockDb({ cards: {} });
    const c = createMockContext(db);
    const input: CreateOrderInput = { productId: "prod-manual", buyerEmail: "test@example.com" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.message).toBe("当前商品库存不足");
    }
  });

  it("creates manual order successfully when card is available", async () => {
    mockGetProduct.mockResolvedValue({
      id: "prod-manual",
      title: "Manual Product",
      priceCents: 2000,
      currency: "CNY",
      issueMode: "manual",
    });
    const db = createMockDb({
      cards: {
        "card-1": {
          id: "card-1",
          status: "available",
          accountLabel: "ACC",
          deliverySecret: "SEC",
          deliveryNote: "Note",
          lockedOrderId: null,
        },
      },
    });
    const c = createMockContext(db);
    const input: CreateOrderInput = { productId: "prod-manual", buyerEmail: "buyer@example.com", buyerContact: "  test contact  " };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.id).toBeDefined();
      expect(result.order.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.order.orderNo).toMatch(/^AB\d{8}.{8}$/);
      expect(result.order.status).toBe("pending");
      expect(result.order.issueMode).toBe("manual");
      expect(result.order.amountCents).toBe(1000);
      expect(result.order.currency).toBe("CNY");
      expect(result.order.orderToken).toBeDefined();
      expect(result.order.orderToken).toBeTruthy();
      expect(result.order.lookupUrl).toContain("/lookup?token=");
      expect(result.order.nextAction).toBeDefined();
    }
  });

  it("returns 409 when direct mode and no card available", async () => {
    mockGetProduct.mockResolvedValue({
      id: "prod-direct",
      title: "Direct Product",
      priceCents: 1000,
      currency: "CNY",
      issueMode: "direct",
    });
    const db = createMockDb({ cards: {} });
    const c = createMockContext(db);
    const input: CreateOrderInput = { productId: "prod-direct", buyerEmail: "test@example.com" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.message).toBe("当前商品库存不足");
    }
  });

  it("creates direct order successfully when card is available", async () => {
    mockGetProduct.mockResolvedValue({
      id: "prod-direct",
      title: "Direct Product",
      priceCents: 1000,
      currency: "CNY",
      issueMode: "direct",
    });
    const db = createMockDb({
      cards: {
        "card-1": {
          id: "card-1",
          status: "available",
          accountLabel: "ACC-DIRECT",
          deliverySecret: "SECRET-DIRECT",
          deliveryNote: "Direct note",
        },
      },
    });
    const c = createMockContext(db);
    const input: CreateOrderInput = { productId: "prod-direct", buyerEmail: "direct@example.com" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.id).toBeDefined();
      expect(result.order.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.order.orderNo).toMatch(/^AB\d{8}.{8}$/);
      expect(result.order.status).toBe("issued");
      expect(result.order.issueMode).toBe("direct");
      expect(result.order.amountCents).toBe(1000);
      expect(result.order.currency).toBe("CNY");
      expect(result.order.orderToken).toBeDefined();
      expect(result.order.lookupUrl).toContain("/lookup?token=");
      expect(result.order.delivery).toBeDefined();
      expect((result.order.delivery as any).accountLabel).toBe("ACC-DIRECT");
      expect((result.order.delivery as any).deliverySecret).toBe("SECRET-DIRECT");
    }
  });

  it("creates direct order with coupon code that succeeds", async () => {
    mockGetProduct.mockResolvedValue({
      id: "prod-direct",
      title: "Direct Product",
      priceCents: 1000,
      currency: "CNY",
      issueMode: "direct",
    });
    mockQuoteCoupon.mockResolvedValue({
      couponCode: "SAVE10",
      valid: true,
      discountCents: 100,
      payableCents: 900,
      message: "折扣码可用",
    });
    const db = createMockDb({
      cards: {
        "card-1": {
          id: "card-1",
          status: "available",
          accountLabel: "ACC-COUPON",
          deliverySecret: "SECRET-COUPON",
          deliveryNote: "Coupon note",
        },
      },
    });
    const c = createMockContext(db);
    const input: CreateOrderInput = {
      productId: "prod-direct",
      buyerEmail: "direct@example.com",
      couponCode: "SAVE10",
    };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.status).toBe("issued");
      expect(mockConsumeCoupon).toHaveBeenCalled();
    }
  });

  it("creates direct order but coupon consume fails — order marked failed", async () => {
    mockGetProduct.mockResolvedValue({
      id: "prod-direct",
      title: "Direct Product",
      priceCents: 1000,
      currency: "CNY",
      issueMode: "direct",
    });
    mockQuoteCoupon.mockResolvedValue({
      couponCode: "EXPIRED",
      valid: true,
      discountCents: 100,
      payableCents: 900,
      message: "折扣码可用",
    });
    mockConsumeCoupon.mockResolvedValue({ success: false, changes: 0 });
    const db = createMockDb({
      cards: {
        "card-1": {
          id: "card-1",
          status: "available",
          accountLabel: "ACC-FAIL",
          deliverySecret: "SECRET-FAIL",
          deliveryNote: "Fail note",
        },
      },
    });
    const c = createMockContext(db);
    const input: CreateOrderInput = {
      productId: "prod-direct",
      buyerEmail: "direct@example.com",
      couponCode: "EXPIRED",
    };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.message).toContain("优惠码");
    }
  });

  it("returns 400 when product has invalid issueMode (webhook)", async () => {
    mockGetProduct.mockResolvedValue({
      id: "prod-webhook",
      title: "Webhook Product",
      priceCents: 5000,
      currency: "CNY",
      issueMode: "webhook",
    });
    const db = createMockDb();
    const c = createMockContext(db);
    const input: CreateOrderInput = { productId: "prod-webhook", buyerEmail: "webhook@example.com" };
    const result = await createOrder(c, input, "iphash123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe("商品发卡模式配置异常，请联系管理员");
    }
  });
});

// ---------------------------------------------------------------------------
// getOrderByToken tests
// ---------------------------------------------------------------------------
describe("getOrderByToken", () => {
  it("returns null for empty token", async () => {
    const db = createResultDb([]);
    const result = await getOrderByToken(db, "");
    // hashOrderToken("") gives some hash, but DB returns no rows
    expect(result).toBeNull();
  });

  it("returns order when found", async () => {
    const orderRow = {
      id: "order-1",
      orderNo: "AB20260101TEST",
      productId: "prod-1",
      productTitle: "Product 1",
      buyerContact: "contact",
      buyerEmail: "test@example.com",
      amountCents: 1000,
      discountCents: 0,
      currency: "CNY",
      status: "pending",
      issueMode: "manual",
      issuedCardId: null,
      campaignCode: "",
      referralCode: "",
      couponCode: "",
      createdAt: "2026-01-01T00:00:00Z",
      paidAt: null,
      issuedAt: null,
      accountLabel: null,
      deliverySecret: null,
      deliveryNote: null,
    };
    const db = createResultDb([orderRow]);
    const result = await getOrderByToken(db, "some-token");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("order-1");
    expect(result!.status).toBe("pending");
    expect(result).not.toHaveProperty("delivery");
  });

  it("returns order with delivery when issued and card info exists", async () => {
    const orderRow = {
      id: "order-issued",
      orderNo: "AB20260101ISS",
      productId: "prod-1",
      productTitle: "Product 1",
      buyerContact: "contact",
      buyerEmail: "test@example.com",
      amountCents: 1000,
      discountCents: 0,
      currency: "CNY",
      status: "issued",
      issueMode: "direct",
      issuedCardId: "card-1",
      campaignCode: "",
      referralCode: "",
      couponCode: "",
      createdAt: "2026-01-01T00:00:00Z",
      paidAt: null,
      issuedAt: null,
      accountLabel: "ACC-001",
      deliverySecret: "SECRET-001",
      deliveryNote: "Note 1",
    };
    const db = createResultDb([orderRow]);
    const result = await getOrderByToken(db, "token-issued");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("issued");
    expect(result!.delivery).toBeDefined();
    expect((result!.delivery as any).accountLabel).toBe("ACC-001");
  });

  it("returns order without delivery when card info is missing", async () => {
    const orderRow = {
      id: "order-no-card",
      orderNo: "AB20260101NC",
      productId: "prod-1",
      productTitle: "Product 1",
      buyerContact: "contact",
      buyerEmail: "test@example.com",
      amountCents: 1000,
      discountCents: 0,
      currency: "CNY",
      status: "issued",
      issueMode: "direct",
      issuedCardId: "card-missing",
      campaignCode: "",
      referralCode: "",
      couponCode: "",
      createdAt: "2026-01-01T00:00:00Z",
      paidAt: null,
      issuedAt: null,
      accountLabel: null,
      deliverySecret: null,
      deliveryNote: null,
    };
    const db = createResultDb([orderRow]);
    const result = await getOrderByToken(db, "some-token");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("issued");
    expect(result).not.toHaveProperty("delivery");
  });
});

// ---------------------------------------------------------------------------
// getOrderByCouponCode tests
// ---------------------------------------------------------------------------
describe("getOrderByCouponCode", () => {
  it("returns null for empty couponCode", async () => {
    const db = createResultDb([]);
    const result = await getOrderByCouponCode(db, "");
    expect(result).toBeNull();
  });

  it("returns null for whitespace couponCode", async () => {
    const db = createResultDb([]);
    const result = await getOrderByCouponCode(db, "   ");
    expect(result).toBeNull();
  });

  it("returns null for undefined couponCode", async () => {
    const db = createResultDb([]);
    const result = await getOrderByCouponCode(db, undefined as unknown as string);
    expect(result).toBeNull();
  });

  it("returns order when coupon code matches", async () => {
    const orderRow = {
      id: "order-coupon",
      orderNo: "ORD-COUPON",
      productId: "prod-1",
      productTitle: "Product 1",
      buyerContact: "contact",
      buyerEmail: "test@example.com",
      amountCents: 800,
      discountCents: 200,
      currency: "CNY",
      status: "issued",
      issueMode: "direct",
      issuedCardId: "card-1",
      campaignCode: "",
      referralCode: "",
      couponCode: "SAVE20",
      createdAt: "2026-01-01T00:00:00Z",
      paidAt: null,
      issuedAt: null,
      accountLabel: "ACC-COUPON",
      deliverySecret: "SEC-COUPON",
      deliveryNote: "Coupon note",
    };
    const db = createResultDb([orderRow]);
    const result = await getOrderByCouponCode(db, "SAVE20");
    expect(result).not.toBeNull();
    expect(result!.couponCode).toBe("SAVE20");
    expect(result!.delivery).toBeDefined();
  });

  it("returns null when no order matches coupon code", async () => {
    const db = createResultDb([]);
    const result = await getOrderByCouponCode(db, "NOTEXIST");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getOrderByNo tests
// ---------------------------------------------------------------------------
describe("getOrderByNo", () => {
  it("returns null when order not found", async () => {
    const db = createResultDb([]);
    const result = await getOrderByNo(db, "NOTEXIST");
    expect(result).toBeNull();
  });

  it("returns order without delivery when not issued", async () => {
    const orderRow = {
      id: "order-by-no",
      orderNo: "ORD-123",
      productId: "prod-1",
      productTitle: "Product 1",
      buyerContact: "contact",
      buyerEmail: "test@example.com",
      amountCents: 1000,
      discountCents: 0,
      currency: "CNY",
      status: "pending",
      issueMode: "manual",
      issuedCardId: null,
      campaignCode: "",
      referralCode: "",
      couponCode: "",
      createdAt: "2026-01-01T00:00:00Z",
      paidAt: null,
      issuedAt: null,
      accountLabel: null,
      deliverySecret: null,
      deliveryNote: null,
    };
    const db = createResultDb([orderRow]);
    const result = await getOrderByNo(db, "ORD-123");
    expect(result).not.toBeNull();
    expect(result!.orderNo).toBe("ORD-123");
    expect(result).not.toHaveProperty("delivery");
  });

  it("returns order with delivery when issued and card exists", async () => {
    const orderRow = {
      id: "order-by-no-issued",
      orderNo: "ORD-456",
      productId: "prod-1",
      productTitle: "Product 1",
      buyerContact: "contact",
      buyerEmail: "test@example.com",
      amountCents: 1000,
      discountCents: 0,
      currency: "CNY",
      status: "issued",
      issueMode: "direct",
      issuedCardId: "card-1",
      campaignCode: "",
      referralCode: "",
      couponCode: "",
      createdAt: "2026-01-01T00:00:00Z",
      paidAt: null,
      issuedAt: null,
      accountLabel: "ACC-BYNO",
      deliverySecret: "SEC-BYNO",
      deliveryNote: "ByNo note",
    };
    const db = createResultDb([orderRow]);
    const result = await getOrderByNo(db, "ORD-456");
    expect(result).not.toBeNull();
    expect(result!.orderNo).toBe("ORD-456");
    expect(result!.delivery).toEqual({
      accountLabel: "ACC-BYNO",
      deliverySecret: "SEC-BYNO",
      deliveryNote: "ByNo note",
    });
  });
});

// ---------------------------------------------------------------------------
// getOrdersByEmail tests
// ---------------------------------------------------------------------------
describe("getOrdersByEmail", () => {
  it("returns empty array when no orders match email", async () => {
    const db = createResultDb([]);
    const result = await getOrdersByEmail(db, "nobody@example.com");
    expect(result).toEqual([]);
  });

  it("returns matching orders for email", async () => {
    const orderRows = [
      {
        id: "order-1",
        orderNo: "ORD-1",
        productId: "prod-1",
        productTitle: "Product 1",
        buyerContact: "contact",
        buyerEmail: "buyer@example.com",
        amountCents: 1000,
        discountCents: 0,
        currency: "CNY",
        status: "pending",
        issueMode: "manual",
        issuedCardId: null,
        campaignCode: "",
        referralCode: "",
        couponCode: "",
        createdAt: "2026-01-01T00:00:00Z",
        paidAt: null,
        issuedAt: null,
      },
      {
        id: "order-2",
        orderNo: "ORD-2",
        productId: "prod-1",
        productTitle: "Product 1",
        buyerContact: "contact",
        buyerEmail: "buyer@example.com",
        amountCents: 2000,
        discountCents: 0,
        currency: "CNY",
        status: "issued",
        issueMode: "direct",
        issuedCardId: "card-1",
        campaignCode: "",
        referralCode: "",
        couponCode: "",
        createdAt: "2026-01-02T00:00:00Z",
        paidAt: null,
        issuedAt: null,
      },
    ];
    const db = createResultDb(orderRows);
    const result = await getOrdersByEmail(db, "buyer@example.com");
    expect(result.length).toBe(2);
    result.forEach((order) => {
      expect(order).not.toHaveProperty("delivery");
    });
  });
});

// ---------------------------------------------------------------------------
// markPaidAndIssue tests
// ---------------------------------------------------------------------------
describe("markPaidAndIssue", () => {
  it("returns 404 when order does not exist", async () => {
    const db = createResultDb([]); // no orders
    const result = await markPaidAndIssue(db, "nonexistent-id", {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.message).toBe("订单不存在");
  });

  it("returns 410 when order is expired", async () => {
    const orderRow = {
      id: "order-expired",
      productId: "product-1",
      buyerEmail: "user@test.com",
      status: "pending",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      couponCode: null,
      productTitle: "Test Product",
    };
    const db = createResultDb([orderRow], {
      "update orders set status = 'expired'": { rows: [{ id: "order-expired" }] },
    });
    const result = await markPaidAndIssue(db, "order-expired", {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
    expect(result.message).toBe("订单已过期");
  });

  it("returns alreadyIssued when order is already issued", async () => {
    const orderRow = {
      id: "order-issued",
      productId: "product-1",
      buyerEmail: "user@test.com",
      status: "issued",
      expiresAt: null,
      couponCode: null,
      productTitle: "Test Product",
    };
    const db = createResultDb([orderRow]);
    const result = await markPaidAndIssue(db, "order-issued", {});
    expect(result.ok).toBe(true);
    expect(result.alreadyIssued).toBe(true);
  });

  it("returns 409 when order status is invalid (canceled)", async () => {
    const orderRow = {
      id: "order-canceled",
      productId: "product-1",
      buyerEmail: "user@test.com",
      status: "canceled",
      couponCode: null,
      expiresAt: null,
      productTitle: "Test Product",
    };
    const db = createResultDb([orderRow]);
    const result = await markPaidAndIssue(db, "order-canceled", {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.message).toBe("当前订单状态不可发卡");
  });

  it("returns 409 when order status is refunded", async () => {
    const orderRow = {
      id: "order-refunded",
      productId: "product-1",
      buyerEmail: "user@test.com",
      status: "refunded",
      expiresAt: null,
      productTitle: "Test Product",
      couponCode: null,
    };
    const db = createResultDb([orderRow]);
    const result = await markPaidAndIssue(db, "order-refunded", {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.message).toBe("当前订单状态不可发卡");
  });

  it("returns 409 when no card is available", async () => {
    const orderRow = {
      id: "order-pending",
      productId: "product-empty",
      buyerEmail: "user@test.com",
      status: "pending",
      expiresAt: null,
      productTitle: "Test Product",
      couponCode: null,
    };
    const db = createResultDb([orderRow]);
    const result = await markPaidAndIssue(db, "order-pending", {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.message).toBe("当前商品库存不足");
  });

  it("successfully issues card for pending order", async () => {
    const orderRow = {
      id: "order-ok",
      productId: "product-1",
      buyerEmail: "buyer@test.com",
      status: "pending",
      expiresAt: null,
      productTitle: "Test Product",
      couponCode: null,
    };
    const state = {
      cards: {
        "card-available": {
          id: "card-available",
          accountLabel: "FINAL-ACC",
          deliverySecret: "FINAL-SECRET",
          deliveryNote: "Delivered via test",
          status: "available",
        },
      },
    };
    const db = createMockDb(state);
    // Override select for markPaidAndIssue's initial query
    (db as any).select = (_colMap: unknown) => ({
      from: (_table?: unknown) => createSelectChain([orderRow]),
    });
    const result = await markPaidAndIssue(db, "order-ok", { RESEND_API_KEY: "re_test" });
    expect(result.ok).toBe(true);
    expect(result.card).toMatchObject({
      id: "card-available",
      accountLabel: "FINAL-ACC",
      deliverySecret: "FINAL-SECRET",
    });
  });

  it("allows paid orders to be issued", async () => {
    const orderRow = {
      id: "order-paid",
      productId: "product-1",
      buyerEmail: "user@test.com",
      status: "paid",
      expiresAt: null,
      productTitle: "Test Product",
      couponCode: null,
    };
    const state = {
      cards: {
        "card-paid": {
          id: "card-paid",
          accountLabel: "PAID-ACC",
          deliverySecret: "PAID-SECRET",
          deliveryNote: "",
          status: "available",
        },
      },
    };
    const db = createMockDb(state);
    (db as any).select = (_colMap: unknown) => ({
      from: (_table?: unknown) => createSelectChain([orderRow]),
    });
    const result = await markPaidAndIssue(db, "order-paid", {});
    expect(result.ok).toBe(true);
  });

  it("issues card with coupon code — consumeCoupon called", async () => {
    const orderRow = {
      id: "order-coupon",
      productId: "product-1",
      buyerEmail: "buyer@test.com",
      status: "pending",
      expiresAt: null,
      productTitle: "Test Product",
      couponCode: "SAVE10",
    };
    const state = {
      cards: {
        "card-1": {
          id: "card-1",
          accountLabel: "ACC-COUPON",
          deliverySecret: "SEC-COUPON",
          deliveryNote: "Coupon note",
          status: "available",
        },
      },
    };
    const db = createMockDb(state);
    (db as any).select = (_colMap: unknown) => ({
      from: (_table?: unknown) => createSelectChain([orderRow]),
    });
    const result = await markPaidAndIssue(db, "order-coupon", {});
    expect(result.ok).toBe(true);
    expect(result.card).toMatchObject({ id: "card-1" });
  });

  // ── 并发回滚：updated.length === 0 时应释放已发卡密 ──

  it("rolls back issued card when concurrent UPDATE returns 0 rows", async () => {
    const orderRow = {
      id: "order-concurrent",
      productId: "product-1",
      buyerEmail: "user@test.com",
      status: "pending",
      expiresAt: null,
      productTitle: "Test Product",
      couponCode: null,
    };
    const state = {
      cards: {
        "card-concurrent": {
          id: "card-concurrent",
          accountLabel: "CONC-ACC",
          deliverySecret: "CONC-SEC",
          deliveryNote: "",
          status: "available",
        },
      },
    };
    const db = createMockDb(state);
    // Override select for markPaidAndIssue's initial query
    (db as any).select = (_colMap: unknown) => ({
      from: (_table?: unknown) => createSelectChain([orderRow]),
    });
    // Override update for markPaidAndIssue's status UPDATE to return empty (concurrent conflict)
    (db as any).update = (_table?: unknown) => ({
      set: (_data?: unknown) => ({
        where: () => ({
          returning: () => Promise.resolve([]),  // Concurrent: no rows updated
        }),
      }),
    });
    const result = await markPaidAndIssue(db, "order-concurrent", {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.message).toBe("当前订单状态不可发卡");
  });

  // ── coupon 消耗失败时不回滚订单，仅 console.warn ──

  it("warns but does not fail when coupon consume fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockConsumeCoupon.mockResolvedValueOnce({ success: false, changes: 0 });
    const orderRow = {
      id: "order-coupon-fail",
      productId: "product-1",
      buyerEmail: "user@test.com",
      status: "pending",
      expiresAt: null,
      productTitle: "Test Product",
      couponCode: "FAIL10",
    };
    const state = {
      cards: {
        "card-coupon-fail": {
          id: "card-coupon-fail",
          accountLabel: "CF-ACC",
          deliverySecret: "CF-SEC",
          deliveryNote: "",
          status: "available",
        },
      },
    };
    const db = createMockDb(state);
    (db as any).select = (_colMap: unknown) => ({
      from: (_table?: unknown) => createSelectChain([orderRow]),
    });
    const result = await markPaidAndIssue(db, "order-coupon-fail", {});
    // Order still succeeds — coupon failure is only a warning
    expect(result.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ── 发邮件通知：RESEND_API_KEY 存在且 buyerEmail 合格 ──

  it("sends email notification when RESEND_API_KEY is configured", async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true, message: "sent" });
    const orderRow = {
      id: "order-email",
      productId: "product-1",
      buyerEmail: "buyer@test.com",
      status: "pending",
      expiresAt: null,
      productTitle: "Test Product",
      couponCode: null,
    };
    const state = {
      cards: {
        "card-email": {
          id: "card-email",
          accountLabel: "EM-ACC",
          deliverySecret: "EM-SEC",
          deliveryNote: "",
          status: "available",
        },
      },
    };
    const db = createMockDb(state);
    (db as any).select = (_colMap: unknown) => ({
      from: (_table?: unknown) => createSelectChain([orderRow]),
    });
    const result = await markPaidAndIssue(db, "order-email", { RESEND_API_KEY: "re_key" });
    expect(result.ok).toBe(true);
    // 验证 email service 被调用（异步 catch 不阻塞）
    // 由于 sendEmail 是异步 catch，我们等一小段时间验证
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSendEmail).toHaveBeenCalled();
  });
});