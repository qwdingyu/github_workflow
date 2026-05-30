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

// ── 构建计时 ──────────────────────────────────────────────────────────────────
const buildStart = Date.now();

// ── OG Image SVG 生成器 ───────────────────────────────────────────────────────
function generateOgImageSvg(title, siteName, type = "tool") {
  const typeLabel = { tool: "🔧 Tool", post: "📝 Article", doc: "📄 Documentation" }[type] || "Tool";
  const safeTitle = title.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const safeSiteName = siteName.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  
  // 截断过长标题
  const displayTitle = safeTitle.length > 60 ? safeTitle.slice(0, 57) + "..." : safeTitle;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f1117;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1a1d27;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="600" y="80" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="#9ca3af" text-anchor="middle">${typeLabel}</text>
  <text x="600" y="300" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="700" fill="#e4e4e7" text-anchor="middle">${displayTitle}</text>
  <text x="600" y="560" font-family="system-ui, -apple-system, sans-serif" font-size="32" fill="#6366f1" text-anchor="middle">${safeSiteName}</text>
</svg>`;
}

// ── 安全 JSON 解析 ────────────────────────────────────────────────────────────
function safeJsonParse(filePath, description) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(`❌ ${description} 不存在: ${filePath}`);
      process.exit(1);
    }
    if (err instanceof SyntaxError) {
      console.error(`❌ ${description} JSON 语法错误: ${filePath}`);
      console.error(`   ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

// ── 安全读取目录中的 JSON 文件 ────────────────────────────────────────────────
function readJsonDir(dirPath, description) {
  if (!existsSync(dirPath)) return [];
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => {
    const fullPath = join(dirPath, f);
    const data = safeJsonParse(fullPath, `${description}/${f}`);
    // 输入验证：检查必填字段
    if (!data.slug) {
      console.error(`❌ ${description}/${f}: 缺少必填字段 "slug"`);
      process.exit(1);
    }
    if (!data.title) {
      console.error(`❌ ${description}/${f}: 缺少必填字段 "title"`);
      process.exit(1);
    }
    return data;
  });
}

// ── 读取配置 ──────────────────────────────────────────────────────────────────
const siteConfig = safeJsonParse(join(SRC, "seo-config.json"), "站点配置文件");

// 验证配置必填字段
if (!siteConfig.siteName) {
  console.error("❌ seo-config.json: 缺少必填字段 siteName");
  process.exit(1);
}
if (!siteConfig.siteUrl) {
  console.error("❌ seo-config.json: 缺少必填字段 siteUrl");
  process.exit(1);
}

const toolTemplatePath = join(SRC, "templates", "tool.html");
if (!existsSync(toolTemplatePath)) {
  console.error(`❌ 工具模板不存在: ${toolTemplatePath}`);
  process.exit(1);
}
const toolTemplate = readFileSync(toolTemplatePath, "utf-8");

// ── 读取所有工具定义 ──────────────────────────────────────────────────────────
const toolsDir = join(SRC, "tools");
if (!existsSync(toolsDir)) {
  console.error(`❌ 工具目录不存在: ${toolsDir}`);
  console.error(`   请创建 src/tools/ 目录并添加工具 JSON 文件`);
  process.exit(1);
}
const tools = readJsonDir(toolsDir, "工具");

// ── 读取博客文章 ──────────────────────────────────────────────────────────────
const postsDir = join(SRC, "posts");
const posts = readJsonDir(postsDir, "博客")
  .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

// ── 读取文档页面 ──────────────────────────────────────────────────────────────
const docsDir = join(SRC, "docs");
const docs = readJsonDir(docsDir, "文档")
  .sort((a, b) => (a.order || 0) - (b.order || 0));

console.log(`📦 Site: ${siteConfig.siteName}`);
console.log(`🔧 Tools: ${tools.length} found`);
console.log(`📝 Posts: ${posts.length} found`);
console.log(`📄 Docs: ${docs.length} found`);

// ── 确保输出目录存在 ──────────────────────────────────────────────────────────
const POSTS_OUT = join(PUBLIC, "posts");
const DOCS_OUT = join(PUBLIC, "docs");
const IMAGES_OUT = join(PUBLIC, "images");
if (!existsSync(TOOLS_OUT)) mkdirSync(TOOLS_OUT, { recursive: true });
if (!existsSync(POSTS_OUT)) mkdirSync(POSTS_OUT, { recursive: true });
if (!existsSync(DOCS_OUT)) mkdirSync(DOCS_OUT, { recursive: true });
if (!existsSync(IMAGES_OUT)) mkdirSync(IMAGES_OUT, { recursive: true });

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

