#!/usr/bin/env node
/**
 * pipeline.mjs — 通用构建流水线
 * 从 cf-seo 移植，改造为适配 cf-static 工具站
 *
 * Steps:
 *   1. Eleventy build（清理旧构建 + 构建）
 *   2. Validate output（页面数量、sitemap、robots.txt、canonical、JSON-LD）
 *   3. Report
 *
 * Usage:
 *   node scripts/pipeline.mjs            — 完整构建 + 验证
 *   node scripts/pipeline.mjs --skip-build — 跳过构建，仅验证
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── CLI ───
const args = process.argv.slice(2);
let skipBuild = false;
for (const arg of args) {
  if (arg === "--skip-build") skipBuild = true;
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const siteDir = join(ROOT, "_site");

function step(label) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log(`${"═".repeat(60)}`);
  const t0 = Date.now();
  return { label, elapsed: () => `(${((Date.now() - t0) / 1000).toFixed(1)}s)` };
}

function done(s) { console.log(`  ✅ ${s.label} ${s.elapsed()}`); }

// ─── Step 1: Eleventy build ───
if (!skipBuild) {
  const s1 = step("Step 1/2: Eleventy build");
  try {
    rmSync(siteDir, { recursive: true, force: true });
    execSync("node node_modules/@11ty/eleventy/cmd.cjs --quiet", {
      cwd: ROOT, stdio: "inherit",
    });
    done(s1);
  } catch (e) {
    console.error("  ❌ Eleventy build failed!");
    process.exit(1);
  }
} else {
  console.log("\n⏭  Skipping build (--skip-build)");
}

// ─── Step 2: Validate ───
const s2 = step("Step 2/2: Validating output");

function countHtml(dir, depth = 0) {
  if (depth > 6) return 0;
  let c = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      c += countHtml(p, depth + 1);
    } else if (entry.endsWith(".html")) {
      c++;
    }
  }
  return c;
}

const htmlCount = countHtml(siteDir);
console.log(`  HTML pages: ${htmlCount}`);

// Check sitemap
const sitemapPath = join(siteDir, "sitemap.xml");
if (existsSync(sitemapPath)) {
  const sitemap = readFileSync(sitemapPath, "utf-8");
  const urlCount = (sitemap.match(/<url>/g) || []).length;
  console.log(`  Sitemap URLs: ${urlCount}`);
} else {
  console.log("  ⚠️  sitemap.xml not found");
}

// Check robots.txt
const robotsPath = join(siteDir, "robots.txt");
if (existsSync(robotsPath)) {
  console.log("  ✅ robots.txt exists");
} else {
  console.log("  ⚠️  robots.txt not found");
}

// Sample canonical + unresolved template variable check
const indexFile = join(siteDir, "index.html");
if (existsSync(indexFile)) {
  const html = readFileSync(indexFile, "utf-8");
  const hasUnresolved = /\{\{[^}]+\}\}/.test(html);
  const jsonLdCount = (html.match(/application\/ld\+json/g) || []).length;
  console.log(`  Unresolved {{ }} (homepage): ${hasUnresolved ? "❌ found" : "✅ 0"}`);
  console.log(`  JSON-LD schemas (homepage): ${jsonLdCount}`);
}

// Check a random tool page for canonical + Schema
const toolsDir = join(siteDir, "tools");
if (existsSync(toolsDir)) {
  const toolDirs = readdirSync(toolsDir).filter(d => {
    try { return statSync(join(toolsDir, d)).isDirectory(); } catch { return false; }
  });
  if (toolDirs.length > 0) {
    const firstTool = toolDirs[0];
    const toolHtmlFile = join(toolsDir, firstTool, "index.html");
    if (existsSync(toolHtmlFile)) {
      const html = readFileSync(toolHtmlFile, "utf-8");
      const hasCanonical = html.includes('rel="canonical"');
      const hasUnresolved = /\{\{[^}]+\}\}/.test(html);
      const jsonLdCount = (html.match(/application\/ld\+json/g) || []).length;
      console.log(`  Canonical (tool: ${firstTool}): ${hasCanonical ? "✅" : "❌"}`);
      console.log(`  Unresolved {{ }} (tool): ${hasUnresolved ? "❌ found" : "✅ 0"}`);
      console.log(`  JSON-LD schemas (tool): ${jsonLdCount}`);
    }
  }
}

// Summary
const passed = htmlCount > 0;
console.log(`\n  ${passed ? "✅ PIPELINE PASSED" : "❌ PIPELINE FAILED"}`);
console.log(`  Total HTML output: ${htmlCount} files`);

done(s2);

console.log(`\n${"═".repeat(60)}`);
console.log("Pipeline complete!");
console.log(`${"═".repeat(60)}\n`);
