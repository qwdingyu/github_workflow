/**
 * DTC 故障码查询服务 — 核心业务逻辑
 *
 * 所有数据库操作通过 Drizzle ORM 完成，不写原生 SQL。
 * 使用本地 drizzle-orm 类型，通过转型接收 cf-core 的 Db 实例。
 */

import { eq, sql, and, count as drizzleCount, inArray } from "drizzle-orm";
import { dtcCodes, manufacturers } from "../db/schema";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type * as schema from "../db/schema";
import { config } from "../config";

/** 数据库实例类型 — 使用本地 drizzle-orm 定义（与 cf-core 的 DrizzleInstance 结构一致） */
export type Db = LibSQLDatabase<typeof schema>;

// ── 类型定义 ──

/** DTC 查询结果（对外输出格式） */
export interface DtcResult {
  code: string;
  system: string;
  systemShort: string;
  description: string;
  descriptionZh: string;
  manufacturer: string;
  isGeneric: boolean;
  cause: string;
  remedy: string;
  severity: string;
  relatedCodes: string[];
}

/** 制造商信息（对外输出格式） */
export interface ManufacturerInfo {
  id: string;
  displayName: string;
  fullName: string;
  country: string;
  codeCount: number;
}

/** 统计信息 */
export interface StatsResult {
  totalCodes: number;
  manufacturers: number;
  bySystem: Record<string, number>;
  byManufacturer: Record<string, number>;
}

/** 代码归一化结果 */
export interface NormalizedCode {
  original: string;
  normalized: string;
  systemShort: string;
  system: string;
  isValid: boolean;
  isStandard: boolean;
}

// ── 系统类型映射 ──

const SYSTEM_MAP: Record<string, string> = {
  P: "Powertrain",
  B: "Body",
  C: "Chassis",
  U: "Network",
};

// ── 内部辅助函数 ──

/** 将数据库记录转为对外输出格式 */
function toDtcResult(record: typeof dtcCodes.$inferSelect): DtcResult {
  let related: string[] = [];
  try {
    related = JSON.parse(record.relatedCodes || "[]");
  } catch {
    related = [];
  }

  return {
    code: record.code,
    system: record.system,
    systemShort: record.systemShort,
    description: record.description,
    descriptionZh: record.descriptionZh,
    manufacturer: record.manufacturer,
    isGeneric: record.isGeneric === 1,
    cause: record.cause,
    remedy: record.remedy,
    severity: record.severity,
    relatedCodes: related,
  };
}

// ── 归一化函数 ──

/**
 * 归一化 DTC 代码。
 * 标准化 DTC 格式为 PXXXX（5 字符大写），校验代码是否有效。
 */
export function normalizeCode(input: string): NormalizedCode {
  const raw = input.trim().toUpperCase();

  const standardPattern = /^([PBCU])(\d)([0-9A-F]{3})$/;
  const extendedPattern = /^([PBCU])([0-9A-F]{4})$/;

  let match = standardPattern.exec(raw);

  if (match) {
    const systemShort = match[1];
    return {
      original: input,
      normalized: raw,
      systemShort,
      system: SYSTEM_MAP[systemShort] || "Unknown",
      isValid: true,
      isStandard: match[2] >= "0" && match[2] <= "3",
    };
  }

  match = extendedPattern.exec(raw);
  if (match) {
    const systemShort = match[1];
    return {
      original: input,
      normalized: raw,
      systemShort,
      system: SYSTEM_MAP[systemShort] || "Unknown",
      isValid: true,
      isStandard: false,
    };
  }

  return {
    original: input,
    normalized: raw,
    systemShort: "",
    system: "",
    isValid: false,
    isStandard: false,
  };
}

// ── 单码查询 ──

/**
 * 查询单个 DTC 码的详细信息。
 * 优先查制造商特定码，未命中则 fallback 到 GENERIC。
 */
