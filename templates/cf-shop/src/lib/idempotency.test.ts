import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkIdempotency, getIdempotentResponse, saveIdempotentResponse } from "./idempotency";

// ---------------------------------------------------------------------------
// 幂等键模块单元测试 — ORM 版本
// ---------------------------------------------------------------------------
// idempotency 的函数签名是 (db: DbType, key, action, ...)
// DbType 即 Drizzle ORM 实例。测试直接传入 ORM mock 对象即可。

const state: {
  rows: Array<{ responseJson: string }>;
  inserted: Array<Record<string, unknown>>;
  /** 模拟 UPSERT 冲突行为：true = 首次插入，false = 冲突（已存在） */
  isFirstInsert: boolean;
  /** 已存在的缓存响应（冲突时返回） */
  existingResponseJson: string;
} = {
  rows: [],
  inserted: [],
  isFirstInsert: true,
  existingResponseJson: "",
};

function createMockDb() {
  return {
    select: (_colMap?: unknown) => ({
      from: (_table?: unknown) => ({
        where: () => ({
          limit: () => Promise.resolve(state.rows),
        }),
      }),
    }),
    insert: (_table?: unknown) => ({
      values: (data: Record<string, unknown>) => {
        state.inserted.push(data);
        return {
          onConflictDoUpdate: (_cfg?: unknown) => {
            // 模拟 INSERT ... ON CONFLICT UPDATE ... RETURNING 行为：
             // - 首次插入：返回 responseJson = "__pending__"（非空哨兵）
             // - 冲突时：返回已有的 responseJson
             const result = state.isFirstInsert
               ? [{ responseJson: "__pending__" }]
               : [{ responseJson: state.existingResponseJson }];
            // 支持 .returning() 链式调用和直接 await 两种模式
            const thenable = {
              returning: () => Promise.resolve(result),
              then: (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve),
            };
            return thenable;
          },
        };
      },
    }),
    update: (_table?: unknown) => ({
      set: (data: Record<string, unknown>) => {
        state.inserted.push(data);
        return {
          where: () => Promise.resolve({ rowsAffected: 1 }),
        };
      },
    }),
    delete: (_table?: unknown) => ({
      where: () => Promise.resolve({ rowsAffected: 0 }),
    }),
    run: () => Promise.resolve({ rows: [] }),
  };
}

function setRows(rows: Array<{ responseJson: string }>) {
  state.rows = rows;
}

function clearInserted() {
  state.inserted.length = 0;
}

function resetState() {
  state.rows = [];
  state.inserted = [];
  state.isFirstInsert = true;
  state.existingResponseJson = "";
}

// ---------------------------------------------------------------------------
// checkIdempotency — 原子 UPSERT 版本
// ---------------------------------------------------------------------------

