---
name: seo-geo-hardening
description: Systematically harden web products for SEO and AI search (GEO) using three parallel audits, prioritized fixes, and shared-kernel-level production readiness
source: auto-skill
extracted_at: '2026-05-30T11:45:00.000Z'
---

# SEO/GEO Hardening for Web Products

When web products (static sites or dynamic Workers) go to market, they need to be discoverable by both traditional search engines (Google, Bing) and AI search engines (Perplexity, ChatGPT Search, Claude). This skill describes a systematic methodology: **audit first, prioritize, then fix across shared kernel + all templates simultaneously**.

## When to Use

- Before launching any web product to production
- When existing products have low SEO scores (missing meta tags, no Schema.org, no sitemap)
- When targeting AI search traffic (GEO = Generative Engine Optimization)
- When shared infrastructure (error handling, security headers, DB resilience) needs production-grade hardening

## The Three-Agent Parallel Audit

Launch **three audit agents simultaneously** to assess different dimensions. This is 3× faster than sequential analysis and catches cross-cutting issues.

### Agent 1: SEO/GEO Readiness Audit

Score each template on a 0-10 scale across 5 dimensions:

| Dimension | What to check | Weight |
|-----------|--------------|--------|
| **Schema.org** | JSON-LD types present (Product, WebSite, SoftwareApplication, FAQPage, BreadcrumbList, Store, Organization) | High |
| **AI Crawler** | robots.txt allows AI bots (GPTBot, ClaudeBot, PerplexityBot); llms.txt exists | High |
| **SEO Basics** | sitemap.xml, canonical URL, OG tags, Twitter Card, meta description, 404 page | High |
| **Performance** | Inline critical CSS, lazy loading, JS defer/async | Medium |
| **HTML SEO** | `<title>`, `<html lang>`, heading hierarchy, image alt text | Medium |

**Output format** — a scoring matrix:

```
| Dimension              | template-a | template-b | template-c |
|------------------------|-----------|-----------|-----------|
| Schema.org             | 7/10      | 1/10      | 2/10      |
| AI Crawler             | 7/10      | 0/10      | 0/10      |
| SEO Basics             | 7/10      | 1/10      | 2/10      |
| Performance            | 5/10      | 4/10      | 5/10      |
| Worker HTML SEO        | N/A       | 1/10      | 2/10      |
| **Overall**            | **6.5**   | **1.5**   | **2.0**   |
```

### Agent 2: Template-to-Product Flow Audit

Analyze the gap between "having a template" and "having a live product":

