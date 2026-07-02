#!/usr/bin/env node
/**
 * validate-architecture.mjs — eForge Monorepo 架构规则验证
 *
 * 检查项：
 * 1. cf-core schema 是否混入业务表
 * 2. 所有业务项目 schema 是否从 cf-core 导入 5 张公共表
 * 3. 是否存在 package-lock.json（npm/yarn 违规）
 * 4. pnpm-lock.yaml 是否存在（pnpm 合规）
 *
 * 用法：
 *   node scripts/validate-architecture.mjs          # 全量检查
 *   node scripts/validate-architecture.mjs --fix     # 快速修复已知偏离
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";

// ── 配置 ─────────────────────────────────────────────────────────────────────
const ROOT = join(import.meta.dirname, "..");
const TEMPLATES_DIR = join(ROOT, "templates");
const ADDITIONAL_PROJECTS = ["dtc"]; // monorepo 中非模板但使用 cf-core 的项目

// cf-core 允许的 5 张公共表
const ALLOWED_CORE_TABLES = new Set([
  "systemConfig",
  "adminAuditLogs",
  "rateLimitWindows",
  "idempotencyKeys",
  "apiKeys",
]);

// 必须从 cf-core 导入的 5 张公共表
const REQUIRED_COMMON_TABLES = [
  "systemConfig",
  "adminAuditLogs",
  "rateLimitWindows",
  "idempotencyKeys",
  "apiKeys",
];

// 已知的业务表名（用于检测 cf-core 中是否混入）
const KNOWN_BUSINESS_TABLES = [
  "products", "cards", "cardBatches", "orders", "orderEvents",
  "coupons", "emailLogs", "cardLogs", "voucherCodes", "userBalances",
  "users", "tools", "toolUsageLogs",
  "dtcCodes", "manufacturers",
];

// ── 工具 ─────────────────────────────────────────────────────────────────────

const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

let passed = 0;
let failed = 0;
let warnings = 0;

function ok(msg) { passed++; console.log(`  ${c.g("✅")} ${msg}`); }
function fail(msg) { failed++; console.log(`  ${c.r("❌")} ${msg}`); }
function warn(msg) { warnings++; console.log(`  ${c.y("⚠️")} ${msg}`); }

// ── 检查 1：cf-core schema 是否混入业务表 ────────────────────────────────────

function findCfCorePackageDir() {
  const candidateProjectDirs = [
    ...readdirSync(TEMPLATES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(TEMPLATES_DIR, d.name)),
    ...ADDITIONAL_PROJECTS.map((project) => join(ROOT, project)),
  ].filter((dir) => existsSync(join(dir, "package.json")));

  for (const projectDir of candidateProjectDirs) {
    const projectRequire = createRequire(join(projectDir, "package.json"));
    try {
      const pkgPath = projectRequire.resolve("@usethink/cf-core/package.json");
      return dirname(pkgPath);
    } catch {
      // 项目未安装或当前包版本未导出 package.json 时继续尝试 fallback。
    }

    const nodeModulesPackage = join(projectDir, "node_modules", "@usethink", "cf-core");
    if (existsSync(join(nodeModulesPackage, "package.json"))) {
      return nodeModulesPackage;
    }
  }

  const pnpmStorePackages = join(ROOT, "node_modules", ".pnpm");
  if (existsSync(pnpmStorePackages)) {
    const entry = readdirSync(pnpmStorePackages).find((name) => name.startsWith("@usethink+cf-core@"));
    if (entry) {
      const packageDir = join(pnpmStorePackages, entry, "node_modules", "@usethink", "cf-core");
      if (existsSync(join(packageDir, "package.json"))) return packageDir;
    }
  }

  return undefined;
}

function checkCoreSchema() {
  const packageDir = findCfCorePackageDir();
  if (!packageDir) {
    fail("未找到已安装的 @usethink/cf-core 包；请先运行 pnpm install");
    return;
  }

  const schemaCandidates = [
    join(packageDir, "src", "db", "schema.ts"),
    join(packageDir, "dist", "src", "db", "schema.js"),
    join(packageDir, "dist", "src", "db", "schema.d.ts"),
  ];
  const schemaPath = schemaCandidates.find((candidate) => existsSync(candidate));
  if (!schemaPath) {
    fail(`@usethink/cf-core 缺少 db/schema 发布产物: ${packageDir}`);
    return;
  }

  const content = readFileSync(schemaPath, "utf-8");

  // 检查是否定义了 sqliteTable 公共表。源码和 dist 产物格式不同，因此同时支持两类模式。
  const sourceTableMatches = content.matchAll(/export const (\w+) = sqliteTable\(/g);
  const distTableMatches = content.matchAll(/export const (\w+) = .*sqliteTable\(/g);
  const definedTables = [...new Set([...sourceTableMatches, ...distTableMatches].map((m) => m[1]))];

  const violations = definedTables.filter((t) => !ALLOWED_CORE_TABLES.has(t));
  if (violations.length > 0) {
    fail(`@usethink/cf-core 包含不允许的业务表: ${violations.join(", ")}`);
    console.log(`    ${c.dim("cf-core 只允许 5 张基础设施表: systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys, apiKeys")}`);
    console.log(`    ${c.dim("业务表（products, orders, users 等）应该放在业务项目中。")}`);
  }

  const missingCoreTables = REQUIRED_COMMON_TABLES.filter((t) => !definedTables.includes(t));
  if (missingCoreTables.length > 0) {
    fail(`@usethink/cf-core 缺少公共表定义: ${missingCoreTables.join(", ")}`);
  }

  if (violations.length === 0 && missingCoreTables.length === 0) {
    ok(`@usethink/cf-core schema 合规（${definedTables.length} 张表，来源: ${schemaPath.replace(ROOT + "/", "")}）`);
  }
}

// ── 检查 2：业务项目 schema 是否从 cf-core 导入公共表 ─────────────────────────

function checkTemplateSchemas() {
  if (!existsSync(TEMPLATES_DIR)) {
    warn("templates 目录不存在，跳过模板检查");
    return;
  }

  const templates = readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !name.startsWith(".") && name !== "docs" && name !== ".deploy");

  for (const tpl of templates) {
    checkProjectSchema(tpl, join(TEMPLATES_DIR, tpl));
  }

  // 检查额外项目
  for (const project of ADDITIONAL_PROJECTS) {
    const projectDir = join(ROOT, project);
    if (existsSync(projectDir)) {
      checkProjectSchema(project, projectDir);
    }
  }
}

function checkProjectSchema(name, projectDir) {
  const schemaPath = join(projectDir, "src", "db", "schema.ts");

  if (!existsSync(schemaPath)) {
    // 没有 schema.ts 可能是静态项目，跳过
    const pkgPath = join(projectDir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps["@usethink/cf-core"]) {
        // 用了 cf-core 但没有 schema.ts
        warn(`${name} 使用了 @usethink/cf-core 但没有 src/db/schema.ts`);
      }
    }
    return;
  }

  const content = readFileSync(schemaPath, "utf-8");

  // 检查是否从 cf-core 导入公共表
  const hasCoreImport = REQUIRED_COMMON_TABLES.every((table) => {
    const pattern = `export { ${table}`;
    const pattern2 = `  ${table},`;
    const pattern3 = `,\n  ${table}`;
    return (
      content.includes(pattern) ||
      content.includes(pattern2) ||
      content.includes(pattern3)
    );
  });

  // 检查是否用了 sqliteTable（定义了业务表）
  const hasLocalTables = content.includes("sqliteTable(");

  if (!hasCoreImport && hasLocalTables) {
    fail(`${name}/src/db/schema.ts 定义了业务表但未从 cf-core 导入 5 张公共表`);
    console.log(`    ${c.dim("必须添加: export { systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys, apiKeys } from \"@usethink/cf-core/db/schema\"")}`);
    console.log(`    ${c.dim("参考 templates/cf-shop/src/db/schema.ts 的写法")}`);
  } else if (hasCoreImport && hasLocalTables) {
    ok(`${name} schema 合规（导入公共表 + 定义了业务表）`);
  } else if (hasCoreImport && !hasLocalTables) {
    warn(`${name} 从 cf-core 导入了公共表但未定义业务表（可能是纯配置项目）`);
  } else if (!hasCoreImport && !hasLocalTables) {
    // 既没有导入也没有本地表 — 可能是空的或只有 types
    warn(`${name}/src/db/schema.ts 既未导入公共表也未定义业务表`);
  }
}

// ── 检查 3：包管理器合规 ──────────────────────────────────────────────────────

function checkPackageManager() {
  const lockFiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
  const pnpmLockPath = join(ROOT, "pnpm-lock.yaml");
  const npmLockPath = join(ROOT, "package-lock.json");

  if (existsSync(npmLockPath)) {
    fail("根目录存在 package-lock.json（npm 违规），必须删除并改用 pnpm");
  }

  if (!existsSync(pnpmLockPath)) {
    fail("根目录缺少 pnpm-lock.yaml，请运行 pnpm install 生成");
  } else {
    ok("包管理器合规（pnpm-lock.yaml 存在，无 package-lock.json）");
  }

  // 检查 dtc 子目录（它有自己的 lock 文件）
  checkSubprojectPackageManager("dtc");
  checkSubprojectPackageManager("eshop");
}

function checkSubprojectPackageManager(name) {
  const projectDir = join(ROOT, name);
  if (!existsSync(projectDir)) return;

  const npmLock = join(projectDir, "package-lock.json");
  if (existsSync(npmLock)) {
    fail(`${name}/package-lock.json 存在（npm 违规！）`);
  }
}

// ── 检查 4：package.json 中的 preinstall 脚本 ─────────────────────────────────

function checkPreinstall() {
  const rootPkgPath = join(ROOT, "package.json");
  if (!existsSync(rootPkgPath)) {
    fail("根目录 package.json 不存在");
    return;
  }

  const pkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));

  if (pkg.scripts?.preinstall === "npx only-allow pnpm") {
    ok("preinstall 脚本已配置（硬性阻断 npm/yarn）");
  } else if (pkg.scripts?.preinstall?.includes("only-allow")) {
    warn("preinstall 脚本存在但值不正确，应为: npx only-allow pnpm");
  } else {
    warn("preinstall 脚本缺失，无法阻断 npm/yarn 安装");
  }
}

// ── 检查 5：create-project.mjs 中不应有 npm 指令 ─────────────────────────────

function checkCreateProjectScript() {
  const scriptPath = join(ROOT, "scripts", "create-project.mjs");
  if (!existsSync(scriptPath)) return;

  const content = readFileSync(scriptPath, "utf-8");
  const npmRefs = content.match(/(?<![p])npm install/g);
  if (npmRefs) {
    fail(`create-project.mjs 中有 ${npmRefs.length} 处 "npm install" 引用，应为 pnpm install`);
    console.log(`    ${c.dim("请修改 scripts/create-project.mjs 中的 npm install → pnpm install")}`);
  } else {
    ok("create-project.mjs 中无 npm install 违规引用");
  }
}

// ── 快速修复模式 ──────────────────────────────────────────────────────────────

function fixDtcSchema() {
  const schemaPath = join(ROOT, "dtc", "src", "db", "schema.ts");
  if (!existsSync(schemaPath)) return;

  const content = readFileSync(schemaPath, "utf-8");

  // 检查是否已导入
  if (content.includes("from \"@usethink/cf-core/db/schema\"")) {
    console.log(`\n${c.dim("ℹ️  dtc 已导入 cf-core 公共表，无需修复")}`);
    return;
  }

  console.log(`\n${c.b("🔧 修复 dtc 架构偏离")}`);
  console.log(`    ${c.dim("在 dtc/src/db/schema.ts 中添加公共表导入...")}`);

  const insertPoint = content.indexOf(
    'import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";'
  );

  if (insertPoint === -1) {
    console.log(`    ${c.r("❌ 无法定位导入点，请手动修复")}`);
    return;
  }

  const fix = `import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ═══ 从 cf-core 导入公共表 ═══════════════════════════════════════════════════
export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "@usethink/cf-core/db/schema";`;

  const newContent = content.replace(
    'import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";',
    fix
  );

  require("fs").writeFileSync(schemaPath, newContent, "utf-8");
  console.log(`    ${c.g("✅ dtc/src/db/schema.ts 已更新，添加了 5 张公共表的导入")}`);
  console.log(`    ${c.dim("请运行 pnpm install && pnpm run -w dtc type-check 验证")}`);
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

function main() {
  const isFix = process.argv.includes("--fix");

  console.log(`\n${c.b("🔍 eForge 架构合规性验证")}`);
  console.log(`${c.dim("=".repeat(48))}\n`);

  console.log(`${c.b("检查 1/5: cf-core npm 包 schema 契约")} ${c.dim("（不应包含任何业务表）")}`);
  checkCoreSchema();

  console.log(`\n${c.b("检查 2/5: 业务项目 schema 合规性")} ${c.dim("（必须从 cf-core 导入公共表）")}`);
  checkTemplateSchemas();

  console.log(`\n${c.b("检查 3/5: 包管理器合规")} ${c.dim("（必须使用 pnpm）")}`);
  checkPackageManager();

  console.log(`\n${c.b("检查 4/5: preinstall 脚本")} ${c.dim("（npm/yarn 阻断）")}`);
  checkPreinstall();

  console.log(`\n${c.b("检查 5/5: 脚手架脚本")} ${c.dim("（无 npm/yarn 违规引用）")}`);
  checkCreateProjectScript();

  // ── 总结 ──
  console.log(`\n${c.b("=".repeat(48))}`);
  console.log(`  结果: ${c.g(`✅ ${passed} 通过`)} ${failed > 0 ? c.r(`❌ ${failed} 失败`) : ""} ${warnings > 0 ? c.y(`⚠️  ${warnings} 警告`) : ""}`);
  console.log(`${c.b("=".repeat(48))}`);
  console.log(`  ${c.dim("完整架构规则: docs/ARCHITECTURE_ENFORCEMENT.md")}\n`);

  if (failed > 0) {
    console.log(`${c.r("❌ 架构验证失败！修复上述问题后再提交。")}`);
    console.log(`${c.dim("  快速修复: node scripts/validate-architecture.mjs --fix")}\n`);
    process.exit(1);
  }

  // ── 快速修复 ──
  if (isFix) {
    fixDtcSchema();
  }
}

main();
