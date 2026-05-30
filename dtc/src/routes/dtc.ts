/**
 * DTC 故障码查询 — API 路由
 *
 * 提供 RESTful 接口：
 *   GET  /{code}                          — 单码查询
 *   GET  /search                          — 关键词搜索
 *   POST /batch                           — 批量查询
 *   GET  /stats                           — 统计信息
 *   GET  /by-manufacturer/{manufacturer}  — 按制造商查询
 *   POST /extract                         — 从文本提取 DTC
 *   GET  /normalize/{code}                — 归一化
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../bindings";
import type { Db } from "../services/dtc-service";
import { ok, fail } from "@eforge/cf-core/http";
import {
  lookup,
  search,
  batchLookup,
  lookupByManufacturer,
  getStats,
  normalizeCode,
  extractFromText,
} from "../services/dtc-service";

/** 从 Hono Context 获取类型安全的 Db 实例 */
function getDb(c: Context<AppEnv>): Db {
  return c.get("db") as unknown as Db;
}

const dtc = new Hono<AppEnv>();

/** GET /{code} — 单码查询，支持 ?manufacturer= */
dtc.get("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const manufacturer = c.req.query("manufacturer") || "GENERIC";
  const db = getDb(c);

  const result = await lookup(db, code, manufacturer);
  if (!result) return fail(c, `DTC 码 ${code} 未找到`, 404);

  return ok(c, { dtc: result });
});

/** GET /search — 关键词搜索 */
dtc.get("/search", async (c) => {
  const q = c.req.query("q") || "";
  if (q.length < 2) return fail(c, "关键词至少 2 个字符", 400);

  const db = getDb(c);
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  const result = await search(db, q, {
    manufacturer: c.req.query("manufacturer"),
    system: c.req.query("system"),
    limit,
    offset,
  });

  return ok(c, { results: result.results, total: result.total, limit, offset });
});

/** POST /batch — 批量查询（最多 500 个码） */
dtc.post("/batch", async (c) => {
  const body = await c.req.json<{ codes: string[]; manufacturer?: string }>().catch(() => null);
  if (!body || !Array.isArray(body.codes) || body.codes.length === 0) {
    return fail(c, "请提供待查询的 DTC 码列表", 400);
  }
  if (body.codes.length > 500) return fail(c, "批量查询最多 500 个码", 400);

  const db = getDb(c);
  const manufacturer = body.manufacturer || "GENERIC";
  const resultMap = await batchLookup(db, body.codes, manufacturer);

  const results = body.codes
    .map((code) => {
      const norm = normalizeCode(code);
      return resultMap.get(norm.normalized) || null;
    })
    .filter(Boolean);

  return ok(c, { results, total: body.codes.length, found: results.length });
});

/** GET /stats — 统计信息 */
dtc.get("/stats", async (c) => {
  const db = getDb(c);
  const stats = await getStats(db);
  return ok(c, { stats });
});

/** GET /by-manufacturer/{manufacturer} — 按制造商查询 */
dtc.get("/by-manufacturer/:manufacturer", async (c) => {
  const mfr = c.req.param("manufacturer");
  const db = getDb(c);
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  const result = await lookupByManufacturer(db, mfr, { limit, offset });
  return ok(c, {
    results: result.results,
    total: result.total,
    manufacturer: mfr.toUpperCase(),
    limit,
    offset,
  });
});

/** POST /extract — 从文本提取 DTC */
dtc.post("/extract", async (c) => {
  const body = await c.req.json<{ text: string }>().catch(() => null);
  if (!body || !body.text) return fail(c, "请提供待提取的文本", 400);

  const codes = extractFromText(body.text);
  return ok(c, {
    codes: codes.map((n) => ({
      code: n.normalized,
      systemShort: n.systemShort,
      system: n.system,
      isStandard: n.isStandard,
    })),
    count: codes.length,
  });
});

/** GET /normalize/{code} — 归一化 */
dtc.get("/normalize/:code", async (c) => {
  const code = c.req.param("code");
  const result = normalizeCode(code);
  return ok(c, { normalized: result });
});

export { dtc };