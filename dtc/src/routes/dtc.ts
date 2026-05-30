/**
 * DTC 故障码查询 — API 路由
 *
 * 提供 RESTful 接口：
 *   GET  /{code}                           — 单码查询
 *   GET  /search                           — 关键词搜索
 *   POST /batch                            — 批量查询
 *   GET  /stats                            — 统计信息
 *   GET  /by-manufacturer/{manufacturer}   — 按制造商查询
 *   POST /extract                          — 从文本提取 DTC
 *   GET  /normalize/{code}                 — 归一化
 */

import { Hono } from "hono";
import type { AppEnv } from "../bindings";
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

const dtc = new Hono<AppEnv>();

/**
 * GET /{code}
 * 查询单个 DTC 码。支持 ?manufacturer= 参数过滤制造商。
 */
dtc.get("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const manufacturer = c.req.query("manufacturer") || "GENERIC";
  const db = c.get("db");

  const result = await lookup(db, code, manufacturer);
  if (!result) {
    return fail(c, `DTC 码 ${code} 未找到`, 404);
  }

  return ok(c, { dtc: result });
});

/**
 * GET /search
 * 关键词搜索。支持 ?manufacturer=、?system=、?limit=、?offset= 过滤。
 */
dtc.get("/search", async (c) => {
  const q = c.req.query("q") || "";
  if (q.length < 2) {
    return fail(c, "关键词至少 2 个字符", 400);
  }

  const db = c.get("db");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  const result = await search(db, q, {
    manufacturer: c.req.query("manufacturer"),
    system: c.req.query("system"),
    limit,
    offset,
  });

  return ok(c, {
    results: result.results,
    total: result.total,
    limit,
    offset,
  });
});

/**
 * POST /batch
 * 批量查询（最多 500 个码）。
 */
dtc.post("/batch", async (c) => {
  const body = await c.req.json<{ codes: string[]; manufacturer?: string }>().catch(() => null);
  if (!body || !Array.isArray(body.codes) || body.codes.length === 0) {
    return fail(c, "请提供待查询的 DTC 码列表", 400);
  }
  if (body.codes.length > 500) {
    return fail(c, "批量查询最多 500 个码", 400);
  }

  const db = c.get("db");
  const manufacturer = body.manufacturer || "GENERIC";

  const resultMap = await batchLookup(db, body.codes, manufacturer);
  const results = body.codes
    .map((code) => {
      const norm = normalizeCode(code);
      return resultMap.get(norm.normalized) || null;
    })
    .filter(Boolean);

  return ok(c, {
    results,
    total: body.codes.length,
    found: results.length,
  });
});

/**
 * GET /stats
 * 返回数据统计：总数、制造商数、按系统/制造商分布。
 */
dtc.get("/stats", async (c) => {
  const db = c.get("db");
  const stats = await getStats(db);
  return ok(c, { stats });
});

/**
 * GET /by-manufacturer/{manufacturer}
 * 按制造商查询 DTC 码列表（分页）。
 */
dtc.get("/by-manufacturer/:manufacturer", async (c) => {
  const mfr = c.req.param("manufacturer");
  const db = c.get("db");
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

/**
 * POST /extract
 * 从文本中提取 DTC 码。
 */
dtc.post("/extract", async (c) => {
  const body = await c.req.json<{ text: string }>().catch(() => null);
  if (!body || !body.text) {
    return fail(c, "请提供待提取的文本", 400);
  }

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

/**
 * GET /normalize/{code}
 * 归一化 DTC 码，返回结构化信息。
 */
dtc.get("/normalize/:code", async (c) => {
  const code = c.req.param("code");
  const result = normalizeCode(code);
  return ok(c, { normalized: result });
});

export { dtc };