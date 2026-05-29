/**
 * generate-seo-pages.mjs — 程序化 SEO 页面生成器
 *
 * 读取 src/tools/*.json + src/seo-config.json + src/templates/tool.html
 * 生成 public/tools/*.html（每个工具一个页面）
 * 同时生成 public/index.html（工具列表首页）
 *
 * 每个页面包含：
 * - Schema.org JSON-LD（SoftwareApplication + FAQPage）
 * - Open Graph / Twitter Card 标签
 * - FAQ 结构化数据（AI 搜索引擎友好）
 * - canonical URL
 *
 * 用法：node scripts/generate-seo-pages.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const PUBLIC = join(ROOT, "public");
const TOOLS_OUT = join(PUBLIC, "tools");

// ── 读取配置 ──────────────────────────────────────────────────────────────────
const siteConfig = JSON.parse(readFileSync(join(SRC, "seo-config.json"), "utf-8"));
const template = readFileSync(join(SRC, "templates", "tool.html"), "utf-8");

// ── 读取所有工具定义 ──────────────────────────────────────────────────────────
const toolsDir = join(SRC, "tools");
const toolFiles = readdirSync(toolsDir).filter((f) => f.endsWith(".json")).sort();
const tools = toolFiles.map((f) => JSON.parse(readFileSync(join(toolsDir, f), "utf-8")));

console.log(`📦 Site: ${siteConfig.siteName}`);
console.log(`🔧 Tools: ${tools.length} found`);

// ── 确保输出目录存在 ──────────────────────────────────────────────────────────
if (!existsSync(TOOLS_OUT)) mkdirSync(TOOLS_OUT, { recursive: true });

// ── 模板变量替换 ──────────────────────────────────────────────────────────────
function render(html, vars) {
  let result = html;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ── 生成 FAQ Schema.org JSON-LD ──────────────────────────────────────────────
function generateFaqSchema(faq) {
  if (!faq || faq.length === 0) return "";
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
  return `<script type="application/ld+json">\n  ${JSON.stringify(schema, null, 2)}\n  </script>`;
}

// ── 生成 FAQ HTML ─────────────────────────────────────────────────────────────
function generateFaqHtml(faq) {
  if (!faq || faq.length === 0) return "<p>No FAQs yet.</p>";
  return faq
    .map(
      (item) => `
    <details>
      <summary>${item.q}</summary>
      <p>${item.a}</p>
    </details>`
    )
    .join("\n");
}

// ── 生成导航链接 ──────────────────────────────────────────────────────────────
function generateNavLinks(tools) {
  return tools
    .map((t) => `<a href="/tools/${t.slug}.html">${t.title.split(" ")[0]}</a>`)
    .join("\n      ");
}

// ── 工具内容占位符（每个工具的实际 JS 功能由单独脚本提供） ────────────────────
function generateToolContent(tool) {
  return `
    <div class="tool-container" id="tool-${tool.slug}">
      <div class="tool-input">
        <textarea id="input" placeholder="Paste your input here..." rows="10"></textarea>
      </div>
      <div class="tool-actions">
        <button onclick="processTool('${tool.slug}')" class="btn-primary">Process</button>
        <button onclick="copyOutput()" class="btn-secondary">Copy Output</button>
        <button onclick="clearAll()" class="btn-secondary">Clear</button>
      </div>
      <div class="tool-output">
        <textarea id="output" placeholder="Output will appear here..." rows="10" readonly></textarea>
      </div>
    </div>
    <script src="/js/${tool.slug}.js"></script>`;
}

// ── 生成每个工具页面 ──────────────────────────────────────────────────────────
const navLinks = generateNavLinks(tools);
const year = new Date().getFullYear();

for (const tool of tools) {
  const canonicalUrl = `${siteConfig.siteUrl}/tools/${tool.slug}.html`;

  const vars = {
    TITLE: tool.title,
    DESCRIPTION: tool.description,
    KEYWORDS: tool.keywords.join(", "),
    CANONICAL_URL: canonicalUrl,
    SITE_NAME: siteConfig.siteName,
    AUTHOR: siteConfig.author,
    LOCALE: siteConfig.locale,
    TWITTER_SITE: siteConfig.twitterHandle
      ? `<meta name="twitter:site" content="${siteConfig.twitterHandle}">`
      : "",
    FAQ_SCHEMA: generateFaqSchema(tool.faq),
    FAQ_CONTENT: generateFaqHtml(tool.faq),
    NAV_LINKS: navLinks,
    TOOL_CONTENT: generateToolContent(tool),
    YEAR: String(year),
  };

  const html = render(template, vars);
  const outPath = join(TOOLS_OUT, `${tool.slug}.html`);
  writeFileSync(outPath, html, "utf-8");
  console.log(`  ✅ ${tool.slug}.html`);
}

// ── 生成首页（工具列表） ─────────────────────────────────────────────────────
const indexTools = tools
  .map(
    (t) => `
    <a href="/tools/${t.slug}.html" class="tool-card">
      <span class="tool-icon">${t.icon || "🔧"}</span>
      <h3>${t.title}</h3>
      <p>${t.description}</p>
    </a>`
  )
  .join("\n");

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteConfig.siteName} — ${siteConfig.description}</title>
  <meta name="description" content="${siteConfig.description}">
  <link rel="canonical" href="${siteConfig.siteUrl}/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${siteConfig.siteName}">
  <meta property="og:description" content="${siteConfig.description}">
  <meta property="og:url" content="${siteConfig.siteUrl}/">
  <meta property="og:site_name" content="${siteConfig.siteName}">
  ${siteConfig.googleSiteVerification ? `<meta name="google-site-verification" content="${siteConfig.googleSiteVerification}">` : ""}
  ${siteConfig.bingSiteVerification ? `<meta name="msvalidate.01" content="${siteConfig.bingSiteVerification}">` : ""}
  <link rel="stylesheet" href="/css/style.css">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "${siteConfig.siteName}",
    "url": "${siteConfig.siteUrl}",
    "description": "${siteConfig.description}"
  }
  </script>
</head>
<body>
  <header>
    <nav>
      <a href="/" class="logo">${siteConfig.siteName}</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>${siteConfig.siteName}</h1>
      <p>${siteConfig.description}</p>
    </section>
    <section class="tools-grid">
      ${indexTools}
    </section>
  </main>
  <footer>
    <p>&copy; ${year} ${siteConfig.siteName}. All rights reserved.</p>
    <nav>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  </footer>
</body>
</html>`;

writeFileSync(join(PUBLIC, "index.html"), indexHtml, "utf-8");
console.log(`  ✅ index.html`);

// ── 生成 sitemap.xml ──────────────────────────────────────────────────────────
const sitemapUrls = [
  { url: "/", priority: "1.0", changefreq: "weekly" },
  ...tools.map((t) => ({
    url: `/tools/${t.slug}.html`,
    priority: "0.8",
    changefreq: "monthly",
  })),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map(
    (u) => `  <url>
    <loc>${siteConfig.siteUrl}${u.url}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

writeFileSync(join(PUBLIC, "sitemap.xml"), sitemap, "utf-8");
console.log(`  ✅ sitemap.xml (${sitemapUrls.length} URLs)`);

// ── 生成 robots.txt ──────────────────────────────────────────────────────────
const robots = `# robots.txt for ${siteConfig.siteName}
# Allow all crawlers including AI search engines

User-agent: *
Allow: /
Disallow: /api/

# AI Search Engines — explicitly allowed
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Bytespider
Allow: /

Sitemap: ${siteConfig.siteUrl}/sitemap.xml
`;

writeFileSync(join(PUBLIC, "robots.txt"), robots, "utf-8");
console.log(`  ✅ robots.txt (AI crawlers allowed)`);

console.log(`\n✅ Generated ${tools.length + 1} pages + sitemap + robots.txt`);