export async function lookup(
  db: Db,
  code: string,
  manufacturer: string = "GENERIC",
): Promise<DtcResult | null> {
  const normalized = normalizeCode(code);
  if (!normalized.isValid) return null;

  const targetCode = normalized.normalized;
  const targetMfr = manufacturer.toUpperCase().trim();

  let record = await db
    .select()
    .from(dtcCodes)
    .where(and(eq(dtcCodes.code, targetCode), eq(dtcCodes.manufacturer, targetMfr)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!record && targetMfr !== "GENERIC") {
    record = await db
      .select()
      .from(dtcCodes)
      .where(and(eq(dtcCodes.code, targetCode), eq(dtcCodes.manufacturer, "GENERIC")))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  if (!record) return null;
  return toDtcResult(record);
}

// ── 关键词搜索 ──

/**
 * 搜索 DTC 码。支持 code 前缀匹配、description 模糊匹配、manufacturer/system 过滤。
 */
export async function search(
  db: Db,
  keyword: string,
  options?: {
    manufacturer?: string;
    system?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ results: DtcResult[]; total: number }> {
  const kw = keyword.trim();
  if (kw.length < config.minSearchLength) {
    return { results: [], total: 0 };
  }

  const limit = Math.min(options?.limit ?? config.defaultLimit, config.maxLimit);
  const offset = options?.offset ?? 0;

  const q = kw.toUpperCase();
  const isCode = /^[PBCU][0-9A-F]{0,4}$/i.test(kw);

  const searchCondition = isCode
    ? sql`(${dtcCodes.code} LIKE ${q + "%"} OR ${dtcCodes.description} LIKE ${"%" + kw + "%"})`
    : sql`(${dtcCodes.description} LIKE ${"%" + kw + "%"} OR ${dtcCodes.manufacturer} LIKE ${q + "%"})`;

  const filters: ReturnType<typeof eq>[] = [];
  if (options?.manufacturer) {
    filters.push(eq(dtcCodes.manufacturer, options.manufacturer.toUpperCase()));
  }
  if (options?.system) {
    filters.push(eq(dtcCodes.systemShort, options.system.toUpperCase()));
  }

  const finalWhere = filters.length > 0 ? and(searchCondition, ...filters) : searchCondition;

  const countResult = await db
    .select({ count: drizzleCount() })
    .from(dtcCodes)
    .where(finalWhere)
    .then((rows) => rows[0]?.count ?? 0);

  const records = await db
    .select()
    .from(dtcCodes)
    .where(finalWhere)
    .orderBy(dtcCodes.code)
    .limit(limit)
    .offset(offset);

  return {
    results: records.map(toDtcResult),
    total: countResult,
  };
}

// ── 批量查询 ──

/**
 * 批量查询多个 DTC 码（最多 500 个）。
 * 返回 map[code] → DtcResult。
 */
export async function batchLookup(
  db: Db,
  codes: string[],
  manufacturer: string = "GENERIC",
): Promise<Map<string, DtcResult>> {
  const uniqueCodes: string[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    const norm = normalizeCode(c).normalized;
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      uniqueCodes.push(norm);
    }
  }

  if (uniqueCodes.length === 0 || uniqueCodes.length > config.maxBatchSize) {
    return new Map();
  }

  const targetMfr = manufacturer.toUpperCase().trim();

  const records = await db
    .select()
    .from(dtcCodes)
    .where(and(inArray(dtcCodes.code, uniqueCodes), eq(dtcCodes.manufacturer, targetMfr)));

  const foundCodes = new Set(records.map((r) => r.code));

  const missingCodes = uniqueCodes.filter((c) => !foundCodes.has(c));
  if (missingCodes.length > 0 && targetMfr !== "GENERIC") {
    const genericRecords = await db
      .select()
      .from(dtcCodes)
      .where(and(inArray(dtcCodes.code, missingCodes), eq(dtcCodes.manufacturer, "GENERIC")));

    records.push(...genericRecords);
  }

  const map = new Map<string, DtcResult>();
  for (const r of records) {
    if (!map.has(r.code) || r.manufacturer !== "GENERIC") {
      map.set(r.code, toDtcResult(r));
    }
  }
  return map;
}

// ── 按制造商查询 ──

export async function lookupByManufacturer(
  db: Db,
  mfr: string,
  options?: { limit?: number; offset?: number },
): Promise<{ results: DtcResult[]; total: number }> {
  const targetMfr = mfr.toUpperCase().trim();
  const limit = Math.min(options?.limit ?? config.defaultLimit, config.maxLimit);
  const offset = options?.offset ?? 0;

  const countResult = await db
    .select({ count: drizzleCount() })
    .from(dtcCodes)
    .where(eq(dtcCodes.manufacturer, targetMfr))
    .then((rows) => rows[0]?.count ?? 0);

  const records = await db
    .select()
    .from(dtcCodes)
    .where(eq(dtcCodes.manufacturer, targetMfr))
    .orderBy(dtcCodes.code)
    .limit(limit)
    .offset(offset);

  return {
    results: records.map(toDtcResult),
    total: countResult,
  };
}

// ── 统计分析 ──

export async function getStats(db: Db): Promise<StatsResult> {
  const totalCodes = await db
    .select({ count: drizzleCount() })
    .from(dtcCodes)
    .then((rows) => rows[0]?.count ?? 0);

  const mfrCount = await db
    .select({ count: drizzleCount() })
    .from(manufacturers)
    .then((rows) => rows[0]?.count ?? 0);

  const bySystemRows = await db
    .select({ systemShort: dtcCodes.systemShort, count: drizzleCount() })
    .from(dtcCodes)
    .groupBy(dtcCodes.systemShort);

  const bySystem: Record<string, number> = {};
  for (const r of bySystemRows) {
    bySystem[r.systemShort] = r.count;
  }

  const byMfrRows = await db
    .select({ manufacturer: dtcCodes.manufacturer, count: drizzleCount() })
    .from(dtcCodes)
    .groupBy(dtcCodes.manufacturer)
    .orderBy(sql`count(${dtcCodes.id}) desc`)
    .limit(15);

  const byManufacturer: Record<string, number> = {};
  for (const r of byMfrRows) {
    byManufacturer[r.manufacturer] = r.count;
  }

  return {
    totalCodes,
    manufacturers: mfrCount,
    bySystem,
    byManufacturer,
  };
}

// ── 制造商列表 ──

export async function listManufacturers(db: Db): Promise<ManufacturerInfo[]> {
  const records = await db
    .select()
    .from(manufacturers)
    .orderBy(sql`code_count desc`);

  return records.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    fullName: r.fullName,
    country: r.country,
    codeCount: r.codeCount,
  }));
}

// ── 从文本提取 DTC ──

export function extractFromText(text: string): NormalizedCode[] {
  const pattern = /[PBCU][0-9][0-9A-F]{3}/gi;
  const matches = text.match(pattern);
  if (!matches) return [];

  const seen = new Set<string>();
  const results: NormalizedCode[] = [];

  for (const raw of matches) {
    const normalized = normalizeCode(raw);
    const code = normalized.normalized;
    if (!seen.has(code)) {
      seen.add(code);
      results.push(normalized);
    }
  }

  return results;
}