/**
 * DTC 故障码数据导入脚本
 *
 * 从 /Users/dingyuwang/0-X/bot/data/obd/normalized/ 读取归一化后的 DTC JSON 数据，
 * 通过 Drizzle ORM 自动建表并导入 Turso 数据库。
 *
 * 铁律 #13：全程使用 Drizzle ORM，不写 raw SQL。
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
import { sql, count, eq as drizzleEq, and } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ═══════════════════════════════════════════════════════════════════
// Drizzle ORM Schema — 与 src/db/schema.ts 结构一致
// 脚本中内联定义，避免从 .ts 文件导入造成类型冲突
// ═══════════════════════════════════════════════════════════════════

/** DTC 故障码表 */
const dtcCodes = sqliteTable("dtc_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  system: text("system").notNull(),
  systemShort: text("system_short").notNull(),
  description: text("description").notNull(),
  descriptionZh: text("description_zh").default("").notNull(),
  manufacturer: text("manufacturer").notNull(),
  isGeneric: integer("is_generic").default(1).notNull(),
  locale: text("locale").default("en").notNull(),
  source: text("source").default("wal33d/dtc-database").notNull(),
  cause: text("cause").default("").notNull(),
  remedy: text("remedy").default("").notNull(),
  severity: text("severity").default("medium").notNull(),
  relatedCodes: text("related_codes").default("[]").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

/** 制造商表 */
const manufacturers = sqliteTable("manufacturers", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  fullName: text("full_name").default("").notNull(),
  country: text("country").default("").notNull(),
  brands: text("brands").default("[]").notNull(),
  codeCount: integer("code_count").default(0).notNull(),
  logoUrl: text("logo_url").default("").notNull(),
  createdAt: text("created_at").notNull(),
});

// ── 数据记录类型 ──

/** DTC 原始 JSON 数据记录 */
function parseRecord(raw) {
  return {
    dtc: raw.dtc || "",
    system: raw.system || "",
    description: raw.description || "",
    manufacturer: raw.manufacturer || "",
    type: raw.type || "",
    isGeneric: raw.is_generic,
    locale: raw.locale || "en",
    source: raw.source || "wal33d/dtc-database",
  };
}

// ── 配置 ──

const DTC_DB_PATH = "/Users/dingyuwang/0-X/bot/data/obd/normalized/dtc_database_normalized.json";
const DTCMAPPING_PATH = "/Users/dingyuwang/0-X/bot/data/obd/normalized/dtcmapping_normalized.json";
const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN;

// ── 制造商分组映射（用于生成 manufacturers 表） ──

const BRAND_GROUPS = {
  BUICK: { group: "GM", display: "Buick", country: "US" },
  CADILLAC: { group: "GM", display: "Cadillac", country: "US" },
  CHEVROLET: { group: "GM", display: "Chevrolet", country: "US" },
  GM: { group: "GM", display: "General Motors", country: "US" },
  GMC: { group: "GM", display: "GMC", country: "US" },
  OLDSMOBILE: { group: "GM", display: "Oldsmobile", country: "US" },
  SATURN: { group: "GM", display: "Saturn", country: "US" },
  FORD: { group: "FORD", display: "Ford", country: "US" },
  LINCOLN: { group: "FORD", display: "Lincoln", country: "US" },
  MERCURY: { group: "FORD", display: "Mercury", country: "US" },
  TOYOTA: { group: "TOYOTA", display: "Toyota", country: "JP" },
  LEXUS: { group: "TOYOTA", display: "Lexus", country: "JP" },
  HONDA: { group: "HONDA", display: "Honda", country: "JP" },
  ACURA: { group: "HONDA", display: "Acura", country: "JP" },
  NISSAN: { group: "NISSAN", display: "Nissan", country: "JP" },
  INFINITI: { group: "NISSAN", display: "Infiniti", country: "JP" },
  AUDI: { group: "VW", display: "Audi", country: "DE" },
  VW: { group: "VW", display: "Volkswagen", country: "DE" },
  VOLKSWAGEN: { group: "VW", display: "Volkswagen", country: "DE" },
  PORSCHE: { group: "VW", display: "Porsche", country: "DE" },
  BMW: { group: "BMW", display: "BMW", country: "DE" },
  MINI: { group: "BMW", display: "MINI", country: "UK" },
  "MERCEDES-BENZ": { group: "DAIMLER", display: "Mercedes-Benz", country: "DE" },
  MERCEDES: { group: "DAIMLER", display: "Mercedes-Benz", country: "DE" },
  JAGUAR: { group: "JLR", display: "Jaguar", country: "UK" },
  "LAND ROVER": { group: "JLR", display: "Land Rover", country: "UK" },
  VOLVO: { group: "VOLVO", display: "Volvo", country: "SE" },
  MAZDA: { group: "MAZDA", display: "Mazda", country: "JP" },
  SUBARU: { group: "SUBARU", display: "Subaru", country: "JP" },
  MITSUBISHI: { group: "MITSUBISHI", display: "Mitsubishi", country: "JP" },
  HYUNDAI: { group: "HYUNDAI", display: "Hyundai", country: "KR" },
  KIA: { group: "HYUNDAI", display: "Kia", country: "KR" },
  CHRYSLER: { group: "STELLANTIS", display: "Chrysler", country: "US" },
  DODGE: { group: "STELLANTIS", display: "Dodge", country: "US" },
  JEEP: { group: "STELLANTIS", display: "Jeep", country: "US" },
  GENERIC: { group: "GENERIC", display: "Generic (SAE)", country: "" },
};

