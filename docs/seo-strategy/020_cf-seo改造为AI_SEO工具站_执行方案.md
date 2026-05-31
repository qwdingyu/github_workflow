# cf-seo 改造方案：AI SEO 工具站

> **日期**：2026-05-29
> **核心决策**：废弃 10,000 篇 AI 文章生成，改造为 20 个 SEO 专业工具集合站
> **技术栈**：Eleventy + Cloudflare Pages（纯前端，零服务器成本）
> **目标用户**：海外 SEO 从业者、站长、内容创作者（全英文界面）
> **参考项目**：cf-calculators（已验证的 Eleventy 工具站架构）

---

## 一、为什么要改造

### 当前 cf-seo 的问题（代码审查结论）

`scripts/generate-topics.mjs`（263 行）用 15 个标题模板 + 100 个分类，批量拼接出 10,000 篇文章。

**逐行审查发现**：

```javascript
// generate-topics.mjs 第 160-187 行
function generateContent(topic, cat, intent, idx) {
  const h2Sections = [
    { heading: `What Is ${topic}?`, body: `${topic} is a key concept in ${cat.name.toLowerCase()}
      that affects how professionals approach ${kw}. Understanding ${topic} is essential...` },
    // ... 4 个 H2 全部同一模板
  ];
}
```

**生成的实际内容示例**：
> "Cloud Computing 2 is a key concept in cloud computing that affects how professionals approach cloud, aws, azure."

问题：
1. "Cloud Computing 2" 不是真实存在的搜索词，用户不会搜
2. 每篇 ~300 词，远低于 Google 高质量标准（1500+）
3. 10,000 篇结构 100% 相同，Google "Scalable Content Abuse" 直接命中
4. 2025 下半年 Google 算法已转向打击 AI 模板内容（来源：Grizzly Peak Software, 2026-03）

**结论**：当前路线 = 浪费时间，不可能排名，不可能变现。

### 为什么选 SEO 工具站

| 维度 | AI 文章站（当前） | SEO 工具站（改造后） |
|------|-----------------|-------------------|
| Google 态度 | 🔴 2025 后严厉打击 | 🟢 工具页面持续友好 |
| 用户行为 | 5 秒跳出 | 反复使用、收藏、回访 |
| 内容护城河 | 无（可复制） | 代码实现 = 壁垒 |
| AI 搜索影响 | 被 AI 直接回答替代 | AI 引用工具站 |
| 品牌一致性 | "SEO Hub" 但内容泛化 | "SEO 工具站" 名正言顺 |
| 与 cf-calculators 关系 | 重叠（都泛） | 互补（calculators=开发者，seo=SEO） |
| 变现效率 | 需要 10 万+ PV | 1 万 PV 即可 |

---

## 二、工具清单（20 个，全部纯前端可实现）

### 第一优先级：刚需 + 低开发成本（先做这 8 个）

| # | 工具 | 核心关键词 | 月搜索量 | 技术难度 | 开发时间 |
|---|------|-----------|---------|---------|---------|
| 1 | Meta Tag Generator | "meta tag generator" | 22K | ⭐ | 1 天 |
| 2 | Schema.org Generator | "schema markup generator" | 14K | ⭐⭐ | 2 天 |
| 3 | Robots.txt Generator | "robots txt generator" | 9K | ⭐ | 半天 |
| 4 | Sitemap Generator | "xml sitemap generator" | 18K | ⭐ | 1 天 |
| 5 | Keyword Density Checker | "keyword density checker" | 18K | ⭐ | 半天 |
| 6 | SERP Preview Tool | "serp preview tool" | 9K | ⭐ | 1 天 |
| 7 | Open Graph Preview | "og image preview" | 14K | ⭐ | 1 天 |
| 8 | Character Counter | "meta description character counter" | 14K | ⭐ | 半天 |

**8 个工具合计月搜索量：~120K**
**开发时间：~8 天（约 2 周工作）**

### 第二优先级：专业 SEO 工具（第 3-4 周）