// ── 生成面包屑 HTML 导航 ─────────────────────────────────────────────────────
function generateBreadcrumbHtml(items) {
  if (!items || items.length === 0) return "";
  return `<nav class="breadcrumb" aria-label="面包屑导航">
    ${items.map((item, i) => {
      const isLast = i === items.length - 1;
      if (isLast) {
        return `<span class="current">${item.name}</span>`;
      }
      return `<a href="${item.url || "/"}">${item.name}</a><span class="separator">/</span>`;
    }).join("\n    ")}
  </nav>`;
}

// ── 生成相关工具推荐 HTML ─────────────────────────────────────────────────────
function generateRelatedToolsHtml(currentSlug, tools) {
  if (!tools || tools.length <= 1) return "";
  const related = tools.filter((t) => t.slug !== currentSlug).slice(0, 4);
  if (related.length === 0) return "";
  
  const cards = related.map((t) => `
    <a href="/tools/${t.slug}.html" class="related-tool-card">
      <div class="tool-icon">${t.icon || "🔧"}</div>
      <h4>${t.title}</h4>
      <p>${t.description.slice(0, 80)}${t.description.length > 80 ? "..." : ""}</p>
    </a>`).join("\n");
  
  return `<section class="related-tools">
    <h3>相关工具</h3>
    <div class="related-tools-grid">
      ${cards}
    </div>
  </section>`;
}

