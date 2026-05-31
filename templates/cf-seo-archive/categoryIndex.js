// categoryIndex.js — pre-built O(1) category→topics lookup
// Eliminates 10,100× O(n) filterByCategory scans during template rendering.
import { readFileSync } from "node:fs";

export default function () {
  try {
    const topics = JSON.parse(readFileSync("./src/_data/topics.json", "utf-8"));
    const index = {};
    for (const t of topics) {
      if (t.category) {
        (index[t.category] ??= []).push(t);
      }
    }
    return index;
  } catch {
    return {};
  }
}