| # | 工具 | 核心关键词 | 月搜索量 | 技术难度 | 开发时间 |
|---|------|-----------|---------|---------|---------|
| 9 | Title Tag Preview | "google title preview" | 12K | ⭐ | 半天 |
| 10 | Heading Structure Analyzer | "heading analyzer" | 5K | ⭐ | 半天 |
| 11 | Content Readability Score | "readability score checker" | 22K | ⭐ | 1 天 |
| 12 | Slug Generator | "url slug generator" | 9K | ⭐ | 半天 |
| 13 | Canonical URL Checker | "canonical url checker" | 5K | ⭐ | 半天 |
| 14 | Alt Text Suggestion | "alt text generator" | 9K | ⭐ | 1 天 |
| 15 | Internal Link Analyzer | "internal link checker" | 5K | ⭐⭐ | 1 天 |
| 16 | Broken Link Checker | "broken link checker" | 22K | ⭐⭐ | 1 天 |

**8 个工具合计月搜索量：~90K**
**开发时间：~7 天（约 2 周工作）**

### 第三优先级：扩展工具（第 5-6 周）

| # | 工具 | 核心关键词 | 月搜索量 | 技术难度 | 开发时间 |
|---|------|-----------|---------|---------|---------|
| 17 | Meta Description Generator | "meta description writer" | 14K | ⭐ | 1 天 |
| 18 | SEO Score Checker | "seo score checker" | 30K | ⭐⭐ | 2 天 |
| 19 | Content Gap Analyzer | "content gap analysis" | 9K | ⭐⭐ | 2 天 |
| 20 | Redirect Checker | "redirect checker tool" | 14K | ⭐⭐ | 1 天 |

**4 个工具合计月搜索量：~67K**
**开发时间：~6 天（约 1.5 周工作）**

### 总计

| 指标 | 数值 |
|------|------|
| 工具总数 | 20 个 |
| 合计月搜索量 | ~277K |
| 总开发时间 | ~21 天（约 5 周） |
| 部署成本 | $0（Cloudflare Pages Free） |
| 域名成本 | ~$10/年 |

---

## 三、技术架构（复刻 cf-calculators 已验证架构）

### 3.1 cf-calculators 的架构（参考基准）

```
cf-calculators/src/
├── _data/
│   └── tools.json          # 工具元数据（slug, title, description, keywords, category, icon, type, faq）
├── _includes/
│   ├── social-insurance-calculator.njk   # 计算器专属 UI
│   └── income-tax-calculator.njk
├── _layouts/
│   └── base.njk            # 全局布局
├── tools.njk               # 工具页面模板（pagination 按 tools.json 生成页面）
├── tools-index.njk         # 工具列表页
├── index.njk               # 首页
├── sitemap.njk / robots.txt
└── assets/js/
    ├── social-insurance-calculator.js    # 工具逻辑
    └── income-tax-calculator.js
```

**核心机制**：
1. `tools.json` 定义元数据（含 FAQ）
2. `tools.njk` 用 Eleventy pagination 为每个 tool 生成一页
3. 计算器类：`{% include tool.slug ~ '.njk' %}` 加载专属 UI + `<script src="{{ tool.slug }}.js">`
4. 普通工具类：统一表单 UI + `<script src="{{ tool.slug }}.js">` 定义 `processTool()`
5. 自动输出 SoftwareApplication + FAQPage JSON-LD Schema
6. 同分类工具自动显示为"相关工具"

### 3.2 cf-seo 改造后的架构

