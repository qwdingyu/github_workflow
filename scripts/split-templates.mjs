#!/usr/bin/env node
/**
 * 将 templates/ 下的每个模板拆分为独立 git 仓库并推送到 GitHub
 * 用法: node scripts/split-templates.mjs [--dry-run]
 */

import { execSync } from "child_process";
import { readdir, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TEMPLATES_DIR = join(ROOT, "templates");

const TEMPLATES = [
  "cf-api",
  "cf-calculators",
  "cf-form",
  "cf-guardian",
  "cf-seo",
  "cf-seo-archive",
  "cf-shop",
  "cf-static",
  "cf-tools",
];

const GITHUB_USER = "qwdingyu";

function sh(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      stdio: opts.silent ? ["pipe", "pipe", "pipe"] : "inherit",
      cwd: opts.cwd || ROOT,
      encoding: "utf-8",
    });
    return (out || "").trim();
  } catch (err) {
    if (opts.optional) return null;
    console.error(`❌ 命令失败: ${cmd}`);
    console.error(err.stderr?.trim() || err.stdout?.trim() || err.message);
    throw err;
  }
}

async function splitTemplate(name, dryRun) {
  const dir = join(TEMPLATES_DIR, name);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📦 处理模板: ${name}`);
  console.log(`${"=".repeat(60)}`);

  if (dryRun) {
    console.log(`  [dry-run] 跳过实际执行`);
    return;
  }

  // 1. 清理 node_modules 和构建产物
  console.log(`  🧹 清理构建产物...`);
  try {
    execSync("rm -rf node_modules .wrangler dist _site coverage .credentials", {
      cwd: dir,
      stdio: "pipe",
    });
    // 清理 .DS_Store
    execSync("find . -name '.DS_Store' -delete", { cwd: dir, stdio: "pipe" });
    // 清理 package-lock.json（我们统一用 pnpm）
    try {
      execSync("rm -f package-lock.json", { cwd: dir, stdio: "pipe" });
    } catch {}
  } catch (e) {
    // ignore cleanup errors
  }

  // 2. 初始化 git 仓库
  console.log(`  📁 初始化 git 仓库...`);
  try {
    execSync("rm -rf .git", { cwd: dir, stdio: "pipe" });
  } catch {}
  sh(`git init -b main`, { cwd: dir });

  // 3. 配置 git 用户
  sh(`git config user.name "AtomCode"`, { cwd: dir });
  sh(`git config user.email "noreply@atomgit.com"`, { cwd: dir });

  // 4. 添加所有文件并提交
  console.log(`  📝 初始提交...`);
  sh(`git add -A`, { cwd: dir });
  sh(
    `git commit -m "chore: initial commit — ${name} template

Split from github_workflow monorepo as independent project.

Co-Authored-By: AtomCode (skywork-ai/skyclaw-v1) <noreply@atomgit.com>"`,
    { cwd: dir }
  );

  // 5. 在 GitHub 创建远程仓库
  console.log(`  ☁️  创建 GitHub 仓库: ${GITHUB_USER}/${name}`);
  try {
    sh(
      `gh repo create ${GITHUB_USER}/${name} --public --description "eForge ${name} template — Cloudflare Workers/ Pages template"`,
      { silent: true }
    );
    console.log(`  ✅ 仓库创建成功`);
  } catch {
    console.log(`  ℹ️  仓库 ${GITHUB_USER}/${name} 已存在`);
  }

  // 6. 添加远程并推送
  console.log(`  🚀 推送到 GitHub...`);
  try {
    sh(`git remote add origin https://github.com/${GITHUB_USER}/${name}.git`, {
      cwd: dir,
    });
  } catch {
    sh(
      `git remote set-url origin https://github.com/${GITHUB_USER}/${name}.git`,
      { cwd: dir }
    );
  }
  sh(`git push -u origin main`, { cwd: dir });

  console.log(`  ✅ ${name} 完成！`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("🔍 检查 GitHub 登录状态...");
  try {
    execSync("gh auth status", { stdio: "pipe" });
    console.log("✅ GitHub CLI 已登录");
  } catch {
    console.error("❌ GitHub CLI 未登录，请先运行 gh auth login");
    process.exit(1);
  }

  console.log(`📋 待处理的模板 (${TEMPLATES.length} 个):`);
  for (const name of TEMPLATES) {
    console.log(`  - ${name}`);
  }

  if (dryRun) {
    console.log("\n🔍 DRY-RUN 模式，不执行实际操作");
  }

  for (const name of TEMPLATES) {
    try {
      await splitTemplate(name, dryRun);
    } catch (err) {
      console.error(`\n❌ ${name} 处理失败，继续下一个...`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("✅ 所有模板处理完成！");
  console.log(`${"=".repeat(60)}`);
}

main().catch(console.error);
