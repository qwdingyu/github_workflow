import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const html = readFileSync(join(root, "src", "index.html"), "utf8");
const app = readFileSync(join(root, "src", "app.js"), "utf8");
const css = readFileSync(join(root, "src", "styles.css"), "utf8");
const headers = readFileSync(join(root, "src", "_headers"), "utf8");

const required = [
  ["domain", "shop.eforge.xyz", html],
  ["telegram config", "telegram", app],
  ["buy url placeholder", "https://www.baidu.com", app],
  ["product mount", "productGrid", html],
  ["responsive css", "@media", css],
  ["security headers", "Content-Security-Policy", headers],
  ["content type header", "X-Content-Type-Options", headers]
];

const missing = required.filter(([, pattern, content]) => !content.includes(pattern));

if (missing.length > 0) {
  for (const [name, pattern] of missing) {
    console.error(`Missing ${name}: ${pattern}`);
  }
  process.exit(1);
}

console.log("Vibox static checks passed.");