```
cf-seo/src/
├── _data/
│   ├── config.json         # 站点配置（改造 siteName, description）
│   ├── tools.json          # SEO 工具元数据（新建，格式同 cf-calculators）
│   └── buildDate.js        # 构建时间戳（保留）
├── _includes/
│   ├── meta-tag-generator.njk          # 复杂工具的专属 UI
│   ├── schema-generator.njk
│   └── seo-score-checker.njk
├── _layouts/
│   └── base.njk            # 全局布局（保留，修改导航为英文）
├── tools.njk               # 工具页面模板（从 cf-calculators 移植，改为英文）
├── tools-index.njk         # 工具列表页（从 cf-calculators 移植，改为英文）
├── index.njk               # 首页（改造为工具分类展示）
├── sitemap.njk             # XML Sitemap（保留，改为 tools 数据源）
├── robots.txt              # 保留
├── about.njk               # 改为工具站介绍
├── privacy.njk / terms.njk / 404.njk  # 保留
├── og-image.svg / favicon.svg          # 保留
└── assets/js/
    ├── meta-tag-generator.js
    ├── schema-generator.js
    ├── robots-generator.js
    ├── sitemap-generator.js
    ├── keyword-density.js
    ├── serp-preview.js
    ├── og-preview.js
    ├── character-counter.js
    └── ...                 # 每个工具一个 JS 文件
```

### 3.3 需要删除的文件

| 文件 | 原因 |
|------|------|
| `scripts/generate-topics.mjs` | AI 内容生成脚本 |
| `src/_data/topics.json` | 25MB AI 模板内容 |
| `src/_data/seoTopics.js` | 加载 topics.json |
| `src/_data/categoryIndex.js` | 基于 topics.json |
| `src/_data/categories.js` | 基于 topics.json |
| `src/topic.njk` | 文章详情页（10,000 页） |
| `src/topics-index.njk` | 分类索引（100 页） |
| `src/topics-all.njk` | 文章列表分页（200 页） |

### 3.4 需要保留并改造的文件

| 文件 | 操作 |
|------|------|
| `.eleventy.js` | 保留 Filters，移除 `templateFormats` 中的 `"md"`，移除 `markdownTemplateEngine` |
| `src/_layouts/base.njk` | 导航改为英文，菜单改为工具分类链接 |
| `src/_data/config.json` | 修改 siteName、description、author |
| `src/index.njk` | 改为工具分类列表 + 热门工具 |
| `src/sitemap.njk` | 数据源从 seoTopics 改为 tools |
| `src/about.njk` | 内容改为工具站介绍 |

---

## 四、核心文件实现

### 4.1 `src/_data/tools.json`（工具元数据）

格式完全参照 cf-calculators 的 `tools.json`：

```json
[
  {
    "slug": "meta-tag-generator",
    "title": "Meta Tag Generator",
    "description": "Generate SEO-optimized meta tags including title, description, OG tags, and Twitter Cards. Preview how your page looks in search results.",
    "keywords": ["meta tag generator", "og tags", "twitter cards", "seo meta tags", "open graph"],
    "category": "SEO Generators",
    "icon": "🏷️",
    "type": "tool",
    "faq": [
      {
        "question": "What are meta tags?",
        "answer": "Meta tags are HTML elements that provide metadata about a webpage to search engines and social media platforms. They include title tags, meta descriptions, Open Graph tags, and Twitter Card tags."
      },
      {
        "question": "What is the ideal meta description length?",
        "answer": "The ideal meta description is 150-160 characters. Google typically displays up to 160 characters in search results. Descriptions longer than this may be truncated."
      },
      {
        "question": "Do Open Graph tags affect SEO?",
        "answer": "Open Graph tags do not directly affect Google search rankings, but they control how your content appears when shared on Facebook, LinkedIn, and other social platforms. Proper OG tags improve click-through rates from social media."
      }
    ]
  },
  {
    "slug": "schema-markup-generator",
    "title": "Schema.org Markup Generator",
    "description": "Generate JSON-LD structured data for Article, FAQ, Product, LocalBusiness, and more. Validated against Google's Rich Results Test.",
    "keywords": ["schema markup generator", "json-ld generator", "structured data", "rich snippets", "schema.org"],
    "category": "SEO Generators",
    "icon": "📋",
    "type": "tool",
    "faq": [
      {
        "question": "What is Schema.org markup?",
        "answer": "Schema.org markup is structured data that you add to your HTML to help search engines understand your content better. It can enable rich results like star ratings, FAQs, and event details in search results."
      },
      {
        "question": "Which schema types are most useful?",
        "answer": "The most impactful schema types are: FAQPage (shows questions in search results), Article (richer search listing), Product (price and rating display), and LocalBusiness (map and hours display)."
      }
    ]
  },
  {
    "slug": "robots-txt-generator",
    "title": "Robots.txt Generator",
    "description": "Create a valid robots.txt file to control search engine crawling. Support for multiple user-agents, disallow rules, and sitemap references.",
    "keywords": ["robots txt generator", "robots.txt", "crawler control", "web crawling", "search engine robots"],
    "category": "SEO Generators",
    "icon": "🤖",
    "type": "tool",
    "faq": [
      {
        "question": "What does robots.txt do?",
        "answer": "Robots.txt is a file placed in your website's root directory that tells search engine crawlers which pages or files they can or cannot request from your site."
      },
      {
        "question": "Does robots.txt block all access?",
        "answer": "No. Robots.txt is a guideline, not a security measure. Well-behaved crawlers respect it, but malicious bots may ignore it. For true access control, use authentication or server-side rules."
      }
    ]
  }
]
```

