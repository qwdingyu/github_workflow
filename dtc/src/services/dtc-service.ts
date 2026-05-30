/**
 * DTC 故障码查询服务 — 核心业务逻辑
 *
 * 所有数据库操作通过 Drizzle ORM 完成，不写原生 SQL。
 * 包含：单码查询、关键词搜索、批量查询、统计、归一化、从文本提取。
 */

import { eq, sql, and, count as drizzleCount, inArray } from "drizzle-orm";
import { dtcCodes, manufacturers } from "../db/schema";
import type { DbType } from "../db/database";
import { config } from "../config";

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
 * 示例：P0420 → { normalized: "P0420", systemShort: "P", isValid: true }
 *        p0420 → { normalized: "P0420" }（自动转大写）
 *        12345 → { normalized: "12345", isValid: false }
 */
export function normalizeCode(input: string): NormalizedCode {
  const raw = input.trim().toUpperCase();

  // 标准 DTC 格式：[P|B|C|U][0-9][0-9A-F]{3}（5 字符）
  const standardPattern = /^([PBCU])(\d)([0-9A-F]{3})$/;

  // 扩展格式：[P|B|C|U][0-9A-F]{4}（5 字符，宽松）
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
 * 按 code + manufacturer 精确匹配。
 * manufacturer 可选，默认为 "GENERIC"。
 * 优先查制造商特定码，未命中则 fallback 到 GENERIC。
 */
export async function lookup(
  db: DbType,
  code: string,
  manufacturer: string = "GENERIC",
): Promise<DtcResult | null> {
  const normalized = normalizeCode(code);
  if (!normalized.isValid) return null;

  const targetCode = normalized.normalized;
  const targetMfr = manufacturer.toUpperCase().trim();

  // 优先查询特定制造商
  let record = await db
    .select()
    .from(dtcCodes)
    .where(and(eq(dtcCodes.code, targetCode), eq(dtcCodes.manufacturer, targetMfr)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  // 未找到特定制造商码，fallback 到 GENERIC
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
 * 搜索 DTC 码。支持模糊匹配 code、description、manufacturer。
 * 按 code 前缀匹配优先，description 模糊匹配次之。
 * 可选按 manufacturer 或 system 过滤。
 */
export async function search(
  db: DbType,
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

  // 构建搜索条件：code 前缀匹配 OR description 模糊匹配 OR manufacturer 匹配
  const searchCondition = isCode
    ? sql`(${dtcCodes.code} LIKE ${q + "%"} OR ${dtcCodes.description} LIKE ${"%" + kw + "%"})`
    : sql`(${dtcCodes.description} LIKE ${"%" + kw + "%"} OR ${dtcCodes.manufacturer} LIKE ${q + "%"})`;

  // 额外过滤条件
  const filters: ReturnType<typeof eq>[] = [];
  if (options?.manufacturer) {
    filters.push(eq(dtcCodes.manufacturer, options.manufacturer.toUpperCase()));
  }
  if (options?.system) {
    filters.push(eq(dtcCodes.systemShort, options.system.toUpperCase()));
  }

  const finalWhere = filters.length > 0 ? and(searchCondition, ...filters) : searchCondition;

  // 查询总条数
  const countResult = await db
    .select({ count: drizzleCount() })
    .from(dtcCodes)
    .where(finalWhere)
    .then((rows) => rows[0]?.count ?? 0);

  // 分页查询
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
 * 批量查询多个 DTC 码。
 * 返回 map[code] → DtcResult，未找到的 code 不包含在结果中。
 * 最大支持 500 个码的批量查询。
 */
export async function batchLookup(
  db: DbType,
  codes: string[],
  manufacturer: string = "GENERIC",
): Promise<Map<string, DtcResult>> {
  // 去重 + 归一化
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

  // 查询该制造商下的码
  const records = await db
    .select()
    .from(dtcCodes)
    .where(and(inArray(dtcCodes.code, uniqueCodes), eq(dtcCodes.manufacturer, targetMfr)));

  const foundCodes = new Set(records.map((r) => r.code));

  // 对未在特定制造商下找到的码，查询 GENERIC
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
    // 优先保留制造商特定码，已有则跳过
    if (!map.has(r.code) || r.manufacturer !== "GENERIC") {
      map.set(r.code, toDtcResult(r));
    }
  }
  return map;
}

// ── 按制造商查询 ──

/**
 * 查询指定制造商的所有 DTC 码。支持分页。
 */
export async function lookupByManufacturer(
  db: DbType,
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

/**
 * 获取 DTC 数据集的统计信息：总数、制造商数、按系统类型分布、按制造商 Top15。
 */
export async function getStats(db: DbType): Promise<StatsResult> {
  const totalCodes = await db
    .select({ count: drizzleCount() })
    .from(dtcCodes)
    .then((rows) => rows[0]?.count ?? 0);

  const mfrCount = await db
    .select({ count: drizzleCount() })
    .from(manufacturers)
    .then((rows) => rows[0]?.count ?? 0);

  // 按系统类型统计（P/B/C/U）
  const bySystemRows = await db
    .select({ systemShort: dtcCodes.systemShort, count: drizzleCount() })
    .from(dtcCodes)
    .groupBy(dtcCodes.systemShort);

  const bySystem: Record<string, number> = {};
  for (const r of bySystemRows) {
    bySystem[r.systemShort] = r.count;
  }

  // 按制造商统计（Top 15）
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

/**
 * 获取所有制造商列表，按 code_count 降序排列。
 */
export async function listManufacturers(
  db: DbType,
): Promise<ManufacturerInfo[]> {
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

/**
 * 从文本中提取所有可能的 DTC 代码。
 * 使用正则匹配标准格式 [PBCU][0-9][0-9A-F]{3}，自动去重。
 */
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