1. **Read all scripts/** — catalog every automation script
2. **Read the deploy pipeline** — understand one-click.sh's 7-step flow
3. **For each template**, list files that need manual editing (wrangler.jsonc `name`, package.json `name`, config files, example data)
4. **Identify automation opportunities** — which manual steps can a scaffold script handle?
5. **Flag the biggest pain point** — usually `.deploy/` directory duplication across templates

### Agent 3: Production Robustness Audit

Check infrastructure readiness for real traffic:

| Check | What to verify |
|-------|---------------|
| **Error handling** | `onError` handler exists; 404/500 pages (HTML for browsers, JSON for APIs) |
| **Health checks** | `/api/health` endpoint; actual DB probe (not just object existence) |
| **DB resilience** | Connection retry logic; graceful degradation when DB is down |
| **Static assets** | favicon.ico/svg exists; robots.txt; _headers configured |
| **Security headers** | CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP |
| **Rate limiting** | Configured AND actually wired into routes (not just defined) |

## Prioritization: P0/P1/P2 Backlog

After audits complete, consolidate findings into a prioritized backlog:

| Priority | Criteria | Examples |
|----------|----------|---------|
| **P0** | Blocks revenue or discoverability | Scaffold script, llms.txt, Worker homepage SEO, missing sitemap |
| **P1** | Degrades user experience or resilience | DB retry, HTML error pages, favicon, security headers, BreadcrumbList |
| **P2** | Nice-to-have enhancements | hreflang, inline critical CSS, Product Schema for e-commerce |

## Implementation: Shared Kernel First

Fix issues at the **shared kernel level** whenever possible. One fix in the shared library propagates to ALL templates.

### Pattern 1: DB Connection Retry

Add `initDatabaseWithHealthCheck()` to the shared kernel:

```typescript
export async function initDatabaseWithHealthCheck(url, authToken, schema) {
  // If cached client exists, return immediately (zero overhead for repeat requests)
  if (cachedClient && cachedUrl === url) {
    return createDrizzle(cachedClient, schema);
  }
  // First connection: create client + verify with SELECT 1
  const client = getOrCreateClient(url, authToken);
  const db = createDrizzle(client, schema);
  // Retry up to 2 times (500ms → 1s) for transient failures
  for (let attempt = 0; attempt <= 2; attempt++) {
    try { await client.execute("SELECT 1"); return db; }
    catch (err) {
      if (attempt >= 2) throw err;
      await sleep(500 * Math.pow(2, attempt));
    }
  }
}
```

Then update the bootstrap middleware to use `initDatabaseWithHealthCheck` instead of `initDatabase`.

### Pattern 2: HTML Error Pages in Bootstrap

Browser requests should get styled HTML error pages, API requests get JSON:

```typescript
function errorPageHtml(status, message) {
  return `<!DOCTYPE html>...<p class="code">${status}</p><p class="msg">${message}</p>...`;
}

api.notFound((c) => {
  if (c.req.header("accept")?.includes("text/html")) {
    return c.html(errorPageHtml(404, "页面未找到"), 404);
  }
  return fail(c, "API not found", 404);
});
```

### Pattern 3: Security Headers Completeness

Ensure `buildSecurityHeaders()` includes ALL modern headers:

```typescript
return new Headers({
  "Content-Security-Policy": csp,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
});
```

## Implementation: Per-Template SEO

### Worker Templates: Homepage SEO Injection

Every Worker template's `public/index.html` needs these tags inserted after `<title>`:

```html
<meta name="description" content="...">
<meta name="keywords" content="...">
<link rel="canonical" href="">
<meta property="og:type" content="website">
<meta property="og:title" content="...">
<meta property="og:description" content="...">
<meta property="og:url" content="">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">
{ "@context": "https://schema.org", "@type": "WebSite|Store", ... }
</script>
```

**Schema.org type by template archetype:**
- Commerce → `Store`
- API Service → `WebAPI` or `TechArticle`
- Tool Hub → `WebSite`
- Form → `WebApplication`

### Static Site Templates: SEO Generation Pipeline

For static site generators (like cf-static), add to the build pipeline:

1. **llms.txt** — AI search-friendly site description (see below)
2. **BreadcrumbList Schema.org** — for each tool/post/doc page
3. **404.html** — styled error page
4. **_headers** — enable security headers (not commented out!)
5. **favicon.svg** — simple SVG favicon (no 404 on favicon requests)

### llms.txt Generation

`llms.txt` is an emerging standard (llmstxt.org) that AI search engines read to understand site structure:

```
# Site Name

> Site description

## Tools
- [Tool Name](https://site.com/tools/tool.html): Tool description
- [Tool Name](https://site.com/tools/tool.html): Tool description

## Blog
- [Post Title](https://site.com/posts/post.html): Post description

## Documentation
- [Doc Title](https://site.com/docs/doc.html): Doc description

## Optional
- [Sitemap](https://site.com/sitemap.xml)
```

Generate this in the same build script that generates sitemap.xml and robots.txt.

### BreadcrumbList Schema.org

Add to every content page's template:

```javascript
function generateBreadcrumbSchema(siteName, siteUrl, items) {
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
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}
```

Call with: `[ { name: siteName, url: "/" }, { name: "Tools" }, { name: toolTitle, url: `/tools/${slug}.html` } ]`

### robots.txt for AI Crawlers

Explicitly allow AI search engine bots:

```
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Bytespider
Allow: /
```

## Implementation: Favicon Strategy

Create a simple SVG favicon for each template. SVG is ideal because:
- Zero build step
- Tiny file size (~200 bytes)
- Scales perfectly on all devices
- No 404 on `/favicon.ico` requests (add `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` or just place at root)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="18" fill="#6c63ff"/>
  <text x="50" y="72" font-size="60" font-family="system-ui" font-weight="700"
        text-anchor="middle" fill="#fff">CF</text>
</svg>
```

Each template gets a slightly different accent color for visual differentiation.

## Verification Checklist

After all fixes, run this verification sequence:

```bash
# 1. Shared kernel tests (must all pass)
cd packages/cf-core && npm test
# Expected: 81/81 passed

# 2. Type check for Worker templates
cd templates/cf-form && npx tsc --noEmit
# Expected: No errors

# 3. Static site generation (if applicable)
cd templates/cf-static && node scripts/generate-seo-pages.mjs
# Expected: All pages + sitemap.xml + robots.txt + llms.txt generated

# 4. Scaffold script test
node scripts/create-project.mjs test-project --template cf-static --domain test.com --output /tmp
# Expected: Project created with correct name substitutions, then clean up

# 5. Shared infrastructure tests
bash templates/cf-form/.deploy/tests/test-shared.sh
# Expected: 34/34 passed

# 6. Verify generated llms.txt content
cat templates/cf-static/public/llms.txt
# Expected: Structured content with ## Tools, ## Blog, ## Documentation sections

# 7. Verify BreadcrumbList in generated pages
grep -c "BreadcrumbList" templates/cf-static/public/tools/*.html
# Expected: 1 match per tool page
```

## Key Lessons Learned

1. **Audit-first, not fix-first** — launching 3 parallel audits before writing any code prevents fixing the wrong things. The audits revealed that Worker templates scored 1.5/10 on SEO while the static template scored 6.5/10 — this prioritization was invisible without the audit.

2. **Shared kernel fixes propagate to ALL templates** — fixing `buildSecurityHeaders()` in cf-core instantly improves security for all 5 templates. Always check if a fix belongs in the shared kernel.

3. **llms.txt is the new robots.txt for AI** — Perplexity, ChatGPT Search, and other AI search engines look for `/llms.txt` to understand site structure. It's trivial to generate alongside sitemap.xml.

4. **Browser vs API error handling** — bootstrap's `onError` and `notFound` handlers must check `Accept: text/html` and return styled HTML for browsers, JSON for API clients. Showing raw JSON to a browser user is a terrible UX.

5. **DB health checks must be real** — checking `!!db` (object existence) is not a health check. The shared kernel should execute `SELECT 1` on first connection and retry with exponential backoff.

6. **Permissions-Policy and COOP were missing** — even with CSP, X-Frame-Options, and Referrer-Policy configured, two modern security headers were absent. Always audit against the full list: CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy.

7. **favicon.ico 404s waste requests** — every template was missing a favicon, causing a 404 on every page load. A simple SVG favicon (200 bytes) eliminates this.

8. **_headers files get commented out** — cf-static's security headers in `_headers` were entirely commented out with `/* ... */`. Always verify that _headers rules are actually active.

9. **Agent timeouts on large tasks** — parallel agents working on 4+ large HTML files can timeout (192s). When this happens, the agents may have partially completed their work. Always verify what was actually written before re-doing the work manually.

10. **Schema.org type matters** — using the right type (`Store` for e-commerce, `WebSite` for tool hubs, `WebApplication` for SaaS) gives Google rich snippets. The wrong type or missing type = no rich results.

## References

- Scaffold script: `scripts/create-project.mjs` (311 lines)
- Shared kernel improvements: `packages/cf-core/src/bootstrap.ts`, `packages/cf-core/src/db/connection.ts`, `packages/cf-core/src/security.ts`
- SEO generation pipeline: `templates/cf-static/scripts/generate-seo-pages.mjs`
- Worker template SEO examples: `templates/cf-shop/public/index.html`, `templates/cf-tools/public/index.html`
- llms.txt output: `templates/cf-static/public/llms.txt`
- Related skills: `create-product-template` (Step 0: scaffold script, Step 10: SEO validation), `audit-cross-project-consistency` (naming/structure audit), `verify-deployment-end-to-end` (E2E testing)