**工具分类**：

```
SEO Generators:    Meta Tag, Schema.org, Robots.txt, Sitemap, Slug Generator
SEO Analyzers:     Keyword Density, Heading Structure, Readability Score, Canonical URL, Internal Link, Broken Link
SEO Previews:      SERP Preview, Open Graph Preview, Title Tag Preview
SEO Writers:       Alt Text Suggestion, Meta Description Generator, SEO Score Checker, Content Gap Analyzer, Redirect Checker
```

### 4.2 `src/tools.njk`（工具页面模板）

从 cf-calculators 移植，改为英文：

```njk
---
layout: base.njk
pagination:
  data: tools
  size: 1
  alias: tool
permalink: "/tools/{{ tool.slug }}/"
eleventyComputed:
  title: "{{ tool.title }} — Free Online SEO Tool"
  description: "{{ tool.description }}"
  keywords: "{% if tool.keywords %}{{ tool.keywords | join(', ') }}{% endif %}"
  canonical: "{{ config.url }}{{ page.url }}"
---

<section class="tool-page">
  <article>
    <header>
      <h1>{{ tool.title }}</h1>
      <p class="description">{{ tool.description }}</p>
    </header>

    {% if tool.type == 'tool-with-ui' %}
    {% include tool.slug ~ '.njk' %}
    <script src="/assets/js/{{ tool.slug }}.js" defer></script>
    {% else %}
    <form class="tool-content tool-form" onsubmit="processTool(); return false;">
      <div class="tool-area">
        <div class="tool-input">
          <textarea id="input" rows="6" placeholder="Enter text to process..."></textarea>
        </div>
        <div class="tool-actions">
          <button type="submit" class="btn-primary">Process</button>
          <button type="button" class="btn-secondary" onclick="copyOutput()">Copy</button>
          <button type="button" class="btn-secondary" onclick="clearAll()">Clear</button>
        </div>
        <div class="tool-output">
          <textarea id="output" rows="6" readonly placeholder="Result will appear here..."></textarea>
        </div>
      </div>
    </form>
    <script src="/assets/js/{{ tool.slug }}.js" defer></script>
    {% endif %}

    {% if tool.faq and tool.faq.length > 0 %}
    <section class="faq">
      <h2>Frequently Asked Questions</h2>
      {% for item in tool.faq %}
      <details>
        <summary>{{ item.question }}</summary>
        <p>{{ item.answer }}</p>
      </details>
      {% endfor %}
    </section>

    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        {% for item in tool.faq %}
        {
          "@type": "Question",
          "name": "{{ item.question }}",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "{{ item.answer }}"
          }
        }{% if not loop.last %},{% endif %}
        {% endfor %}
      ]
    }
    </script>
    {% endif %}

    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "{{ tool.title }}",
      "url": "{{ canonical | default(config.url ~ page.url) }}",
      "description": "{{ tool.description }}",
      "applicationCategory": "UtilitiesApplication",
      "operatingSystem": "Web",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      }
    }
    </script>

    <section class="related-tools">
      <h2>Related Tools</h2>
      <div class="related-tools-grid">
        {% set related_count = 0 %}
        {% for related in tools %}
        {% if related.slug != tool.slug and related.category == tool.category and related_count < 3 %}
        <a href="/tools/{{ related.slug }}/" class="related-tool-card">
          <span class="tool-icon">{{ related.icon | default('🔧') }}</span>
          <h4>{{ related.title }}</h4>
        </a>
        {% set related_count = related_count + 1 %}
        {% endif %}
        {% endfor %}
      </div>
    </section>
  </article>
</section>
```

