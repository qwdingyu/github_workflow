---
name: localize-static-site
description: Systematically localize an entire cf-static project to a target language, handling JSON configs, JS calculator logic, HTML templates, and generator scripts with common pitfalls avoided
source: auto-skill
extracted_at: '2026-05-30T06:13:07.981Z'
---

# Localize a cf-static Project to a Target Language

When a cf-static project needs to target a specific language market (e.g., Chinese users), the entire stack must be localized — not just content, but form labels, result text, navigation, footers, generator console output, and structured data. This skill describes the systematic 7-layer approach and the specific pitfalls to avoid.

## When to Use

- Building a cf-static site targeting a non-English market
- Converting an existing English cf-static project to another language
- Creating localized variants of a tool/calculator site

## The 7-Layer Localization Order

Localize in this exact order to avoid cascading issues:

| Layer | Files | What to Change |
|-------|-------|---------------|
| **1. Site config** | `src/seo-config.json` | siteName, description, author, locale |
| **2. Tool configs** | `src/tools/*.json` | title, description, keywords, FAQ (q+a) |
| **3. Tool JS logic** | `public/js/*.js` | form labels, hints, result text, currency symbols |
| **4. Blog articles** | `src/posts/*.json` | title, description, keywords, content (HTML) |
| **5. HTML templates** | `src/templates/*.html` | navigation text, footer text, section headings |
| **6. Generator script** | `scripts/generate-seo-pages.mjs` | console.log messages, generated HTML, section headers |
| **7. Static assets** | `public/404.html`, etc. | error page text |

## Layer 1: Site Config

```json
{
  "siteName": "自由职业计算器",
  "siteUrl": "https://example.com",
  "description": "专为自由职业者打造的在线计算工具...",
  "author": "团队名称",
  "locale": "zh-CN"
}
```

**Critical**: `locale` MUST be BCP 47 format (`zh-CN`, `ja-JP`, `ko-KR`), NOT underscore format (`zh_CN`). The `toLocaleDateString()` function throws `RangeError` on invalid locale strings. The generator script has a `toBcp47()` helper that converts `_` to `-`, but it's better to set it correctly from the start.

## Layer 2: Tool JSON Configs

Each tool JSON has 5 localizable fields:

```json
{
  "slug": "hourly-rate-calculator",
  "title": "自由职业时薪计算器",
  "description": "根据你的期望收入...",
  "keywords": ["自由职业时薪计算器", "自由职业者时薪", ...],
  "faq": [
    { "q": "自由职业时薪怎么算？", "a": "以期望年收入为起点..." }
  ]
}
```

**Keywords must be in the target language** — Chinese users search in Chinese. Research actual search terms, don't just translate English keywords.

## Layer 3: Tool JS Logic (Most Complex)

Calculator JS files contain 4 categories of localizable strings:

### 3a. Form field definitions

```javascript
const fields = [
  { id: "annual_income", label: "期望年收入（元）", value: 200000, hint: "你希望税后拿到多少" },
  // ...
];
```

### 3b. Result display text

```javascript
el.innerHTML = `
  <div class="result-item">
    <div class="label">你的建议时薪</div>
    <div class="value highlight">¥${fmt(finalRate)}</div>
    <div class="sub">每小时计费</div>
  </div>`;
```

### 3c. Currency formatting

Replace `$` with target currency symbol (`¥`, `€`, `£`). Adjust the `fmt()` function for locale-specific number formatting if needed.

### 3d. Explanation text

Long-form result notes with `<strong>` tags must be fully translated.

**Tip**: When writing localized JS, keep the same variable names and structure. Only change the string literals.

## Layer 4: Blog Articles

Blog article content is HTML embedded in JSON. Write it directly in the target language:

```json
{
  "title": "2026年自由职业定价指南",
  "content": "<h2>为什么大多数自由职业者定价偏低</h2><p>调查显示...</p>"
}
```

## Layer 5: HTML Templates

Templates contain English strings in unexpected places:

```html
<!-- Navigation -->
<a href="/blog/">Blog</a>     → <a href="/blog/">博客</a>
<a href="/docs/">Docs</a>     → <a href="/docs/">文档</a>

<!-- Footer -->
<p>&copy; {{YEAR}} {{SITE_NAME}}. All rights reserved.</p>
→ <p>&copy; {{YEAR}} {{SITE_NAME}} 版权所有</p>

<!-- Section headings -->
<h2>Frequently Asked Questions</h2>
→ <h2>常见问题</h2>
```

Check ALL templates: `tool.html`, `post.html`, `doc.html`.

## Layer 6: Generator Script

The `generate-seo-pages.mjs` script contains English strings in 5 places:

### 6a. Console output

```javascript
console.log(`📦 Site: ${siteConfig.siteName}`);  →  console.log(`📦 站点: ${siteConfig.siteName}`);
console.log(`🔧 Tools: ${tools.length} found`);   →  console.log(`🔧 工具: ${tools.length} 个`);
```

### 6b. Generated HTML for index pages

Blog index, docs index, and homepage all have hardcoded English strings in template literals:

```javascript
// Blog index
<title>Blog — ${siteConfig.siteName}</title>  →  <title>博客 — ${siteConfig.siteName}</title>
<h1>Blog</h1>                                  →  <h1>博客</h1>
<p>No posts yet.</p>                           →  <p>暂无文章。</p>

// Docs index
<h1>Documentation</h1>                          →  <h1>文档</h1>
<p>Everything you need to know</p>              →  <p>你需要知道的一切</p>

// Homepage footer
<a href="/privacy">Privacy</a>                  →  <a href="/privacy">隐私政策</a>
<a href="/terms">Terms</a>                      →  <a href="/terms">使用条款</a>
```

