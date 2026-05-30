/**
 * generate-seo-pages.mjs — 程序化 SEO 页面生成器
 *
 * 读取多种内容源，生成完整的静态站点：
 *
 * 内容源：
 * - src/tools/*.json   → 工具页面（public/tools/*.html）
 * - src/posts/*.json   → 博客文章（public/posts/*.html）
 * - src/docs/*.json    → 文档页面（public/docs/*.html）
 * - src/seo-config.json → 全局配置
 *
 * 生成的页面：
 * - public/index.html        — 工具列表首页
 * - public/blog/index.html   — 博客列表页
 * - public/docs/index.html   — 文档目录页
 * - public/sitemap.xml       — 站点地图
 * - public/robots.txt        — 爬虫规则
 *
 * 每个页面包含：
 * - Schema.org JSON-LD（按页面类型自动选择）
 * - Open Graph / Twitter Card 标签
 * - canonical URL
 * - Plausible 分析脚本（如配置了 plausibleDomain）
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
const toolTemplate = readFileSync(join(SRC, "templates", "tool.html"), "utf-8");

// ── 读取所有工具定义 ──────────────────────────────────────────────────────────
const toolsDir = join(SRC, "tools");
const toolFiles = readdirSync(toolsDir).filter((f) => f.endsWith(".json")).sort();
const tools = toolFiles.map((f) => JSON.parse(readFileSync(join(toolsDir, f), "utf-8")));

// ── 读取博客文章 ──────────────────────────────────────────────────────────────
const postsDir = join(SRC, "posts");
const posts = existsSync(postsDir)
  ? readdirSync(postsDir).filter((f) => f.endsWith(".json")).sort()
      .map((f) => JSON.parse(readFileSync(join(postsDir, f), "utf-8")))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
  : [];

// ── 读取文档页面 ──────────────────────────────────────────────────────────────
const docsDir = join(SRC, "docs");
const docs = existsSync(docsDir)
  ? readdirSync(docsDir).filter((f) => f.endsWith(".json")).sort()
      .map((f) => JSON.parse(readFileSync(join(docsDir, f), "utf-8")))
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  : [];

console.log(`📦 Site: ${siteConfig.siteName}`);
console.log(`🔧 Tools: ${tools.length} found`);
console.log(`📝 Posts: ${posts.length} found`);
console.log(`📄 Docs: ${docs.length} found`);

// ── 确保输出目录存在 ──────────────────────────────────────────────────────────
const POSTS_OUT = join(PUBLIC, "posts");
const DOCS_OUT = join(PUBLIC, "docs");
if (!existsSync(TOOLS_OUT)) mkdirSync(TOOLS_OUT, { recursive: true });
if (!existsSync(POSTS_OUT)) mkdirSync(POSTS_OUT, { recursive: true });
if (!existsSync(DOCS_OUT)) mkdirSync(DOCS_OUT, { recursive: true });

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

// ── 生成 BreadcrumbList Schema.org JSON-LD ───────────────────────────────────
function generateBreadcrumbSchema(siteName, siteUrl, items) {
  if (!items || items.length === 0) return "";
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.url ? { item: `${siteUrl}${item.url}` } : {}),
    })),
  };
  return `<script type="application/ld+json">\n  ${JSON.stringify(schema)}\n  </script>`;
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

// ── 生成 Plausible 分析脚本（如果配置了 plausibleDomain） ─────────────────────
const analyticsScript = siteConfig.plausibleDomain
  ? `<script defer data-domain="${siteConfig.plausibleDomain}" src="https://plausible.io/js/script.js"></script>`
  : "";

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
    BREADCRUMB_SCHEMA: generateBreadcrumbSchema(siteConfig.siteName, siteConfig.siteUrl, [
      { name: siteConfig.siteName, url: "/" },
      { name: "Tools" },
      { name: tool.title, url: `/tools/${tool.slug}.html` },
    ]),
    FAQ_CONTENT: generateFaqHtml(tool.faq),
    NAV_LINKS: navLinks,
    TOOL_CONTENT: generateToolContent(tool),
    YEAR: String(year),
    ANALYTICS_SCRIPT: analyticsScript,
  };

  const html = render(toolTemplate, vars);
  const outPath = join(TOOLS_OUT, `${tool.slug}.html`);
  writeFileSync(outPath, html, "utf-8");
  console.log(`  ✅ tools/${tool.slug}.html`);
}

// ── 读取博客和文档模板 ───────────────────────────────────────────────────────
const postTemplate = existsSync(join(SRC, "templates", "post.html"))
  ? readFileSync(join(SRC, "templates", "post.html"), "utf-8")
  : null;
const docTemplate = existsSync(join(SRC, "templates", "doc.html"))
  ? readFileSync(join(SRC, "templates", "doc.html"), "utf-8")
  : null;

// ── 生成博客文章页面 ─────────────────────────────────────────────────────────
// 将 locale 转换为 BCP 47 格式（en_US → en-US）
function toBcp47(locale) {
  return (locale || "en-US").replace("_", "-");
}

if (postTemplate) {
  for (const post of posts) {
    const canonicalUrl = `${siteConfig.siteUrl}/posts/${post.slug}.html`;
    const dateObj = post.date ? new Date(post.date) : new Date();
    const dateIso = dateObj.toISOString();
    const dateDisplay = dateObj.toLocaleDateString(toBcp47(post.locale || siteConfig.locale), {
      year: "numeric", month: "long", day: "numeric"
    });

    const vars = {
      TITLE: post.title,
      DESCRIPTION: post.description,
      KEYWORDS: (post.keywords || []).join(", "),
      CANONICAL_URL: canonicalUrl,
      SITE_NAME: siteConfig.siteName,
      AUTHOR: post.author || siteConfig.author,
      LOCALE: post.locale || siteConfig.locale,
      DATE_ISO: dateIso,
      DATE_DISPLAY: dateDisplay,
      CONTENT: post.content || "",
      TWITTER_SITE: siteConfig.twitterHandle
        ? `<meta name="twitter:site" content="${siteConfig.twitterHandle}">`
        : "",
      ANALYTICS_SCRIPT: analyticsScript,
      YEAR: String(year),
    };

    const html = render(postTemplate, vars);
    const outPath = join(POSTS_OUT, `${post.slug}.html`);
    writeFileSync(outPath, html, "utf-8");
    console.log(`  ✅ posts/${post.slug}.html`);
  }

  // 生成博客列表页
  const postCards = posts.map((p) => {
    const dateObj = p.date ? new Date(p.date) : new Date();
    const dateDisplay = dateObj.toLocaleDateString(toBcp47(p.locale || siteConfig.locale), {
      year: "numeric", month: "long", day: "numeric"
    });
    return `
    <a href="/posts/${p.slug}.html" class="post-card">
      <time datetime="${dateObj.toISOString()}">${dateDisplay}</time>
      <h3>${p.title}</h3>
      <p>${p.description}</p>
    </a>`;
  }).join("\n");

  const blogIndexHtml = `<!DOCTYPE html>
<html lang="${siteConfig.locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog — ${siteConfig.siteName}</title>
  <meta name="description" content="Latest articles and tutorials from ${siteConfig.siteName}">
  <link rel="canonical" href="${siteConfig.siteUrl}/blog/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Blog — ${siteConfig.siteName}">
  <meta property="og:url" content="${siteConfig.siteUrl}/blog/">
  ${analyticsScript}
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <header>
    <nav>
      <a href="/" class="logo">${siteConfig.siteName}</a>
      <div class="nav-links">
        <a href="/blog/">Blog</a>
        <a href="/docs/">Docs</a>
      </div>
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>Blog</h1>
      <p>Latest articles and tutorials</p>
    </section>
    <section class="posts-list">
      ${postCards || "<p>No posts yet.</p>"}
    </section>
  </main>
  <footer>
    <p>&copy; ${year} ${siteConfig.siteName}. All rights reserved.</p>
    <nav>
      <a href="/">Home</a>
      <a href="/blog/">Blog</a>
      <a href="/docs/">Docs</a>
    </nav>
  </footer>
</body>
</html>`;

  writeFileSync(join(POSTS_OUT, "index.html"), blogIndexHtml, "utf-8");
  console.log(`  ✅ posts/index.html`);
}

// ── 生成文档页面 ─────────────────────────────────────────────────────────────
if (docTemplate) {
  // 生成文档侧边栏导航
  const docsNav = docs.map((d) =>
    `<a href="/docs/${d.slug}.html">${d.title}</a>`
  ).join("\n        ");

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const canonicalUrl = `${siteConfig.siteUrl}/docs/${doc.slug}.html`;

    const prevDoc = i > 0 ? docs[i - 1] : null;
    const nextDoc = i < docs.length - 1 ? docs[i + 1] : null;
    const prevLink = prevDoc
      ? `<a href="/docs/${prevDoc.slug}.html" class="prev">← ${prevDoc.title}</a>`
      : "";
    const nextLink = nextDoc
      ? `<a href="/docs/${nextDoc.slug}.html" class="next">${nextDoc.title} →</a>`
      : "";

    const vars = {
      TITLE: doc.title,
      DESCRIPTION: doc.description,
      KEYWORDS: (doc.keywords || []).join(", "),
      CANONICAL_URL: canonicalUrl,
      SITE_NAME: siteConfig.siteName,
      AUTHOR: doc.author || siteConfig.author,
      LOCALE: doc.locale || siteConfig.locale,
      CONTENT: doc.content || "",
      DOCS_NAV: docsNav,
      PREV_LINK: prevLink,
      NEXT_LINK: nextLink,
      TWITTER_SITE: siteConfig.twitterHandle
        ? `<meta name="twitter:site" content="${siteConfig.twitterHandle}">`
        : "",
      ANALYTICS_SCRIPT: analyticsScript,
      YEAR: String(year),
    };

    const html = render(docTemplate, vars);
    const outPath = join(DOCS_OUT, `${doc.slug}.html`);
    writeFileSync(outPath, html, "utf-8");
    console.log(`  ✅ docs/${doc.slug}.html`);
  }

  // 生成文档目录页
  const docCards = docs.map((d) => `
    <a href="/docs/${d.slug}.html" class="doc-card">
      <h3>${d.title}</h3>
      <p>${d.description}</p>
    </a>`
  ).join("\n");

  const docsIndexHtml = `<!DOCTYPE html>
<html lang="${siteConfig.locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Documentation — ${siteConfig.siteName}</title>
  <meta name="description" content="Documentation for ${siteConfig.siteName}">
  <link rel="canonical" href="${siteConfig.siteUrl}/docs/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Documentation — ${siteConfig.siteName}">
  <meta property="og:url" content="${siteConfig.siteUrl}/docs/">
  ${analyticsScript}
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <header>
    <nav>
      <a href="/" class="logo">${siteConfig.siteName}</a>
      <div class="nav-links">
        <a href="/blog/">Blog</a>
        <a href="/docs/">Docs</a>
      </div>
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>Documentation</h1>
      <p>Everything you need to know</p>
    </section>
    <section class="docs-list">
      ${docCards || "<p>No documentation yet.</p>"}
    </section>
  </main>
  <footer>
    <p>&copy; ${year} ${siteConfig.siteName}. All rights reserved.</p>
    <nav>
      <a href="/">Home</a>
      <a href="/blog/">Blog</a>
      <a href="/docs/">Docs</a>
    </nav>
  </footer>
</body>
</html>`;

  writeFileSync(join(DOCS_OUT, "index.html"), docsIndexHtml, "utf-8");
  console.log(`  ✅ docs/index.html`);
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
  ${analyticsScript}
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
  ...posts.map((p) => ({
    url: `/posts/${p.slug}.html`,
    priority: "0.7",
    changefreq: "monthly",
  })),
  ...docs.map((d) => ({
    url: `/docs/${d.slug}.html`,
    priority: "0.6",
    changefreq: "monthly",
  })),
];
if (posts.length > 0) sitemapUrls.push({ url: "/blog/", priority: "0.7", changefreq: "weekly" });
if (docs.length > 0) sitemapUrls.push({ url: "/docs/", priority: "0.6", changefreq: "weekly" });

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

// ── 生成 llms.txt（AI 搜索引擎友好描述文件） ──────────────────────────────
const llmsLines = [
  `# ${siteConfig.siteName}`,
  "",
  `> ${siteConfig.description}`,
  "",
  "## Tools",
  ...tools.map((t) => `- [${t.title}](${siteConfig.siteUrl}/tools/${t.slug}.html): ${t.description}`),
];
if (posts.length > 0) {
  llmsLines.push("", "## Blog");
  for (const p of posts) {
    llmsLines.push(`- [${p.title}](${siteConfig.siteUrl}/posts/${p.slug}.html): ${p.description}`);
  }
}
if (docs.length > 0) {
  llmsLines.push("", "## Documentation");
  for (const d of docs) {
    llmsLines.push(`- [${d.title}](${siteConfig.siteUrl}/docs/${d.slug}.html): ${d.description}`);
  }
}
llmsLines.push("", "## Optional", `- [Sitemap](${siteConfig.siteUrl}/sitemap.xml)`, "");
writeFileSync(join(PUBLIC, "llms.txt"), llmsLines.join("\n"), "utf-8");
console.log(`  ✅ llms.txt (AI search friendly)`);

const totalTools = tools.length;
const totalPosts = posts.length;
const totalDocs = docs.length;
const totalIndexPages = 1 + (totalPosts > 0 ? 1 : 0) + (totalDocs > 0 ? 1 : 0);
const totalPages = totalTools + totalPosts + totalDocs + totalIndexPages;

console.log(`\n✅ Generated ${totalPages} pages (${totalTools} tools, ${totalPosts} posts, ${totalDocs} docs) + sitemap + robots.txt`);