### 4.3 `src/_data/config.json`（改造后）

```json
{
  "siteName": "SEOTools",
  "description": "Free online SEO tools — meta tag generator, schema markup, robots.txt, sitemap, keyword analysis, and more. No signup required.",
  "locale": "en-US",
  "url": "https://seotools.dev",
  "author": "SEOTools"
}
```

### 4.4 `.eleventy.js`（改造后）

从 cf-calculators 的简洁版本出发：

```javascript
import { EleventyHtmlBasePlugin } from "@11ty/eleventy";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("src/favicon.svg");
  eleventyConfig.addPassthroughCopy("src/og-image.svg");
  eleventyConfig.addPassthroughCopy("_headers");
  eleventyConfig.addPassthroughCopy("src/robots.txt");

  // Filters
  eleventyConfig.addFilter("unique", (array) => [...new Set(array)]);
  eleventyConfig.addFilter("map", (array, prop) =>
    Array.isArray(array) ? array.map((item) => item?.[prop]) : []
  );
  eleventyConfig.addFilter("slice", (array, start, end) =>
    Array.isArray(array) ? array.slice(start, end) : []
  );
  eleventyConfig.addFilter("slugify", (str) =>
    typeof str === "string"
      ? str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      : ""
  );

  eleventyConfig.addGlobalData("currentYear", () => new Date().getFullYear());

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_layouts",
      data: "_data",
    },
    templateFormats: ["njk", "js"],
  };
};
```

---

## 五、MVP 工具实现示例

### 5.1 Keyword Density Checker（最简单，第一个做）

**`src/assets/js/keyword-density.js`**：

```javascript
function processTool() {
  const text = document.getElementById("input").value;
  if (!text.trim()) {
    document.getElementById("output").value = "Please enter some text.";
    return;
  }

  // Remove HTML tags
  const clean = text.replace(/<[^>]*>/g, "");
  // Remove stop words
  const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","by","is","it","this","that","are","was","were","be","has","have","had","do","does","did","will","would","could","should","may","might","shall","can","not","no","yes","from","as","into","through","during","before","after","above","below","between","out","off","over","under","about","up","down","if","then","than","too","very","just","also","so","more","most","some","any","all","each","every","both","few","own","same","other","such","only","its","i","me","my","we","our","you","your","he","him","his","she","her","they","them","their","what","which","who","whom","where","when","why","how"]);

  const words = clean.toLowerCase().match(/\b[a-z]{2,}\b/g) || [];
  const filtered = words.filter(w => !stopWords.has(w));

  if (filtered.length === 0) {
    document.getElementById("output").value = "No meaningful words found.";
    return;
  }

  // Count frequency
  const freq = {};
  for (const w of filtered) {
    freq[w] = (freq[w] || 0) + 1;
  }

  // Build output
  const total = filtered.length;
  const lines = [
    `Total words: ${words.length}`,
    `Content words (excl. stop words): ${total}`,
    `Unique words: ${Object.keys(freq).length}`,
    "",
    "Keyword\tCount\tDensity",
    "------\t-----\t------"
  ];

  Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([word, count]) => {
      const density = ((count / total) * 100).toFixed(1);
      lines.push(`${word}\t${count}\t${density}%`);
    });

  document.getElementById("output").value = lines.join("\n");
}

function copyOutput() {
  const output = document.getElementById("output");
  navigator.clipboard.writeText(output.value);
}

function clearAll() {
  document.getElementById("input").value = "";
  document.getElementById("output").value = "";
}
```