### 6c. Calculator mode HTML

```javascript
<button class="btn-primary">Calculate</button>  →  <button class="btn-primary">开始计算</button>
<button class="btn-secondary">Reset</button>    →  <button class="btn-secondary">重置</button>
<h3>Your Results</h3>                           →  <h3>计算结果</h3>
```

### 6d. BreadcrumbList section name

```javascript
{ name: "Tools" }  →  { name: "工具" }
```

### 6e. llms.txt section headers

```javascript
"## Tools"           →  "## 工具"
"## Blog"            →  "## 博客"
"## Documentation"   →  "## 文档"
"## Optional"        →  "## 其他"
```

### 6f. `<html lang>` attribute

The homepage template hardcodes `lang="en"`. Change to use the config locale:

```javascript
<html lang="en">  →  <html lang="${siteConfig.locale}">
```

## Layer 7: Static Assets

### 404.html

```html
<html lang="en">      →  <html lang="zh-CN">
<title>404 — Page Not Found</title>  →  <title>404 — 页面未找到</title>
<p class="msg">Page not found</p>    →  <p class="msg">页面未找到</p>
<a href="/">← Back to Home</a>       →  <a href="/">← 返回首页</a>
```

## Critical Pitfall: Chinese Quotes in JSON

**This is the #1 bug encountered during localization.**

Chinese quotation marks `""` (U+201C, U+201D) look similar to JSON string delimiters `"` (U+0022). When used inside a JSON string value, they break the JSON parser:

```json
// ❌ BROKEN — Chinese quotes look like JSON string boundaries to the parser
{ "a": "算出你的月度"工资"" }
// Parser sees: "算出你的月度" then unexpected 工资

// ✅ CORRECT — Use 「」 (Japanese/Chinese corner brackets) instead
{ "a": "算出你的月度「工资」" }

// ✅ ALSO CORRECT — Escape with HTML entities
{ "a": "算出你的月度&ldquo;工资&rdquo;" }
```

**Detection**: Run `node -e "JSON.parse(require('fs').readFileSync('file.json','utf8'))"` on every JSON file after localization. Any file with Chinese quotes inside string values will fail.

**Fix**: Replace all `""` with `「」` throughout JSON content files.

## Verification Checklist

After localization, verify every layer:

```bash
# 1. All JSON files parse correctly
for f in src/tools/*.json src/posts/*.json src/seo-config.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>&1 && echo "✅ $f" || echo "❌ $f"
done

# 2. Build succeeds
node scripts/generate-seo-pages.mjs

# 3. Generated HTML has correct language
grep -o '<title>[^<]*</title>' public/index.html
grep -o '<html lang="[^"]*"' public/index.html

# 4. No English text in generated pages (spot check)
grep -i "All rights reserved\|Frequently Asked\|Back to Home\|No posts" public/tools/*.html public/posts/*.html public/index.html

# 5. JS files contain target language strings
grep "期望年收入\|计算结果\|开始计算" public/js/*.js | wc -l

# 6. llms.txt is in target language
head -5 public/llms.txt

# 7. HTTP test all pages
cd public && python3 -m http.server 8787 &
for path in "/" "/tools/xxx.html" "/posts/xxx.html" "/js/xxx.js" "/css/style.css" "/sitemap.xml" "/robots.txt" "/llms.txt" "/404.html"; do
  curl -sS -o /dev/null -w "%{http_code} $path\n" "http://localhost:8787${path}"
done
```

## Localization Effort Estimate

For a typical cf-static project with 8 tools + 5 blog posts:

| Layer | Files | Time |
|-------|-------|------|
| Site config | 1 | 2 min |
| Tool configs | 8 | 30 min |
| Tool JS logic | 8 | 2 hours (most complex) |
| Blog articles | 5 | 2 hours (content creation) |
| HTML templates | 2-3 | 10 min |
| Generator script | 1 | 20 min |
| Static assets | 1 | 5 min |
| **Total** | **~26 files** | **~5 hours** |

## Key Lessons Learned

1. **Chinese quotes `""` break JSON** — always use `「」` inside JSON string values. This is the most common and hardest-to-debug localization bug.
2. **English strings hide everywhere** — generator console.log, breadcrumb names, llms.txt section headers, calculator button labels. Do a comprehensive grep after localization.
3. **Locale must be BCP 47** — `zh-CN` not `zh_CN`. The `toLocaleDateString()` function silently fails or throws on invalid locales.
4. **Currency formatting matters** — `¥200,000` uses comma separators in Chinese too, same as `$200,000`. But some locales use period (German: `200.000 €`).
5. **Keywords must be native** — don't translate English keywords. Research what users actually search for in the target language.
6. **Verify JSON before building** — a single broken JSON file prevents the entire build. Always validate all JSON files before running the generator.
7. **The `<html lang>` attribute** — easy to forget. Hardcoded `lang="en"` in the homepage template must be changed to use the config locale.

## References

- Localized project: `/Users/dingyuwang/0-X/freelancer-calc/` (Chinese localization of freelancer calculator site)
- Source template: `templates/cf-static/` (cf-static template)
- Related skills: `create-product-template` (creating the project), `seo-geo-hardening` (SEO optimization)