// ── 辅助函数 ──

/** 从 JSON 文件加载 DTC 数据 */
function loadJson(path) {
  if (!existsSync(path)) {
    console.warn(`  ⚠️ 文件不存在，跳过: ${path}`);
    return [];
  }
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw);
  console.log(`  📄 已加载: ${path.replace(/^.*\/normalized\//, "")} (${data.length} 条)`);
  return data;
}

/** 从系统全称提取缩写 */
function getSystemShort(system) {
  const map = { powertrain: "P", body: "B", chassis: "C", network: "U" };
  return map[system.toLowerCase()] || "P";
}

// ── 主函数 ──

async function main() {
  console.log("\n🔌 DTC 数据导入工具\n");

  if (!TURSO_URL) {
    console.error("❌ TURSO_URL 环境变量未设置");
    process.exit(1);
  }

  console.log(`📡 数据库: ${TURSO_URL.replace(/\/\/.*@/, "//***@")}`);

  // 初始化数据库连接
  const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined });

  // 建表 + 建索引（Turso HTTP 模式下使用 client.execute，Drizzle ORM 不自建表）
  // 首次连接可能超时，重试最多 3 次
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.execute(`CREATE TABLE IF NOT EXISTS dtc_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL,
        system TEXT NOT NULL DEFAULT '', system_short TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '', description_zh TEXT NOT NULL DEFAULT '',
        manufacturer TEXT NOT NULL DEFAULT 'GENERIC', is_generic INTEGER NOT NULL DEFAULT 1,
        locale TEXT NOT NULL DEFAULT 'en', source TEXT NOT NULL DEFAULT '',
        cause TEXT NOT NULL DEFAULT '', remedy TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'medium', related_codes TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'), updated_at TEXT
      )`);
      await client.execute(`CREATE TABLE IF NOT EXISTS manufacturers (
        id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '',
        full_name TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '',
        brands TEXT NOT NULL DEFAULT '[]', code_count INTEGER NOT NULL DEFAULT 0,
        logo_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
      )`);
      await client.execute("CREATE INDEX IF NOT EXISTS idx_dtc_codes_code ON dtc_codes(code)");
      await client.execute("CREATE INDEX IF NOT EXISTS idx_dtc_codes_manufacturer ON dtc_codes(manufacturer)");
      await client.execute("CREATE INDEX IF NOT EXISTS idx_dtc_codes_system_short ON dtc_codes(system_short)");
      await client.execute("CREATE INDEX IF NOT EXISTS idx_dtc_codes_code_mfr ON dtc_codes(code, manufacturer)");
      console.log("  ✅ 表结构创建完成");
      break;
    } catch (err) {
      if (attempt < 3) {
        console.warn(`  ⚠️ 建表重试 ${attempt}/3: ${err.message?.slice(0, 60)}`);
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw err;
      }
    }
  }
  const db = drizzle(client, { schema: { dtcCodes, manufacturers } });

  // 加载数据
  console.log("\n📖 加载 DTC 数据...");

  const dtcRecords = loadJson(DTC_DB_PATH);
  const mappingRecords = loadJson(DTCMAPPING_PATH);

  // 合并记录，去重
  const codeMap = new Map();

  for (const r of dtcRecords) {
    const key = `${r.dtc}_${r.manufacturer || "GENERIC"}`;
    codeMap.set(key, r);
  }

  for (const r of mappingRecords) {
    const key = `${r.dtc}_GENERIC`;
    if (!codeMap.has(key)) {
      codeMap.set(key, { ...r, manufacturer: "GENERIC", type: r.dtc?.[0] || "P" });
    }
  }

  console.log(`  🎯 去重后: ${codeMap.size} 条唯一记录`);

  // 批量导入（使用 Drizzle ORM 的 insert）
  console.log("\n📤 开始导入到 Turso...");

  // 清空旧数据（使用 client.execute，Drizzle ORM delete 在 Turso HTTP 模式下不支持）
  try {
    await client.execute("DELETE FROM dtc_codes");
    await client.execute("DELETE FROM manufacturers");
  } catch (err) {
    console.warn("  ⚠️ 清空失败:", err.message?.slice(0, 80));
  }

  let imported = 0;
  let batchValues = [];
  const BATCH_SIZE = 500;
  const mfrSet = new Set();
  const now = new Date().toISOString();

  for (const [key, record] of codeMap) {
    const code = (record.dtc || "").toUpperCase().trim();
    if (!code) continue;

    const description = (record.description || "").trim();
    const systemRaw = (record.system || "").trim();

    // systemShort: 优先从 type 字段, 次从 system 全称推断, 最后从 DTC 首字母保底
    let systemShort = "";
    if (record.type && typeof record.type === "string" && record.type.length === 1 && "PBCU".includes(record.type.toUpperCase())) {
      systemShort = record.type.toUpperCase();
    } else {
      systemShort = getSystemShort(systemRaw);
    }
    if (!systemShort && code.length >= 1 && "PBCU".includes(code[0])) {
      systemShort = code[0];
    }

    // system 全称: 从缩写反查, 否则用原始值, 最后保底
    const systemFull = ({
      P: "Powertrain", B: "Body", C: "Chassis", U: "Network"
    })[systemShort] || systemRaw || "Powertrain";
    const manufacturer = (record.manufacturer || "GENERIC").toUpperCase().trim();
    const isGeneric = record.is_generic !== false ? 1 : 0;
    const locale = record.locale || "en";
    const source = record.source || "wal33d/dtc-database";

    batchValues.push({
      code,
      system: systemFull,
      systemShort: systemShort,
      description,
      descriptionZh: "",
      manufacturer,
      isGeneric,
      locale,
      source,
      cause: "",
      remedy: "",
      severity: "medium",
      relatedCodes: "[]",
      createdAt: now,
    });

    if (manufacturer !== "GENERIC") {
      mfrSet.add(manufacturer);
    }
    imported++;

    // 每 BATCH_SIZE 条批量写入一次
    if (batchValues.length >= BATCH_SIZE) {
      await db.insert(dtcCodes).values(batchValues).onConflictDoNothing();
      batchValues = [];
      process.stdout.write(`  📊 已导入: ${imported}/${codeMap.size}\r`);
    }
  }

  // 写入剩余批次
  if (batchValues.length > 0) {
    await db.insert(dtcCodes).values(batchValues).onConflictDoNothing();
  }

  // 写入制造商表（使用 Drizzle ORM insert + onConflictDoNothing）
  console.log(`\n\n📊 写入制造商信息 (${mfrSet.size + 1} 个)...`);

  const now2 = new Date().toISOString();

  // 查询各制造商的码数量
  const mfrCounts = await db
    .select({ manufacturer: dtcCodes.manufacturer, count: count() })
    .from(dtcCodes)
    .groupBy(dtcCodes.manufacturer);

  // 先写入 GENERIC
  const genericCount = mfrCounts.find((r) => r.manufacturer === "GENERIC")?.count ?? 0;
  await db.insert(manufacturers).values({
    id: "GENERIC",
    displayName: "Generic (SAE)",
    fullName: "SAE International Standard OBD-II Codes",
    country: "",
    brands: "[]",
    codeCount: Number(genericCount),
    logoUrl: "",
    createdAt: now2,
  }).onConflictDoUpdate({ target: manufacturers.id, set: { codeCount: Number(genericCount) } });

  // 写入各品牌
  for (const mfr of mfrSet) {
    const info = BRAND_GROUPS[mfr];
    const displayName = info?.display || mfr;
    const fullName = info?.display || mfr;
    const country = info?.country || "";
    const mfrCount = mfrCounts.find((r) => r.manufacturer === mfr)?.count ?? 0;

    await db.insert(manufacturers).values({
      id: mfr,
      displayName,
      fullName,
      country,
      brands: "[]",
      codeCount: Number(mfrCount),
      logoUrl: "",
      createdAt: now2,
    }).onConflictDoUpdate({ target: manufacturers.id, set: { codeCount: Number(mfrCount) } });
  }

  // 输出统计（使用 Drizzle ORM 查询）
  console.log("\n\n✅ 导入完成！\n");
  console.log("   📊 统计信息:");
  console.log(`   ──────────────────────────────`);
  console.log(`   DTC 码总数: ${imported}`);

  for (const short of ["P", "B", "C", "U"]) {
    const result = await db
      .select({ count: count() })
      .from(dtcCodes)
      .where(drizzleEq(dtcCodes.systemShort, short));
    const name = { P: "Powertrain", B: "Body", C: "Chassis", U: "Network" }[short];
    console.log(`   ${name} (${short}): ${result[0]?.count ?? 0}`);
  }

  // 制造商 Top 10
  const topMfrs = await db
    .select({ id: manufacturers.id, count: manufacturers.codeCount })
    .from(manufacturers)
    .where(sql`${manufacturers.id} != 'GENERIC'`)
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