### 5.2 SERP Preview Tool

**`src/_includes/serp-preview.njk`**（专属 UI，因为需要特殊布局）：

```njk
<div class="serp-preview-tool">
  <div class="serp-inputs">
    <label for="serp-title">Page Title</label>
    <div class="input-with-counter">
      <input type="text" id="serp-title" maxlength="70" placeholder="Enter your page title...">
      <span class="char-count" id="title-count">0/60 chars</span>
    </div>

    <label for="serp-description">Meta Description</label>
    <div class="input-with-counter">
      <textarea id="serp-description" rows="2" maxlength="320" placeholder="Enter your meta description..."></textarea>
      <span class="char-count" id="desc-count">0/160 chars</span>
    </div>

    <label for="serp-url">URL</label>
    <input type="text" id="serp-url" placeholder="https://example.com/your-page">
  </div>

  <div class="serp-preview-label">Google Search Preview</div>
  <div class="serp-preview-box" id="serp-preview">
    <div class="serp-url-preview" id="preview-url">https://example.com</div>
    <div class="serp-title-preview" id="preview-title">Your Page Title Will Appear Here</div>
    <div class="serp-desc-preview" id="preview-desc">Your meta description will appear here. This is how Google displays it in search results.</div>
  </div>
</div>
```

**`src/assets/js/serp-preview.js`**：

```javascript
document.addEventListener("DOMContentLoaded", () => {
  const title = document.getElementById("serp-title");
  const desc = document.getElementById("serp-description");
  const url = document.getElementById("serp-url");

  function update() {
    document.getElementById("preview-title").textContent = title.value || "Your Page Title Will Appear Here";
    document.getElementById("preview-desc").textContent = desc.value || "Your meta description will appear here.";
    document.getElementById("preview-url").textContent = url.value || "https://example.com";

    // Character counts with pixel-width warning
    const titleLen = title.value.length;
    const descLen = desc.value.length;
    const titleCount = document.getElementById("title-count");
    const descCount = document.getElementById("desc-count");

    titleCount.textContent = `${titleLen}/60 chars${titleLen > 60 ? " ⚠️ truncated" : ""}`;
    titleCount.className = "char-count" + (titleLen > 60 ? " warn" : titleLen > 50 ? " ok" : "");
    descCount.textContent = `${descLen}/160 chars${descLen > 160 ? " ⚠️ truncated" : ""}`;
    descCount.className = "char-count" + (descLen > 160 ? " warn" : descLen > 140 ? " ok" : "");
  }

  title.addEventListener("input", update);
  desc.addEventListener("input", update);
  url.addEventListener("input", update);
});
```

### 5.3 Robots.txt Generator

**`src/assets/js/robots-generator.js`**：

```javascript
function processTool() {
  const userAgent = document.getElementById("user-agent").value || "*";
  const disallowLines = document.getElementById("disallow").value
    .split("\n")
    .filter(l => l.trim())
    .map(l => `Disallow: ${l.trim()}`);
  const allowLines = document.getElementById("allow").value
    .split("\n")
    .filter(l => l.trim())
    .map(l => `Allow: ${l.trim()}`);
  const sitemap = document.getElementById("sitemap-url").value;

  let output = `# Robots.txt generated by SEOTools\n`;
  output += `# https://seotools.dev/tools/robots-txt-generator/\n\n`;
  output += `User-agent: ${userAgent}\n`;

  for (const line of allowLines) output += `${line}\n`;
  for (const line of disallowLines) output += `${line}\n`;

  if (sitemap) output += `\nSitemap: ${sitemap}\n`;

  document.getElementById("output").value = output;
}

function copyOutput() {
  navigator.clipboard.writeText(document.getElementById("output").value);
}

