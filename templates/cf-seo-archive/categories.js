// categories.js — derived from topics data
import { readFileSync } from "node:fs";

export default function () {
  try {
    const topics = JSON.parse(readFileSync("./src/_data/topics.json", "utf-8"));
    const seen = new Set();
    const cats = [];
    for (const t of topics) {
      if (t.category && t.categorySlug && !seen.has(t.categorySlug)) {
        seen.add(t.categorySlug);
        cats.push({ name: t.category, slug: t.categorySlug, keywords: t.keywords.split(", ").slice(0, 5) });
      }
    }
    // Deduplicate keywords
    for (const cat of cats) {
      cat.keywords = [...new Set(cat.keywords)];
    }
    return cats.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
