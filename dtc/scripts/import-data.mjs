/**
 * DTC 故障码数据导入脚本
 *
 * 从 /Users/dingyuwang/0-X/bot/data/obd/normalized/ 读取归一化后的 DTC JSON 数据，
 * 通过 Drizzle ORM 自动建表并导入 Turso 数据库。
 *
 * 用法：
 *   TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=xxx node scripts/import-data.mjs
 *
 * 数据来源：
 *   主源：dtc_database_normalized.json（wal33d/dtc-database，18,805 条，含制造商信息）
 *   次源：dtcmapping_normalized.json（wzr1337/dtcmapping，22,473 条，通用码补充）
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { eq, sql } from "drizzle-orm";

// ── DTC 表结构（与 src/db/schema.ts 保持一致） ──

/**
 * 数据记录类型——对应 JSON 中的字段名
 */
interface DtcRawRecord {
  dtc: string;
  system: string;
  description: string;
  manufacturer?: string;
  type?: string;
  is_generic?: boolean;
  locale?: string;
  source?: string;
  category?: string;
}

// ── 配置 ──

const DTC_DB_PATH = "/Users/dingyuwang/0-X/bot/data/obd/normalized/dtc_database_normalized.json";
const DTCMAPPING_PATH = "/Users/dingyuwang/0-X/bot/data/obd/normalized/dtcmapping_normalized.json";
const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN;

// ── 制造商分组映射 ──
// 将具体品牌名归组到集团级别

const BRAND_GROUPS: Record<string, { group: string; display: string; country: string }> = {
  // 通用系
  "BUICK": { group: "GM", display: "Buick", country: "US" },
  "CADILLAC": { group: "GM", display: "Cadillac", country: "US" },
  "CHEVROLET": { group: "GM", display: "Chevrolet", country: "US" },
  "GM": { group: "GM", display: "General Motors", country: "US" },
  "GMC": { group: "GM", display: "GMC", country: "US" },
  "OLDSMOBILE": { group: "GM", display: "Oldsmobile", country: "US" },
  "SATURN": { group: "GM", display: "Saturn", country: "US" },
  // 福特系
  "FORD": { group: "FORD", display: "Ford", country: "US" },
  "LINCOLN": { group: "FORD", display: "Lincoln", country: "US" },
  "MERCURY": { group: "FORD", display: "Mercury", country: "US" },
  // 丰田
  "TOYOTA": { group: "TOYOTA", display: "Toyota", country: "JP" },
  "LEXUS": { group: "TOYOTA", display: "Lexus", country: "JP" },
  // 本田
  "HONDA": { group: "HONDA", display: "Honda", country: "JP" },
  "ACURA": { group: "HONDA", display: "Acura", country: "JP" },
  // 日产
  "NISSAN": { group: "NISSAN", display: "Nissan", country: "JP" },
  "INFINITI": { group: "NISSAN", display: "Infiniti", country: "JP" },
  // 大众系
  "AUDI": { group: "VW", display: "Audi", country: "DE" },
  "VW": { group: "VW", display: "Volkswagen", country: "DE" },
  "VOLKSWAGEN": { group: "VW", display: "Volkswagen", country: "DE" },
  "PORSCHE": { group: "VW", display: "Porsche", country: "DE" },
  // 宝马
  "BMW": { group: "BMW", display: "BMW", country: "DE" },
  "MINI": { group: "BMW", display: "MINI", country: "UK" },
  // 奔驰
  "MERCEDES-BENZ": { group: "DAIMLER", display: "Mercedes-Benz", country: "DE" },
  "MERCEDES": { group: "DAIMLER", display: "Mercedes-Benz", country: "DE" },
  // 其他欧洲
  "JAGUAR": { group: "JLR", display: "Jaguar", country: "UK" },
  "LAND ROVER": { group: "JLR", display: "Land Rover", country: "UK" },
  "VOLVO": { group: "VOLVO", display: "Volvo", country: "SE" },
  "SAAB": { group: "SAAB", display: "Saab", country: "SE" },
  "RENAULT": { group: "RENAULT", display: "Renault", country: "FR" },
  "PEUGEOT": { group: "PSA", display: "Peugeot", country: "FR" },
  "CITROEN": { group: "PSA", display: "Citroën", country: "FR" },
  "OPEL": { group: "STELLANTIS", display: "Opel", country: "DE" },
  "FIAT": { group: "STELLANTIS", display: "Fiat", country: "IT" },
  "ALFA ROMEO": { group: "STELLANTIS", display: "Alfa Romeo", country: "IT" },
  // 亚洲其他
  "MAZDA": { group: "MAZDA", display: "Mazda", country: "JP" },
  "SUBARU": { group: "SUBARU", display: "Subaru", country: "JP" },
  "MITSUBISHI": { group: "MITSUBISHI", display: "Mitsubishi", country: "JP" },
  "SUZUKI": { group: "SUZUKI", display: "Suzuki", country: "JP" },
  "HYUNDAI": { group: "HYUNDAI", display: "Hyundai", country: "KR" },
  "KIA": { group: "HYUNDAI", display: "Kia", country: "KR" },
  // 中国
  "CHRYSLER": { group: "STELLANTIS", display: "Chrysler", country: "US" },
  "DODGE": { group: "STELLANTIS", display: "Dodge", country: "US" },
  "JEEP": { group: "STELLANTIS", display: "Jeep", country: "US" },
  // 通用码
  "GENERIC": { group: "GENERIC", display: "Generic (SAE)", country: "" },
};