function clearAll() {
  document.getElementById("user-agent").value = "";
  document.getElementById("disallow").value = "";
  document.getElementById("allow").value = "";
  document.getElementById("sitemap-url").value = "";
  document.getElementById("output").value = "";
}
```

---

## 六、变现路径

### 6.1 变现方式排序

| 优先级 | 方式 | 启动条件 | 预期收入 | 启动时间 |
|--------|------|---------|---------|---------|
| P0 | Google AdSense | 20+ 工具页，月 PV 1 万+ | $50-500/月 | 3-6 个月 |
| P1 | 高级功能付费 | 有稳定流量 | $5-10/月/用户 | 6-12 个月 |
| P2 | API 服务 | 工具被广泛使用 | $10-50/月 | 12+ 个月 |

### 6.2 AdSense 收入估算

| 月 PV | 广告展示率 | 千次展示 | eCPM（SEO 工具类） | 月收入 |
|-------|-----------|---------|-------------------|--------|
| 5,000 | 60% | 3.0 | $2-5 | $6-25 |
| 20,000 | 60% | 12.0 | $3-6 | $36-75 |
| 50,000 | 60% | 30.0 | $4-8 | $120-240 |
| 100,000 | 60% | 60.0 | $5-10 | $300-600 |

**SEO 工具类 eCPM 高于通用工具**：用户是 SEO 从业者，广告主愿意为这类精准受众支付更高价格。

### 6.3 付费功能设计

| 工具 | 免费 | 付费 | 定价 |
|------|------|------|------|
| Schema Generator | 单条 Schema | 批量生成、自定义字段 | $5/月 |
| SEO Score Checker | 单次检查 | 全站审计、PDF 报告 | $10/月 |
| Sitemap Generator | 50 URL | 无限 URL、自动更新 | $5/月 |
| 全站 | 有广告 | 去广告 | $3/月 |

### 6.4 收入预测（保守）

| 时间 | 工具数 | 月 PV | AdSense | 付费 | 合计 |
|------|--------|-------|---------|------|------|
| 1-3 月 | 8 个 | 0-2,000 | $0 | $0 | $0 |
| 4-6 月 | 16 个 | 2,000-10,000 | $0-30 | $0 | $0-30 |
| 7-12 月 | 20 个 | 10,000-50,000 | $30-240 | $0 | $30-240 |
| 13-18 月 | 20+ 个 | 50,000-100,000 | $120-600 | $0-100 | $120-700 |
| 19-24 月 | 20+ 个 + 付费 | 80,000-200,000 | $300-1,200 | $100-500 | $400-1,700 |

---

## 七、实施计划

### Phase 0：清理（第 1 天）

```bash
# 备份
cp -r templates/cf-seo templates/cf-seo-backup