describe("checkIdempotency", () => {
  beforeEach(() => {
    resetState();
  });

  it("首次插入返回 shouldProceed=true，cachedResponse=null", async () => {
    state.isFirstInsert = true;
    const db = createMockDb();
    const result = await checkIdempotency(db as any, "key-new", "create_order");
    expect(result.shouldProceed).toBe(true);
    expect(result.cachedResponse).toBeNull();
  });

  it("冲突时返回 shouldProceed=false，cachedResponse 为已缓存响应", async () => {
    state.isFirstInsert = false;
    const cachedResponse = JSON.stringify({ ok: true, orderId: "order-123" });
    state.existingResponseJson = cachedResponse;
    const db = createMockDb();
    const result = await checkIdempotency(db as any, "key-existing", "create_order");
    expect(result.shouldProceed).toBe(false);
    expect(result.cachedResponse).toBe(cachedResponse);
  });

  it("冲突时空字符串视为已缓存响应（非哨兵值）", async () => {
    // 极端场景：冲突且 responseJson 为空字符串
    // 空字符串不是哨兵 "__pending__"，因此视为已缓存响应
    state.isFirstInsert = false;
    state.existingResponseJson = "";
    const db = createMockDb();
    const result = await checkIdempotency(db as any, "key-edge", "create_order");
    expect(result.shouldProceed).toBe(false);
    expect(result.cachedResponse).toBe("");
  });

  it("冲突时非空 JSON 响应正确返回", async () => {
    state.isFirstInsert = false;
    state.existingResponseJson = '{"ok":true,"order":{"id":"ord-456"}}';
    const db = createMockDb();
    const result = await checkIdempotency(db as any, "key-json", "pay_unified");
    expect(result.shouldProceed).toBe(false);
    expect(result.cachedResponse).toBe('{"ok":true,"order":{"id":"ord-456"}}');
  });

  it("不同 action 的幂等键互不影响", async () => {
    // create_order 的 key
    state.isFirstInsert = true;
    const db1 = createMockDb();
    const r1 = await checkIdempotency(db1 as any, "same-key", "create_order");
    expect(r1.shouldProceed).toBe(true);

    // pay_unified 的同一个 key（不同 action）
    state.isFirstInsert = true;
    const db2 = createMockDb();
    const r2 = await checkIdempotency(db2 as any, "same-key", "pay_unified");
    expect(r2.shouldProceed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getIdempotentResponse — 旧版非原子查询
// ---------------------------------------------------------------------------

describe("getIdempotentResponse", () => {
  beforeEach(() => {
    setRows([]);
    clearInserted();
  });

  it("返回 null 当 key 不存在（空结果集）", async () => {
    setRows([]);
    const db = createMockDb();
    const result = await getIdempotentResponse(db as any, "key-1", "create_order");
    expect(result).toBeNull();
  });

  it("返回缓存响应当 key 存在", async () => {
    const cachedResponse = { ok: true, orderId: "order-123" };
    setRows([{ responseJson: JSON.stringify(cachedResponse) }]);
    const db = createMockDb();
    const result = await getIdempotentResponse(db as any, "key-1", "create_order");
    expect(result).not.toBeNull();
    expect(result!.responseJson).toBe(JSON.stringify(cachedResponse));
  });

  it("返回第一个匹配的行", async () => {
    setRows([
      { responseJson: '{"first":true}' },
      { responseJson: '{"second":true}' },
    ]);
    const db = createMockDb();
    const result = await getIdempotentResponse(db as any, "key-1", "create_order");
    expect(result).not.toBeNull();
    expect(result!.responseJson).toBe('{"first":true}');
  });
});

// ---------------------------------------------------------------------------
// saveIdempotentResponse
// ---------------------------------------------------------------------------
// saveIdempotentResponse 使用 db.insert().values().onConflictDoUpdate()

describe("saveIdempotentResponse", () => {
  beforeEach(() => {
    setRows([]);
    clearInserted();
  });

  it("通过 ORM insert 保存响应", async () => {
    clearInserted();
    const db = createMockDb();
    const response = { ok: true, order: { id: "order-new" } };
    await saveIdempotentResponse(db as any, "key-new", "create_order", "order-new", response);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toHaveProperty("resourceId", "order-new");
    expect(state.inserted[0]).toHaveProperty("responseJson", JSON.stringify(response));
  });

  it("通过 ORM insert 更新已有 key", async () => {
    clearInserted();
    const db = createMockDb();
    const response = { ok: true, updated: true };
    await saveIdempotentResponse(db as any, "key-existing", "create_order", "order-updated", response);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toHaveProperty("resourceId", "order-updated");
    expect(state.inserted[0]).toHaveProperty("responseJson", JSON.stringify(response));
  });

  it("序列化响应为 JSON 字符串", async () => {
    clearInserted();
    const db = createMockDb();
    const response = { ok: true, nested: { a: 1, b: [2, 3] } };
    await saveIdempotentResponse(db as any, "key-json", "pay_order", "order-1", response);
    expect(state.inserted[0].responseJson).toBe('{"ok":true,"nested":{"a":1,"b":[2,3]}}');
  });
});
