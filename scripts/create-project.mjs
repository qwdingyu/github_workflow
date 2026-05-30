#!/usr/bin/env node
/**
 * create-project.mjs — 从模板快速创建新产品项目
 *
 * 用法：
 *   node scripts/create-project.mjs
 *   node scripts/create-project.mjs my-tool --template cf-static --domain my-tool.com
 *
 * 核心目标：将"从模板到新产品"的手动步骤从 15+ 步缩减到 1 条命令。
 * 后续步骤：pnpm install → 编辑业务配置 → bash .deploy/one-click.sh
 */

import { createInterface } from "readline";
import {
  existsSync, mkdirSync, readdirSync, readFileSync,
  writeFileSync, statSync, cpSync,
} from "fs";
import { join, relative, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEMPLATES_DIR = join(ROOT, "templates");
const OUTPUT_DIR = resolve(ROOT, ".."); // 新产品输出到 monorepo 同级目录

// ── 排除列表（复制时跳过） ──────────────────────────────────────────────────
const EXCLUDE_DIRS = new Set([
  "node_modules", ".wrangler", ".credentials", ".git",
  "dist", "build", ".dev",
]);
const EXCLUDE_FILES = new Set([
  "package-lock.json", ".dev.vars",
]);

// ── 模板清单 ─────────────────────────────────────────────────────────────────
const TEMPLATES = {
  "cf-shop":   { desc: "发卡商城（Workers + Turso）",      mode: "workers" },
  "cf-api":    { desc: "API 中间层（Workers + Turso）",    mode: "workers" },
  "cf-tools":  { desc: "在线工具箱（Workers + Turso）",    mode: "workers" },
  "cf-form":   { desc: "动态表单系统（Workers + Turso）",  mode: "workers" },
  "cf-static": { desc: "SEO 工具站（Pages 纯静态）",      mode: "pages" },
};

// ── 终端颜色 ─────────────────────────────────────────────────────────────────
const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

// ── 交互式提示 ───────────────────────────────────────────────────────────────
function createPrompt() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return (question, defaultValue = "") =>
    new Promise((resolve) => {
      const hint = defaultValue ? ` ${c.dim(`(${defaultValue})`)}` : "";
      rl.question(`${question}${hint}: `, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
}

// ── 参数解析 ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { name: "", template: "", domain: "", output: "" };
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--template" && raw[i + 1]) args.template = raw[++i];
    else if (raw[i] === "--domain" && raw[i + 1]) args.domain = raw[++i];
    else if (raw[i] === "--output" && raw[i + 1]) args.output = raw[++i];
    else if (!raw[i].startsWith("--")) args.name = raw[i];
  }
  return args;
}

// ── 验证项目名 ───────────────────────────────────────────────────────────────
function validateName(name) {
  if (!name) return "项目名不能为空";
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) return "仅允许小写字母、数字和连字符，2-31 字符，以字母开头";
  return null;
}