// ── 生成 FAQ HTML ─────────────────────────────────────────────────────────────
function generateFaqHtml(faq) {
  if (!faq || faq.length === 0) return "<p>暂无常见问题。</p>";
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
        <textarea id="input" placeholder="在此粘贴输入内容..." rows="10"></textarea>
      </div>
      <div class="tool-actions">
        <button onclick="processTool('${tool.slug}')" class="btn-primary">处理</button>
        <button onclick="copyOutput()" class="btn-secondary">复制输出</button>
        <button onclick="clearAll()" class="btn-secondary">清空</button>
      </div>
      <div class="tool-output">
        <textarea id="output" placeholder="输出结果将显示在此处..." rows="10" readonly></textarea>
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
  const ogImageUrl = `${siteConfig.siteUrl}/images/${tool.slug}.svg`;
  
  // 生成 og:image SVG
  const ogImageSvg = generateOgImageSvg(tool.title, siteConfig.siteName, "tool");
  writeFileSync(join(IMAGES_OUT, `${tool.slug}.svg`), ogImageSvg, "utf-8");

  // 生成面包屑数据
  const breadcrumbItems = [
    { name: siteConfig.siteName, url: "/" },
    { name: "工具", url: "/tools/" },
    { name: tool.title },
  ];

  const vars = {
    TITLE: tool.title,
    DESCRIPTION: tool.description,
    KEYWORDS: tool.keywords.join(", "),
    CANONICAL_URL: canonicalUrl,
    SITE_NAME: siteConfig.siteName,
    AUTHOR: siteConfig.author,
    LOCALE: siteConfig.locale,
    OG_IMAGE: ogImageUrl,
    TWITTER_SITE: siteConfig.twitterHandle
      ? `<meta name="twitter:site" content="${siteConfig.twitterHandle}">`
      : "",
    FAQ_SCHEMA: generateFaqSchema(tool.faq),
    BREADCRUMB_SCHEMA: generateBreadcrumbSchema(siteConfig.siteName, siteConfig.siteUrl, breadcrumbItems),
    BREADCRUMB_HTML: generateBreadcrumbHtml(breadcrumbItems),
    RELATED_TOOLS: generateRelatedToolsHtml(tool.slug, tools),
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
    const ogImageUrl = `${siteConfig.siteUrl}/images/${post.slug}.svg`;
    const dateObj = post.date ? new Date(post.date) : new Date();
    const dateIso = dateObj.toISOString();
    const dateDisplay = dateObj.toLocaleDateString(toBcp47(post.locale || siteConfig.locale), {
      year: "numeric", month: "long", day: "numeric"
    });
    
    // 生成 og:image SVG
    const ogImageSvg = generateOgImageSvg(post.title, siteConfig.siteName, "post");
    writeFileSync(join(IMAGES_OUT, `${post.slug}.svg`), ogImageSvg, "utf-8");

    // 生成面包屑数据
    const breadcrumbItems = [
      { name: siteConfig.siteName, url: "/" },
      { name: "博客", url: "/blog/" },
      { name: post.title },
    ];

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
      OG_IMAGE: ogImageUrl,
      BREADCRUMB_SCHEMA: generateBreadcrumbSchema(siteConfig.siteName, siteConfig.siteUrl, breadcrumbItems),
      BREADCRUMB_HTML: generateBreadcrumbHtml(breadcrumbItems),
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

  // 生成博客列表页 og:image
  const blogOgImageUrl = `${siteConfig.siteUrl}/images/blog.svg`;
  const blogOgImageSvg = generateOgImageSvg("Blog", siteConfig.siteName, "post");
  writeFileSync(join(IMAGES_OUT, "blog.svg"), blogOgImageSvg, "utf-8");

  const blogIndexHtml = `<!DOCTYPE html>
<html lang="${siteConfig.locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>博客 — ${siteConfig.siteName}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="来自${siteConfig.siteName}的最新文章和教程">
  <link rel="canonical" href="${siteConfig.siteUrl}/blog/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="博客 — ${siteConfig.siteName}">
  <meta property="og:description" content="来自${siteConfig.siteName}的最新文章和教程">
  <meta property="og:url" content="${siteConfig.siteUrl}/blog/">
  <meta property="og:site_name" content="${siteConfig.siteName}">
  <meta property="og:image" content="${blogOgImageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="博客 — ${siteConfig.siteName}">
  <meta name="twitter:description" content="来自${siteConfig.siteName}的最新文章和教程">
  <meta name="twitter:image" content="${blogOgImageUrl}">
  ${analyticsScript}
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <header>
    <nav>
      <a href="/" class="logo">${siteConfig.siteName}</a>
      <div class="nav-links">
        <a href="/blog/">博客</a>
        <a href="/docs/">文档</a>
      </div>
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>博客</h1>
      <p>最新文章和教程</p>
    </section>
    <section class="posts-list">
      ${postCards || "<p>暂无文章。</p>"}
    </section>
  </main>
  <footer>
    <p>&copy; ${year} ${siteConfig.siteName} 版权所有</p>
    <nav>
      <a href="/">首页</a>
      <a href="/blog/">博客</a>
      <a href="/docs/">文档</a>
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
    const ogImageUrl = `${siteConfig.siteUrl}/images/${doc.slug}.svg`;

    const prevDoc = i > 0 ? docs[i - 1] : null;
    const nextDoc = i < docs.length - 1 ? docs[i + 1] : null;
    const prevLink = prevDoc
      ? `<a href="/docs/${prevDoc.slug}.html" class="prev">← ${prevDoc.title}</a>`
      : "";
    const nextLink = nextDoc
      ? `<a href="/docs/${nextDoc.slug}.html" class="next">${nextDoc.title} →</a>`
      : "";
    
    // 生成 og:image SVG
    const ogImageSvg = generateOgImageSvg(doc.title, siteConfig.siteName, "doc");
    writeFileSync(join(IMAGES_OUT, `${doc.slug}.svg`), ogImageSvg, "utf-8");

    // 生成面包屑数据
    const breadcrumbItems = [
      { name: siteConfig.siteName, url: "/" },
      { name: "文档", url: "/docs/" },
      { name: doc.title },
    ];

    const vars = {
      TITLE: doc.title,
      DESCRIPTION: doc.description,
      KEYWORDS: (doc.keywords || []).join(", "),
      CANONICAL_URL: canonicalUrl,
      SITE_NAME: siteConfig.siteName,
      AUTHOR: doc.author || siteConfig.author,
      LOCALE: doc.locale || siteConfig.locale,
      CONTENT: doc.content || "",
      OG_IMAGE: ogImageUrl,
      BREADCRUMB_SCHEMA: generateBreadcrumbSchema(siteConfig.siteName, siteConfig.siteUrl, breadcrumbItems),
      BREADCRUMB_HTML: generateBreadcrumbHtml(breadcrumbItems),
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

  // 生成文档列表页 og:image
  const docsOgImageUrl = `${siteConfig.siteUrl}/images/docs.svg`;
  const docsOgImageSvg = generateOgImageSvg("文档", siteConfig.siteName, "doc");
  writeFileSync(join(IMAGES_OUT, "docs.svg"), docsOgImageSvg, "utf-8");

  const docsIndexHtml = `<!DOCTYPE html>
<html lang="${siteConfig.locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>文档 — ${siteConfig.siteName}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="${siteConfig.siteName}的使用文档">
  <link rel="canonical" href="${siteConfig.siteUrl}/docs/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="文档 — ${siteConfig.siteName}">
  <meta property="og:description" content="${siteConfig.siteName}的使用文档">
  <meta property="og:url" content="${siteConfig.siteUrl}/docs/">
  <meta property="og:site_name" content="${siteConfig.siteName}">
  <meta property="og:image" content="${docsOgImageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="文档 — ${siteConfig.siteName}">
  <meta name="twitter:description" content="${siteConfig.siteName}的使用文档">
  <meta name="twitter:image" content="${docsOgImageUrl}">
  ${analyticsScript}
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <header>
    <nav>
      <a href="/" class="logo">${siteConfig.siteName}</a>
      <div class="nav-links">
        <a href="/blog/">博客</a>
        <a href="/docs/">文档</a>
      </div>
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>文档</h1>
      <p>你需要知道的一切</p>
    </section>
    <section class="docs-list">
      ${docCards || "<p>暂无文档。</p>"}
    </section>
  </main>
  <footer>
    <p>&copy; ${year} ${siteConfig.siteName} 版权所有</p>
    <nav>
      <a href="/">首页</a>
      <a href="/blog/">博客</a>
      <a href="/docs/">文档</a>
    </nav>
  </footer>
</body>
</html>`;

  writeFileSync(join(DOCS_OUT, "index.html"), docsIndexHtml, "utf-8");
  console.log(`  ✅ docs/index.html`);
}

// ── 生成首页（工具列表） ─────────────────────────────────────────────────────
// 生成首页 og:image
const indexOgImageUrl = `${siteConfig.siteUrl}/images/index.svg`;
const indexOgImageSvg = generateOgImageSvg(siteConfig.siteName, siteConfig.siteName, "tool");
writeFileSync(join(IMAGES_OUT, "index.svg"), indexOgImageSvg, "utf-8");

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
<html lang="${siteConfig.locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteConfig.siteName} — ${siteConfig.description}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="${siteConfig.description}">
  <link rel="canonical" href="${siteConfig.siteUrl}/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${siteConfig.siteName}">
  <meta property="og:description" content="${siteConfig.description}">
  <meta property="og:url" content="${siteConfig.siteUrl}/">
  <meta property="og:site_name" content="${siteConfig.siteName}">
  <meta property="og:image" content="${indexOgImageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${siteConfig.siteName}">
  <meta name="twitter:description" content="${siteConfig.description}">
  <meta name="twitter:image" content="${indexOgImageUrl}">
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
const today = new Date().toISOString().split("T")[0];
const sitemapUrls = [
  { url: "/", priority: "1.0", changefreq: "weekly", lastmod: today },
  ...tools.map((t) => ({
    url: `/tools/${t.slug}.html`,
    priority: "0.8",
    changefreq: "monthly",
    lastmod: t.updated || today,
  })),
  ...posts.map((p) => ({
    url: `/posts/${p.slug}.html`,
    priority: "0.7",
    changefreq: "monthly",
    lastmod: p.date || today,
  })),
  ...docs.map((d) => ({
    url: `/docs/${d.slug}.html`,
    priority: "0.6",
    changefreq: "monthly",
    lastmod: d.updated || today,
  })),
];
if (posts.length > 0) sitemapUrls.push({ url: "/blog/", priority: "0.7", changefreq: "weekly", lastmod: today });
if (docs.length > 0) sitemapUrls.push({ url: "/docs/", priority: "0.6", changefreq: "weekly", lastmod: today });

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map(
    (u) => `  <url>
    <loc>${siteConfig.siteUrl}${u.url}</loc>
    <lastmod>${u.lastmod}</lastmod>
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

const buildTime = Date.now() - buildStart;
console.log(`\n✅ Generated ${totalPages} pages (${totalTools} tools, ${totalPosts} posts, ${totalDocs} docs) + sitemap + robots.txt`);
console.log(`⏱️  Build time: ${buildTime}ms`);
