// seoTopics.js — Eleventy global data file
// Loads pre-generated topics.json. If missing, returns empty array (run generate-topics.mjs first).
import { readFileSync } from "node:fs";

export default function () {
  try {
    return JSON.parse(readFileSync("./src/_data/topics.json", "utf-8"));
  } catch {
    console.error("[cf-seo] topics.json not found. Run: node scripts/generate-topics.mjs");
    return [];
  }
}
