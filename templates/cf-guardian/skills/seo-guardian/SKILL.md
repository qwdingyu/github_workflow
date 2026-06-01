---
name: seo-guardian
description: >
  Full-stack SEO + GEO audit and optimization platform.
  Scans live websites for 100+ SEO/GEO issues, generates AI-powered reports,
  monitors competitors, and auto-fixes content.
  Use when: auditing a website's SEO/GEO health, optimizing content for AI search,
  generating llms.txt, checking AI bot access, or monitoring SEO trends.
argument-hint: "audit <url> | fix <file> | generate llms | monitor | report"
allowed-tools:
  - Bash(curl *)
  - Read, Write, Edit, Grep, Glob
---

# SEO Guardian — Claude Code Skill

SEO Guardian is a comprehensive SEO + GEO (Generative Engine Optimization) platform built on Cloudflare Workers. It audits websites across 9 dimensions with 100+ checks and provides AI-powered recommendations.

## Quick Start

### Audit a Website

```bash
curl -X POST https://api.seoguardian.dev/api/geo/check \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

This runs a full GEO audit checking:
1. **Robots.txt AI Bot Access** (18 pts) — 27 AI bots across 3 tiers
2. **llms.txt** (14 pts) — AI search engine discovery file
3. **Schema.org** (16 pts) — Structured data richness and completeness
4. **Meta/OG Tags** (10 pts) — Open Graph, Twitter Cards, meta description
5. **Content Quality** (12 pts) — Depth, front-loading, hierarchy, citations
6. **E-E-A-T Signals** (6 pts) — Author, contact, about page, source citations
7. **Brand & Entity** (10 pts) — Brand consistency, knowledge graph, geo signals
8. **Princeton Methods** (12 pts) — 9 citation enhancement methods from Princeton KDD 2024
9. **AI Discovery** (6 pts) — Forward-looking AI endpoints and meta tags

**Total: 100 points** — Score bands: critical (<36), foundation (36-59), good (60-85), excellent (86+)

### Generate llms.txt

```bash
curl -X POST https://api.seoguardian.dev/api/optimize/llms-txt \
  -H "Content-Type: application/json" \
  -d '{"siteName": "My Site", "description": "A great website", "sections": [{"title": "About", "content": "We do X"}]}'
```

### Generate Schema JSON-LD

```bash
# Product schema
curl -X POST https://api.seoguardian.dev/api/optimize/schema/product \
  -H "Content-Type: application/json" \
  -d '{"name": "Widget Pro", "description": "Best widget", "image": "https://example.com/img.jpg", "price": "29.99", "currency": "USD"}'

# FAQ schema
curl -X POST https://api.seoguardian.dev/api/optimize/schema/faq \
  -H "Content-Type: application/json" \
  -d '{"questions": [{"question": "What is X?", "answer": "X is..."}]}'

# Organization schema
curl -X POST https://api.seoguardian.dev/api/optimize/schema/organization \
  -H "Content-Type: application/json" \
  -d '{"name": "My Company", "url": "https://example.com"}'
```

### Generate robots.txt AI Rules

```bash
curl -X POST https://api.seoguardian.dev/api/optimize/robots-ai \
  -H "Content-Type: application/json" \
  -d '{"allowedBots": ["GPTBot", "PerplexityBot", "Claude-Web"], "blockedBots": ["CCBot", "Bytespider"]}'
```

## GEO Best Practices

### llms.txt (Critical for 2026)

llms.txt is the standard file that AI search engines (ChatGPT, Perplexity, Claude) use to understand your site. Without it, AI systems may misrepresent your content.

**Required structure:**
```markdown
# My Website Name
> Brief description of what the site does

## About
Core content about your site...

## Key Features
Feature details...
```

**Scoring (14 pts):**
- +4 for file existence
- +2 for H1 title
- +2 for blockquote description
- +2 for H2 sections
- +2 for 50+ words
- +2 for llms-full.txt companion

### AI Bot Management (27 Bots / 3 Tiers)

**Tier 1 — Citation-critical** (most important):
GPTBot, OAI-SearchBot, Claude-Web, ClaudeBot, PerplexityBot, Google-Extended, cohere-ai, omgilibot, diffbot, ImagesiftBot, FacebookBot, meta-externalagent, TeaBot

**Tier 2 — Training data**: DeepSeekBot, GrokBot, Bytespider, PanguBot, CCBot, Amazonbot, GoogleOther, facebot, Tastebot

**Tier 3 — Regional/assistant**: YandexBot, SputnikBot, Baiduspider, Applebot

**Best practice:** Explicitly allow Tier 1 bots, consider blocking Tier 2 training bots if you want to control data usage.

### Princeton Citation Methods (9 Methods)

Based on Princeton University KDD 2024 research, these 9 methods increase AI citation likelihood:

| Method | Impact | How |
|--------|--------|-----|
| Statistical data front-loading | 15% | Put numbers/stats in first 50 words |
| Authority citations | 12% | Link to .edu/.gov sources |
| Table data presentation | 10% | Use HTML tables for data |
| FAQ structured format | 10% | Add FAQ sections with clear Q&A |
| Brand consistency | 8% | Mention brand 3+ times |
| External link diversity | 8% | Link to 3+ unique domains |
| Question-format headings | 7% | Use "What is X?" style H2/H3 |
| List enumeration | 7% | Use lists with 3+ items |
| Code examples | 3% | Include code blocks for tech content |

### Schema.org Richness

**High richness** (4+ types) scores best. Recommended core types:
- `Organization` — for all sites
- `FAQPage` — for content pages
- `BreadcrumbList` — for navigation
- `BlogPosting` / `NewsArticle` — for articles
- `Product` + `Offer` + `Review` — for e-commerce

## Common Workflows

### 1. Full Site Audit → Fix

```bash
# Step 1: Audit
curl -X POST https://api.seoguardian.dev/api/geo/check \
  -H "Content-Type: application/json" \
  -d '{"url": "https://mysite.com"}' | jq '.checks[] | select(.status == "fail")'

# Step 2: Generate fixes based on failures
# If llms.txt failed → generate llms.txt
# If schema failed → generate appropriate schema
# If robots failed → generate AI bot rules
```

### 2. Content Optimization

When content_depth or content_structure fails:
1. Add tables for data comparison
2. Create FAQ sections
3. Use question-format headings ("How to X?", "What is Y?")
4. Add statistics in the first paragraph
5. Include 3+ external citations to authoritative sources

### 3. E-commerce GEO

For product pages, ensure:
1. Product schema with name, description, image, offers
2. Offer schema with price, currency, availability
3. Review/AggregateRating schema
4. BreadcrumbList for navigation
5. FAQPage for common product questions

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/geo/check` | One-time GEO audit (no auth) |
| GET | `/api/geo/report/:siteId` | GEO report for monitored site |
| POST | `/api/optimize/llms-txt` | Generate llms.txt |
| POST | `/api/optimize/robots-ai` | Generate AI bot rules |
| POST | `/api/optimize/schema/{type}` | Generate Schema JSON-LD |
| POST | `/api/optimize/og-tags` | Generate OG/Twitter meta tags |
| GET | `/api/scans/:siteId` | Latest scan results |
| GET | `/api/scans/:siteId/history` | Score trend history |
| GET | `/api/dashboard` | Dashboard overview |

## Authentication

Most endpoints require `x-auth-token` header. Free tier gets 1 site with weekly scans.