# 删除内容生成代码
rm templates/cf-seo/scripts/generate-topics.mjs
rm templates/cf-seo/src/_data/topics.json
rm templates/cf-seo/src/_data/seoTopics.js
rm templates/cf-seo/src/_data/categoryIndex.js
rm templates/cf-seo/src/_data/categories.js
rm templates/cf-seo/src/topic.njk
rm templates/cf-seo/src/topics-index.njk
rm templates/cf-seo/src/topics-all.njk
```

### Phase 1：基础架构（第 2-3 天）

| # | 任务 | 时间 |
|---|------|------|
| 1 | 创建 `src/_data/tools.json`（8 个第一优先级工具的元数据） | 半天 |
| 2 | 改造 `.eleventy.js`（参照 cf-calculators） | 1 小时 |
| 3 | 改造 `src/_data/config.json` | 10 分钟 |
| 4 | 移植 `tools.njk`（从 cf-calculators，改为英文） | 1 小时 |
| 5 | 移植 `tools-index.njk`（从 cf-calculators，改为英文） | 30 分钟 |
| 6 | 改造 `index.njk`（工具分类列表） | 1 小时 |
| 7 | 改造 `base.njk`（导航改为英文） | 1 小时 |
| 8 | 改造 `sitemap.njk`（数据源改为 tools） | 30 分钟 |
| 9 | `npm run build` 验证构建 | 30 分钟 |

### Phase 2：MVP 工具（第 4-11 天，约 2 周）

| # | 工具 | 类型 | 时间 |
|---|------|------|------|
| 1 | Keyword Density Checker | 普通工具（统一表单） | 半天 |
| 2 | Character Counter | 普通工具 | 半天 |
| 3 | Robots.txt Generator | 普通工具（多输入字段） | 半天 |
| 4 | Sitemap Generator | 普通工具 | 1 天 |
| 5 | SERP Preview | 专属 UI（`tool-with-ui`） | 1 天 |
| 6 | Open Graph Preview | 专属 UI | 1 天 |
| 7 | Meta Tag Generator | 专属 UI（最复杂） | 2 天 |
| 8 | Schema.org Generator | 专属 UI | 2 天 |

### Phase 3：第二批工具（第 12-18 天，约 1 周）

8 个第二优先级工具，参照 Phase 2 模式开发。

### Phase 4：上线 + SEO（第 19-21 天）

| # | 任务 | 时间 |
|---|------|------|
| 1 | 注册域名（建议新域名，避免 seo-hub.pages.dev 的旧内容污染） | 10 分钟 |
| 2 | `wrangler pages deploy` 部署 | 10 分钟 |
| 3 | 提交 Google Search Console | 30 分钟 |
| 4 | 提交 sitemap | 10 分钟 |
| 5 | 发布到 Product Hunt / Hacker News / Reddit r/SideProject | 2 小时 |
| 6 | 3 个月后申请 AdSense | — |

---

## 八、域名建议

### 为什么建议换新域名

如果 `seo-hub.pages.dev` 已被 Google 索引了 10,000 篇 AI 模板文章，域名可能已被标记为低质量。

| 方案 | 操作 | 成本 | 推荐度 |
|------|------|------|--------|
| A. 全新域名 | 注册 seotools.dev 或类似 | $10/年 | ⭐⭐⭐⭐⭐ |
| B. 清理后继续 | 删除旧内容，请求重新索引 | $0 | ⭐⭐⭐ |

**推荐 A**。成本极低，避免旧内容负面权重。

---

## 九、与 cf-calculators 的关系

| 项目 | 定位 | 用户 | 语言 |
|------|------|------|------|
| **cf-calculators** | 开发者工具 + 财务计算器 | 中国开发者、财务人员 | 中文 |
| **cf-seo（改造后）** | SEO 专业工具 | 海外 SEO 从业者、站长 | 英文 |

**共享**：Eleventy 构建配置思路、base.njk 布局、CSS 样式、SEO 基础设施（Schema.org、sitemap）
**不共享**：工具代码、品牌、域名、元数据

---

## 十、风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Google 沙盒期 3-6 月 | 高 | 收入延迟 | 先上线，同时做 Product Hunt 获取初始流量 |
| SEO 工具竞争激烈 | 中 | 排名难 | 工具集合站有叠加效应，20 个工具 > 1 个工具 |
| 域名被旧内容污染 | 中 | 排名低 | 换新域名 |
| 开发进度不及预期 | 中 | 上线延迟 | 按 MVP 优先级，先做最简单的工具 |

---

## 总结

| 项目 | 数值 |
|------|------|
| 改造方向 | AI 文章站 → SEO 工具站 |
| 工具数量 | 20 个 |
| 合计月搜索量 | ~277K |
| 开发周期 | 5 周（20 个工具） |
| 部署成本 | $0（Cloudflare Pages Free） |
| 域名成本 | ~$10/年 |
| 12 个月收入目标 | $30-240/月（AdSense） |
| 24 个月收入目标 | $400-1,700/月（AdSense + 付费） |
| 参考架构 | cf-calculators（已验证） |

**一句话**：废弃 AI 文章生成，复刻 cf-calculators 架构，做 20 个 SEO 专业工具，面向海外用户，Cloudflare Pages 免费部署，AdSense + 付费变现。

---

> **文档版本**：v1.0
> **最后更新**：2026-05-29
> **状态**：完整