// ── 复制目录（排除不需要的文件） ─────────────────────────────────────────────
function copyTemplate(srcDir, destDir) {
  const entries = readdirSync(srcDir);
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    if (EXCLUDE_FILES.has(entry)) continue;

    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

// ── 递归替换文件内容 ─────────────────────────────────────────────────────────
function replaceInDir(dir, replacements, extensions = null) {
  let count = 0;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      count += replaceInDir(fullPath, replacements, extensions);
    } else if (!extensions || extensions.some((ext) => entry.endsWith(ext))) {
      try {
        let content = readFileSync(fullPath, "utf-8");
        let modified = false;
        for (const [from, to] of replacements) {
          if (content.includes(from)) {
            content = content.replaceAll(from, to);
            modified = true;
          }
        }
        if (modified) {
          writeFileSync(fullPath, content, "utf-8");
          count++;
        }
      } catch {
        // 二进制文件跳过
      }
    }
  }
  return count;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.b("🚀 创建新产品项目")}`);
  console.log(`${c.dim("从模板快速创建 → 一键部署到 Cloudflare")}\n`);

  const args = parseArgs(process.argv);
  const prompt = createPrompt();

  // 1. 项目名
  let name = args.name;
  if (!name) name = await prompt("项目名（如 my-tool）", "");
  const nameErr = validateName(name);
  if (nameErr) { console.error(c.r(`❌ ${nameErr}`)); process.exit(1); }

  // 2. 选择模板
  let template = args.template;
  if (!template || !TEMPLATES[template]) {
    console.log("\n可用模板：");
    for (const [key, info] of Object.entries(TEMPLATES)) {
      console.log(`  ${c.g(key.padEnd(12))} ${info.desc}`);
    }
    template = await prompt("\n选择模板", "cf-static");
  }
  if (!TEMPLATES[template]) {
    console.error(c.r(`❌ 模板 "${template}" 不存在`));
    process.exit(1);
  }

  // 3. 域名（可选）
  let domain = args.domain;
  if (!domain) domain = await prompt("自定义域名（可选，回车跳过）", "");

  // 4. 输出目录
  const outputBase = args.output ? resolve(args.output) : OUTPUT_DIR;
  const outputDir = join(outputBase, name);

  if (existsSync(outputDir)) {
    console.error(c.r(`❌ 目录已存在: ${outputDir}`));
    process.exit(1);
  }

  // ── 确认 ──────────────────────────────────────────────────────────────────
  console.log(`\n${c.b("配置确认")}：`);
  console.log(`  项目名:   ${c.g(name)}`);
  console.log(`  模板:     ${c.g(template)} (${TEMPLATES[template].desc})`);
  console.log(`  域名:     ${domain || c.dim("（稍后配置）")}`);
  console.log(`  输出目录: ${outputDir}`);

  const confirm = await prompt("\n确认创建？(Y/n)", "Y");
  if (confirm.toLowerCase() === "n") {
    console.log(c.y("已取消"));
    process.exit(0);
  }

  // ── Step 1: 复制模板 ──────────────────────────────────────────────────────
  console.log(`\n${c.b("Step 1/4")} 复制模板...`);
  const templateDir = join(TEMPLATES_DIR, template);
  mkdirSync(outputDir, { recursive: true });
  copyTemplate(templateDir, outputDir);
  console.log(`  ${c.g("✅")} 模板复制完成`);

  // ── Step 2: 替换项目名 ───────────────────────────────────────────────────
  console.log(`${c.b("Step 2/4")} 替换项目名...`);

  const templateDisplayName = {
    "cf-shop": "CF Shop",
    "cf-api": "CF-API",
    "cf-tools": "CF Tools",
    "cf-form": "CF Form",
    "cf-static": "DevTools Online",
  };

  const replacements = [
    [template, name],                         // cf-shop → my-tool
    [templateDisplayName[template], name],    // CF Shop → my-tool
  ];

  if (domain) {
    replacements.push(
      ["https://YOUR_DOMAIN.example.com", `https://${domain}`],
      [`https://${name}.workers.dev`, `https://${domain}`],
      [`https://${name}.pages.dev`, `https://${domain}`],
    );
  }

  // 先做文本替换（seo-config.json 在后面单独处理，避免双重替换）
  const textExts = [".json", ".jsonc", ".ts", ".js", ".mjs", ".html", ".md", ".yml", ".yaml", ".sh", ".css", ".txt", ".sql"];
  const count = replaceInDir(outputDir, replacements, textExts);
  console.log(`  ${c.g("✅")} 替换了 ${count} 个文件`);

  // seo-config.json 特殊处理（cf-static）—— 必须在文本替换之后，覆盖可能被误替换的值
  const seoConfigPath = join(outputDir, "src", "seo-config.json");
  if (existsSync(seoConfigPath)) {
    const seoConfig = JSON.parse(readFileSync(seoConfigPath, "utf-8"));
    seoConfig.siteName = name;
    seoConfig.description = `${name} — Online Tools & Utilities`;
    if (domain) seoConfig.siteUrl = `https://${domain}`;
    else seoConfig.siteUrl = `https://${name}.pages.dev`;
    writeFileSync(seoConfigPath, JSON.stringify(seoConfig, null, 2) + "\n", "utf-8");
    console.log(`  ${c.g("✅")} seo-config.json 已更新`);
  }

  // ── Step 3: 清理与准备 ─────────────────────────────────────────────────────
  console.log(`${c.b("Step 3/4")} 清理与准备...`);

  // cf-core 依赖处理：Workers 模板依赖 @eforge/cf-core，需要复制到项目内
  const outputPkgPath = join(outputDir, "package.json");
  const outputPkg = JSON.parse(readFileSync(outputPkgPath, "utf-8"));
  const cfCoreDep = outputPkg.dependencies?.["@eforge/cf-core"];
  if (cfCoreDep && cfCoreDep.startsWith("file:")) {
    const cfCoreSrc = join(ROOT, "packages", "cf-core");
    const cfCoreDest = join(outputDir, "packages", "cf-core");
    if (existsSync(cfCoreSrc)) {
      mkdirSync(join(outputDir, "packages"), { recursive: true });
      copyTemplate(cfCoreSrc, cfCoreDest);
      // 改写 package.json 中的依赖路径
      outputPkg.dependencies["@eforge/cf-core"] = "file:./packages/cf-core";
      writeFileSync(outputPkgPath, JSON.stringify(outputPkg, null, 2) + "\n", "utf-8");
      // 改写 tsconfig.json 中的 paths
      const tsconfigPath = join(outputDir, "tsconfig.json");
      if (existsSync(tsconfigPath)) {
        let tsconfigContent = readFileSync(tsconfigPath, "utf-8");
        tsconfigContent = tsconfigContent.replace(
          /\.\.\/\.\.\/packages\/cf-core/g,
          "./packages/cf-core"
        );
        writeFileSync(tsconfigPath, tsconfigContent, "utf-8");
      }
      console.log(`  ${c.g("✅")} cf-core 已复制到 packages/（独立部署就绪）`);
    }
  }

  // 确保 .gitignore 包含敏感目录
  const gitignorePath = join(outputDir, ".gitignore");
  let gitignoreContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  const requiredIgnores = [
    "node_modules/", ".wrangler/", ".credentials/",
    ".dev.vars", "package-lock.json",
  ];
  for (const line of requiredIgnores) {
    if (!gitignoreContent.includes(line)) {
      gitignoreContent += `\n${line}`;
    }
  }
  writeFileSync(gitignorePath, gitignoreContent.trim() + "\n", "utf-8");

  // 设置 .deploy-mode 文件
  const deployModePath = join(outputDir, ".deploy-mode");
  if (!existsSync(deployModePath)) {
    writeFileSync(deployModePath, TEMPLATES[template].mode + "\n", "utf-8");
  }

  console.log(`  ${c.g("✅")} .gitignore + .deploy-mode 已就绪`);

  // ── Step 4: Git 初始化 ────────────────────────────────────────────────────
  console.log(`${c.b("Step 4/4")} Git 初始化...`);
  try {
    execSync("git init -b main", { cwd: outputDir, stdio: "pipe" });
    execSync("git add -A", { cwd: outputDir, stdio: "pipe" });
    execSync(`git commit -m "chore: 从 ${template} 模板创建 ${name}"`, { cwd: outputDir, stdio: "pipe" });
    console.log(`  ${c.g("✅")} Git 仓库已初始化`);
  } catch (err) {
    console.log(`  ${c.y("⚠️")} Git 初始化跳过（${err.message}）`);
  }

  // ── 完成 ──────────────────────────────────────────────────────────────────
  const workerName = name;
  const deployMode = TEMPLATES[template].mode;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${c.g("✅")} ${c.b(name)} 创建成功！`);
  console.log(`${"═".repeat(60)}`);

  console.log(`\n${c.b("下一步：")}\n`);
  console.log(`  ${c.g("1.")} cd ${relative(process.cwd(), outputDir)}`);
  console.log(`  ${c.g("2.")} pnpm install`);

  if (deployMode === "pages") {
    console.log(`  ${c.g("3.")} 编辑 src/seo-config.json（站点信息）`);
    console.log(`  ${c.g("4.")} pnpm run build（生成 SEO 页面）`);
    console.log(`  ${c.g("5.")} CLOUDFLARE_API_TOKEN="xxx" bash .deploy/one-click.sh`);
  } else {
    console.log(`  ${c.g("3.")} 编辑 src/config.ts（业务配置）`);
    console.log(`  ${c.g("4.")} 编辑 wrangler.jsonc（Worker 名称）`);
    console.log(`  ${c.g("5.")} CLOUDFLARE_API_TOKEN="xxx" TURSO_API_TOKEN="xxx" bash .deploy/one-click.sh`);
  }

  if (domain) {
    console.log(`\n${c.dim("提示：部署完成后，运行以下命令绑定域名：")}`);
    console.log(`${c.dim(`  cd ${relative(process.cwd(), outputDir)} && SKIP_STEPS=00,01,02,03,05,06 bash .deploy/one-click.sh`)}`);
  }

  console.log(`\n${c.dim("模板来源:")} ${template} (${TEMPLATES[template].desc})`);
  console.log(`${c.dim("部署模式:")} ${deployMode}`);
  console.log(`${c.dim("Worker 名:")} ${workerName}`);
  console.log("");
}

main().catch((err) => {
  console.error(c.r(`❌ 错误: ${err.message}`));
  process.exit(1);
});
