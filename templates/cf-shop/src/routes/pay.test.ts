import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbType } from "../db/client";

// ---------------------------------------------------------------------------
// Mock issue-service（createOfflineOrder 依赖的锁卡/释放函数）
// ---------------------------------------------------------------------------

const issueServiceMocks = {
  lockCardForOrder: vi.fn(),
  releaseLockedCardByOrder: vi.fn(),
};

vi.mock("../services/issue-service", () => ({
  lockCardForOrder: (...args: unknown[]) => issueServiceMocks.lockCardForOrder(...args),
  releaseLockedCardByOrder: (...args: unknown[]) => issueServiceMocks.releaseLockedCardByOrder(...args),
}));

// Mock audit-service
vi.mock("../services/audit-service", () => ({
  writeOrderEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock token module
vi.mock("../lib/token", () => ({
  createOrderToken: () => "mock-order-token",
  hashOrderToken: () => Promise.resolve("mock-token-hash"),
  createOrderNo: () => "ORD-MOCK-001",
}));

import {
  createPayOrderNo,
  createOfflineNoteCode,
  createOrderRecord,
  createOfflineOrder,
  VALID_ISSUE_MODES,
} from "./pay";

// ---------------------------------------------------------------------------
// 工具函数：createPayOrderNo / createOfflineNoteCode / VALID_ISSUE_MODES
// ---------------------------------------------------------------------------

describe("createPayOrderNo", () => {
  it("以 P 前缀开头", () => {
    const no = createPayOrderNo();
    expect(no.startsWith("P")).toBe(true);
  });

  it("长度至少 10（P + 时间戳 + 随机后缀）", () => {
    const no = createPayOrderNo();
    expect(no.length).toBeGreaterThanOrEqual(10);
  });

  it("每次调用生成不同的订单号", () => {
    const nos = new Set(Array.from({ length: 20 }, () => createPayOrderNo()));
    expect(nos.size).toBeGreaterThanOrEqual(19);
  });

  it("只包含大写字母和数字", () => {
    for (let i = 0; i < 10; i++) {
      const no = createPayOrderNo();
      expect(no).toMatch(/^[A-Z0-9]+$/);
    }
  });
});

describe("createOfflineNoteCode", () => {
  it("返回 6 位纯数字字符串", () => {
    const code = createOfflineNoteCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("范围在 100000~999999 之间", () => {
    for (let i = 0; i < 50; i++) {
      const code = createOfflineNoteCode();
      const num = Number(code);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThanOrEqual(999999);
    }
  });

  it("多次调用产生不同的备注码（高概率）", () => {
    const codes = new Set(Array.from({ length: 20 }, () => createOfflineNoteCode()));
    expect(codes.size).toBeGreaterThanOrEqual(18);
  });
});

describe("VALID_ISSUE_MODES", () => {
  it("包含 direct 和 manual", () => {
    expect(VALID_ISSUE_MODES).toContain("direct");
    expect(VALID_ISSUE_MODES).toContain("manual");
  });

  it("只有两个枚举值", () => {
    expect(VALID_ISSUE_MODES).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// createOrderRecord — 向 orders 表插入一条记录
// ---------------------------------------------------------------------------

describe("createOrderRecord", () => {
  let insertedData: Record<string, unknown> | null;

  function createMockDb() {
    insertedData = null;
    return {
      insert: (_table?: unknown) => ({
        values: (data: Record<string, unknown>) => {
          insertedData = data;
          return { onConflictDoNothing: () => Promise.resolve([]) };
        },
      }),
    } as unknown as DbType;
  }

  it("插入的数据包含所有必要字段", async () => {
    const db = createMockDb();
    await createOrderRecord(
      db, "order-1", "PTEST001", "prod-1",
      "备注码001", "buyer@test.com", 1000, 200,
      "CNY", "online", "direct", "camp1", "ref1",
      "coupon1", "iphash", "ua", "tokhash",
      new Date(Date.now() + 1800000).toISOString(),
    );
    expect(insertedData).not.toBeNull();
    expect(insertedData!.id).toBe("order-1");
    expect(insertedData!.orderNo).toBe("PTEST001");
    expect(insertedData!.productId).toBe("prod-1");
    expect(insertedData!.buyerEmail).toBe("buyer@test.com");
    expect(insertedData!.amountCents).toBe(1000);
    expect(insertedData!.discountCents).toBe(200);
    expect(insertedData!.currency).toBe("CNY");
    expect(insertedData!.status).toBe("pending");
    expect(insertedData!.paymentMethod).toBe("online");
    expect(insertedData!.issueMode).toBe("direct");
    expect(insertedData!.campaignCode).toBe("camp1");
    expect(insertedData!.referralCode).toBe("ref1");
    expect(insertedData!.couponCode).toBe("coupon1");
  });

  it("空字符串的 campaignCode/referralCode/ipHash 存为空字符串", async () => {
    const db = createMockDb();
    await createOrderRecord(
      db, "order-2", "PTEST002", "prod-1",
      "备注码002", "b@t.com", 500, 0,
      "CNY", "offline", "manual", undefined, undefined, "",
      undefined, "ua", "tokhash",
      new Date(Date.now() + 1800000).toISOString(),
    );
    expect(insertedData!.campaignCode).toBe("");
    expect(insertedData!.referralCode).toBe("");
    expect(insertedData!.ipHash).toBe("");
  });

  it("payableCents 正确映射到 amountCents", async () => {
    const db = createMockDb();
    await createOrderRecord(
      db, "order-3", "PTEST003", "prod-1",
      "code3", "b@t.com", 800, 200,
      "CNY", "offline", "manual", "", "", "",
      "", "ua", "tokhash",
      new Date(Date.now() + 1800000).toISOString(),
    );
    expect(insertedData!.amountCents).toBe(800);
    expect(insertedData!.discountCents).toBe(200);
  });

  it("paymentMethod 支持 online 和 offline", async () => {
    // online
    const db1 = createMockDb();
    await createOrderRecord(
      db1, "o1", "P1", "p1", "c1", "b@t.com", 1000, 0,
      "CNY", "online", "direct", "", "", "", "", "ua", "th",
      new Date(Date.now() + 1800000).toISOString(),
    );
    expect(insertedData!.paymentMethod).toBe("online");

    // offline
    const db2 = createMockDb();
    await createOrderRecord(
      db2, "o2", "P2", "p1", "c2", "b@t.com", 1000, 0,
      "CNY", "offline", "manual", "", "", "", "", "ua", "th",
      new Date(Date.now() + 1800000).toISOString(),
    );
    expect(insertedData!.paymentMethod).toBe("offline");
  });
});

// ---------------------------------------------------------------------------
// createOfflineOrder — 线下支付订单创建（含卡密锁定/释放/回滚）
// ---------------------------------------------------------------------------

describe("createOfflineOrder", () => {
  let insertedData: Record<string, unknown> | null;

  function createMockDb() {
    insertedData = null;
    return {
      insert: (_table?: unknown) => ({
        values: (data: Record<string, unknown>) => {
          insertedData = data;
          return { onConflictDoNothing: () => Promise.resolve([]) };
        },
      }),
      update: (_table?: unknown) => ({
        set: (_data?: unknown) => ({
          where: () => Promise.resolve({ rowsAffected: 1 }),
        }),
      }),
      select: (_cols?: unknown) => ({
        from: (_table?: unknown) => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
      run: () => Promise.resolve({ rows: [] }),
    } as unknown as DbType;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    insertedData = null;
  });

  it("库存不足时抛出异常", async () => {
    issueServiceMocks.lockCardForOrder.mockResolvedValueOnce(null);
    const db = createMockDb();
    const product = { id: "prod-1", currency: "CNY", title: "Test Product", priceCents: 1000 };
    await expect(
      createOfflineOrder(db, product, "b@t.com", 1000, 0, "manual", undefined, undefined, "", undefined, "ua")
    ).rejects.toThrow("当前商品库存不足");
  });

  it("锁卡成功后插入订单记录", async () => {
    issueServiceMocks.lockCardForOrder.mockResolvedValueOnce({ id: "card-1" });
    issueServiceMocks.releaseLockedCardByOrder.mockResolvedValueOnce(undefined);
    const db = createMockDb();
    const product = { id: "prod-1", currency: "CNY", title: "Test Product", priceCents: 1000 };
    const result = await createOfflineOrder(
      db, product, "b@t.com", 1000, 200, "manual", "camp1", "ref1", "SAVE10", "iphash", "ua"
    );
    expect(result.orderId).toBeTruthy();
    expect(result.orderNo).toBeTruthy();
    expect(result.orderToken).toBe("mock-order-token");
    expect(result.offlineNoteCode).toMatch(/^\d{6}$/);
    expect(insertedData).not.toBeNull();
    expect(insertedData!.amountCents).toBe(1000);
    expect(insertedData!.discountCents).toBe(200);
    expect(insertedData!.paymentMethod).toBe("offline");
    expect(insertedData!.couponCode).toBe("SAVE10");
  });

  it("订单插入失败时释放已锁定的卡密", async () => {
    issueServiceMocks.lockCardForOrder.mockResolvedValueOnce({ id: "card-1" });
    issueServiceMocks.releaseLockedCardByOrder.mockResolvedValueOnce(undefined);
    // 让 insert 失败
    const db = {
      insert: () => ({ values: () => { throw new Error("DB error"); } }),
      update: () => ({ set: () => ({ where: () => Promise.resolve({ rowsAffected: 1 }) }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      run: () => Promise.resolve({ rows: [] }),
    } as unknown as DbType;
    const product = { id: "prod-1", currency: "CNY", title: "Test Product", priceCents: 1000 };
    await expect(
      createOfflineOrder(db, product, "b@t.com", 1000, 0, "manual", undefined, undefined, "", undefined, "ua")
    ).rejects.toThrow("订单创建失败，请稍后重试");
    // 验证释放了卡密
    expect(issueServiceMocks.releaseLockedCardByOrder).toHaveBeenCalled();
  });

  it("锁卡参数传递正确（orderId, productId, expiresAt）", async () => {
    issueServiceMocks.lockCardForOrder.mockResolvedValueOnce({ id: "card-1" });
    issueServiceMocks.releaseLockedCardByOrder.mockResolvedValueOnce(undefined);
    const db = createMockDb();
    const product = { id: "prod-1", currency: "CNY", title: "Test Product", priceCents: 1000 };
    await createOfflineOrder(db, product, "b@t.com", 500, 0, "direct", "", "", "", "", "ua");
    expect(issueServiceMocks.lockCardForOrder).toHaveBeenCalledTimes(1);
    const lockCall = issueServiceMocks.lockCardForOrder.mock.calls[0];
    // lockCardForOrder(db, orderId, productId, expiresAt)
    expect(lockCall[2]).toBe("prod-1"); // productId
    expect(lockCall[3]).toBeTruthy();   // expiresAt
  });
});