// ── 辅助函数 ──

/** 从 JSON 文件加载 DTC 数据 */
function loadJson(path: string): DtcRawRecord[] {
  if (!existsSync(path)) {
    console.warn(`  ⚠️ 文件不存在，跳过: ${path}`);
    return [];
  }
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw);
  console.log(`  📄 已加载: ${path.replace(/^.*\/normalized\//, "")} (${data.length} 条)`);
  return data;
}

/** 系统类型缩写从全称提取 */
function getSystemShort(system: string): string {
  const map: Record<string, string> = {
    powertrain: "P",
    body: "B",
    chassis: "C",
    network: "U",
  };
  return map[system.toLowerCase()] || "P";
}

// ── 主函数 ──

async function main() {
  console.log("\n🔌 DTC 数据导入工具\n");

  // 1. 检查数据库连接
  if (!TURSO_URL) {
    console.error("❌ TURSO_URL 环境变量未设置");
    console.error("   用法: TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=xxx node scripts/import-data.mjs");
    process.exit(1);
  }

  console.log(`📡 数据库: ${TURSO_URL.replace(/\/\/.*@/, "//***@")}`);

  // 2. 初始化数据库连接
  const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined });
  const db = drizzle(client);

  // 3. 自动创建表（Drizzle ORM 不会自动创建表，需要执行 CREATE TABLE IF NOT EXISTS）
  console.log("\n📦 创建表结构...");

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS dtc_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      system TEXT NOT NULL DEFAULT '',
      system_short TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      description_zh TEXT NOT NULL DEFAULT '',
      manufacturer TEXT NOT NULL DEFAULT 'GENERIC',
      is_generic INTEGER NOT NULL DEFAULT 1,
      locale TEXT NOT NULL DEFAULT 'en',
      source TEXT NOT NULL DEFAULT '',
      cause TEXT NOT NULL DEFAULT '',
      remedy TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'medium',
      related_codes TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
      updated_at TEXT
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS manufacturers (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      brands TEXT NOT NULL DEFAULT '[]',
      code_count INTEGER NOT NULL DEFAULT 0,
      logo_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
    )
  `);

  // 创建索引
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_dtc_codes_code ON dtc_codes(code)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_dtc_codes_manufacturer ON dtc_codes(manufacturer)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_dtc_codes_system_short ON dtc_codes(system_short)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_dtc_codes_code_mfr ON dtc_codes(code, manufacturer)`);

  console.log("  ✅ 表结构创建完成");

  // 4. 加载数据
  console.log("\n📖 加载 DTC 数据...");

  const dtcRecords = loadJson(DTC_DB_PATH);
  const mappingRecords = loadJson(DTCMAPPING_PATH);

  // 合并记录，去重（优先保留 wal33d 数据）
  const codeMap = new Map<string, DtcRawRecord>();

  // 先插入 wal33d 数据（优先）
  for (const r of dtcRecords) {
    const key = `${r.dtc}_${r.manufacturer || "GENERIC"}`;
    codeMap.set(key, r);
  }

  // 再插入 mapping 数据（补充不存在(manufacturer, code) 组合的码）
  for (const r of mappingRecords) {
    const key = `${r.dtc}_GENERIC`;
    if (!codeMap.has(key)) {
      codeMap.set(key, { ...r, manufacturer: "GENERIC" });
    }
  }

  console.log(`  🎯 去重后: ${codeMap.size} 条唯一记录`);

  // 5. 批量导入
  console.log("\n📤 开始导入到 Turso...");

  // 清空旧数据
  await db.run(sql`DELETE FROM dtc_codes`);
  await db.run(sql`DELETE FROM manufacturers`);

  let imported = 0;
  let batch: Record<string, unknown>[] = [];
  const BATCH_SIZE = 500;

  // 收集制造商信息
  const mfrSet = new Set<string>();

  for (const [key, record] of codeMap) {
    const code = (record.dtc || "").toUpperCase().trim();
    const description = (record.description || "").trim();
    const systemFull = (record.system || "Powertrain").trim();
    const systemType = record.type || getSystemShort(systemFull);
    const manufacturer = (record.manufacturer || "GENERIC").toUpperCase().trim();
    const isGeneric = record.is_generic !== false ? 1 : 0;
    const locale = record.locale || "en";
    const source = record.source || "wal33d/dtc-database";
    const now = new Date().toISOString();

    batch.push({
      code,
      system: systemFull,
      system_short: systemType,
      description,
      description_zh: "",
      manufacturer,
      is_generic: isGeneric,
      locale,
      source,
      cause: "",
      remedy: "",
      severity: "medium",
      related_codes: "[]",
      created_at: now,
    });

    if (manufacturer !== "GENERIC") {
      mfrSet.add(manufacturer);
    }

    imported++;

    if (batch.length >= BATCH_SIZE) {
      // 使用 INSERT OR IGNORE 避免重复
      for (const row of batch) {
        try {
          await db.run(
            sql`INSERT OR IGNORE INTO dtc_codes (code, system, system_short, description, description_zh, manufacturer, is_generic, locale, source, cause, remedy, severity, related_codes, created_at) VALUES (${row.code}, ${row.system}, ${row.system_short}, ${row.description}, ${row.description_zh}, ${row.manufacturer}, ${row.is_generic}, ${row.locale}, ${row.source}, ${row.cause}, ${row.remedy}, ${row.severity}, ${row.related_codes}, ${row.created_at})`
          );
        } catch (err) {
          console.warn(`    ⚠️ 导入失败 ${row.code}: ${err instanceof Error ? err.message.slice(0, 60) : err}`);
        }
      }
      batch = [];
      process.stdout.write(`  📊 已导入: ${imported}/${codeMap.size}\r`);
    }
  }

  // 写入剩余批次
  for (const row of batch) {
    try {
      await db.run(
        sql`INSERT OR IGNORE INTO dtc_codes (code, system, system_short, description, description_zh, manufacturer, is_generic, locale, source, cause, remedy, severity, related_codes, created_at) VALUES (${row.code}, ${row.system}, ${row.system_short}, ${row.description}, ${row.description_zh}, ${row.manufacturer}, ${row.is_generic}, ${row.locale}, ${row.source}, ${row.cause}, ${row.remedy}, ${row.severity}, ${row.related_codes}, ${row.created_at})`
      );
    } catch (err) {
      console.warn(`    ⚠️ 导入失败 ${row.code}: ${err instanceof Error ? err.message.slice(0, 60) : err}`);
    }
  }

  // 6. 写入制造商表
  console.log(`\n\n📊 写入制造商信息 (${mfrSet.size} 个)...`);

  const now2 = new Date().toISOString();

  // 先插入 GENERIC
  await db.run(sql`
    INSERT INTO manufacturers (id, display_name, full_name, country, brands, code_count, created_at)
    VALUES ('GENERIC', 'Generic (SAE)', 'SAE International Standard OBD-II Codes', '', '[]', 0, ${now2})
    ON CONFLICT(id) DO UPDATE SET code_count = (SELECT COUNT(*) FROM dtc_codes WHERE manufacturer = 'GENERIC')
  `);

  for (const mfr of mfrSet) {
    const info = BRAND_GROUPS[mfr];
    const displayName = info?.display || mfr;
    const fullName = info?.display || mfr;
    const country = info?.country || "";
    const group = info?.group || mfr;

    // 统计该制造商的码数量
    const countResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sql`dtc_codes`)
      .where(sql`manufacturer = ${mfr}`);

    const count = countResult?.[0]?.count ?? 0;

    await db.run(sql`
      INSERT INTO manufacturers (id, display_name, full_name, country, brands, code_count, created_at)
      VALUES (${mfr}, ${displayName}, ${fullName}, ${country}, '[]', ${count}, ${now2})
      ON CONFLICT(id) DO UPDATE SET code_count = ${count}
    `);

    // 更新 GENERIC 数量
    const genericCount = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sql`dtc_codes`)
      .where(sql`manufacturer = 'GENERIC'`);

    await db.run(sql`
      UPDATE manufacturers SET code_count = ${genericCount?.[0]?.count ?? 0} WHERE id = 'GENERIC'
    `);
  }

  // 7. 输出统计
  console.log("\n\n✅ 导入完成！\n");
  console.log("   📊 统计信息:");
  console.log(`   ──────────────────────────────`);
  console.log(`   DTC 码总数: ${imported}`);

  for (const short of ["P", "B", "C", "U"]) {
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(sql`dtc_codes`)
      .where(sql`system_short = ${short}`);
    const name = { P: "Powertrain", B: "Body", C: "Chassis", U: "Network" }[short];
    console.log(`   ${name} (${short}): ${result?.[0]?.count ?? 0}`);
  }

  // 制造商 Top 10
  const topMfrs = await db
    .select({ id: sql<string>`id`, count: sql<number>`code_count` })
    .from(sql`manufacturers`)
    .where(sql`id != 'GENERIC'`)
    .orderBy(sql`code_count desc`)
    .limit(10);

  console.log(`\n   🏭 制造商 Top 10:`);
  for (const m of topMfrs) {
    console.log(`   ${String(m.id).padEnd(18)} ${m.count} 条`);
  }

  client.close();
  console.log();
}

main().catch((err) => {
  console.error("\n❌ 导入失败:", err.message || err);
  process.exit(1);
});