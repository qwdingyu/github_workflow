#!/usr/bin/env node
/**
 * pipeline.mjs — One-command SEO page generation pipeline
 *
 * Steps:
 *   1. Generate topics.json (10,000 entries)
 *   2. Eleventy build
 *   3. Validate output (page count, canonical URLs, sitemap)
 *   4. Report
 *
 * Usage:
 *   node scripts/pipeline.mjs            — full 10,000 pages
 *   node scripts/pipeline.mjs --count 100 — quick test build
 *   node scripts/pipeline.mjs --skip-generate — skip step 1, rebuild only
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── CLI ───
const args = process.argv.slice(2);
let count = 10000;
let skipGenerate = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--count" && args[i + 1]) count = parseInt(args[++i], 10);
  if (args[i] === "--skip-generate") skipGenerate = true;
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const topicsPath = join(ROOT, "src/_data/topics.json");

function step(label) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log(`${"═".repeat(60)}`);
  const t0 = Date.now();
  return { label, elapsed: () => `(${((Date.now() - t0) / 1000).toFixed(1)}s)` };
}

function done(s) { console.log(`  ✅ ${s.label} ${s.elapsed()}`); }

// ─── Step 1: Generate topics ───
if (!skipGenerate) {
  const s1 = step(`Step 1/3: Generating ${count} SEO topics`);
  try {
    execSync(`node scripts/generate-topics.mjs --count ${count}`, {
      cwd: ROOT, stdio: ["inherit", "pipe", "inherit"],
    });
    done(s1);
  } catch (e) {
    console.error("  ❌ Topic generation failed!");
    process.exit(1);
  }
} else {
  console.log("\n⏭  Skipping topic generation (--skip-generate)");
}

// Verify topics.json exists
if (!existsSync(topicsPath)) {
  console.error(`  ❌ ${topicsPath} not found!`);
  process.exit(1);
}
const topics = JSON.parse(readFileSync(topicsPath, "utf-8"));
console.log(`  📊 Loaded ${topics.length} topics`);

// ─── Step 2: Clean + Eleventy build ───
const s2 = step("Step 2/3: Eleventy build");
try {
  // Clean _site first to remove stale files from previous builds
  const { rmSync } = await import("node:fs");
  rmSync(join(ROOT, "_site"), { recursive: true, force: true });
  execSync("node node_modules/@11ty/eleventy/cmd.cjs --quiet", { cwd: ROOT, stdio: "inherit" });
  done(s2);
} catch (e) {
  console.error("  ❌ Eleventy build failed!");
  process.exit(1);
}

// ─── Step 3: Validate ───
const s3 = step("Step 3/3: Validating output");
const siteDir = join(ROOT, "_site");

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
const expectedMin = topics.length + 100; // topics + 100 category pages + static pages

console.log(`  HTML pages: ${htmlCount}`);
console.log(`  Topics:     ${topics.length}`);
console.log(`  Expected:   >= ${expectedMin} (topics + categories + static)`);

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

// Sample canonical + unresolved check on first topic page
if (topics.length > 0) {
  const sampleDir = join(siteDir, topics[0].url.slice(1));
  if (existsSync(sampleDir)) {
    const htmlFile = readdirSync(sampleDir).find(f => f.endsWith(".html"));
    if (htmlFile) {
      const html = readFileSync(join(sampleDir, htmlFile), "utf-8");
      const hasCanonical = html.includes('rel="canonical"');
      const hasUnresolved = /\{\{[^}]+\}\}/.test(html);
      const jsonLdCount = (html.match(/application\/ld\+json/g) || []).length;
      console.log(`  Canonical (sample): ${hasCanonical ? "✅" : "❌"}`);
      console.log(`  Unresolved {{ }}: ${hasUnresolved ? "❌ " + "found" : "✅ 0"}`);
      console.log(`  JSON-LD schemas: ${jsonLdCount}`);
    }
  }
}

// Summary
const passed = htmlCount >= topics.length && htmlCount >= expectedMin;
console.log(`\n  ${passed ? "✅ PIPELINE PASSED" : "⚠️  PIPELINE WARNINGS"}`);
console.log(`  Total HTML output: ${htmlCount} files`);

done(s3);

console.log(`\n${"═".repeat(60)}`);
console.log("Pipeline complete!");
console.log(`${"═".repeat(60)}\n`);
