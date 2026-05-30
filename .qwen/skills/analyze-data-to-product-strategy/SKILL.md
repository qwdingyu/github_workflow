---
name: analyze-data-to-product-strategy
description: Analyze existing data assets from one project against product infrastructure from another, identify strategic opportunities, assess true competitive moat, and produce a phased product roadmap with strategic positioning
source: auto-skill
extracted_at: '2026-05-30T09:18:05.383Z'
---

# Analyze Data Assets → Product Strategy

When you have **data assets** from one project (e.g., data cleaning pipeline, crawled datasets, structured knowledge bases) and **product infrastructure** from another (e.g., shared kernel, templates, deployment automation), the question is: *what product should we build, and how do we position it for maximum impact?*

This skill describes a systematic methodology for cross-project strategic analysis: **explore both projects, map data to infrastructure, identify the real moat (not the surface asset), assess competition, and produce a phased roadmap.**

## When to Use

- Two separate projects exist: one produces/cleans data, the other builds products
- You suspect the data has commercial value but need to validate the thesis
- You need to decide *which* product to build first and *how* to differentiate
- You want to avoid building a commodity (everyone has the same data) vs. a moat (only you have the pipeline)
- Before investing weeks into product development, you want a strategic direction

## The 5-Phase Methodology

### Phase 1: Map Both Project Landscapes (Parallel Exploration)

Launch **two parallel exploration agents** to understand what you're working with. Don't assume you know the content — read the actual files.

#### Agent A: Data Assets Project

Explore the data project comprehensively:

```
Scope:
  - README.md and ARCHITECTURE.md — what was this built for?
  - data/ directories — what datasets exist? How large? What format?
  - Core pipeline code — how is data extracted, cleaned, and structured?
  - docs/ — any prior analysis of commercial value or use cases?
  - Key scripts — what can this pipeline DO beyond what's already processed?
```

**Key questions to answer:**

| Question | Importance |
|----------|-----------|
| How much data? (records, files, GB) | Baseline |
| What format? (structured JSON vs raw PDF vs CSV) | Determines deployability |
| Is it domain-specific? (auto, industrial, medical) | Frames competitive landscape |
| What's the data source? (open source, proprietary, crawled) | Determines moat |
| Is there a *pipeline* that can produce MORE data? | **Key moat indicator** ✅ |
| Is the data already cleaned and normalized? | Time-to-market |

#### Agent B: Product Infrastructure Project

Explore the product/build project comprehensively:

```
Scope:
  - packages/ — what shared kernel exists? What modules?
  - templates/ — what product archetypes are ready to deploy?
  - docs/ — any existing strategy docs, product plans, SEO/GEO analysis?
  - scripts/ — what automation exists? (scaffolding, deploy, CI/CD)
  - Existing products — what's already built and running?
```

**Key questions to answer:**

| Question | Importance |
|----------|-----------|
| What shared library exists? (auth, db, cache, security) | Determines dev speed |
| What templates? (api, tools, static, shop, form) | Determines deployment vehicle |
| What's the deploy pipeline? (one-click, CI/CD) | Determines operational cost |
| What's the SEO/GEO readiness? (meta tags, Schema.org, llms.txt) | Determines traffic strategy |
| What's the database setup? (ORM, schema, migration) | Determines data import effort |

### Phase 2: Identify the Real Moat (Critical — Most People Get This Wrong)

**This is the most important step.** Most developers assume the data itself is valuable. Usually, it's not — the *pipeline* that produces/cleans it is.

#### The Moat Matrix

| Asset | Value | Moat | Risk |
|-------|-------|------|------|
| **Raw data** (publicly available) | Low | None — anyone can download | Commodity pricing |
| **Cleaned data** (structured, normalized) | Medium | Low — doable with a single script | Easy to replicate |
| **Data pipeline** (automatic extraction, cleaning, enrichment) | **High** | **High** — requires domain expertise + engineering | Hard to replicate |
| **Cross-domain data** (auto + industrial + medical) | **Very High** | **Very High** — nobody else has all | Unique positioning |

**Diagnosis questions:**

1. Is the source data publicly available? (GitHub repos, open APIs, crawled websites)
2. If yes, has someone already built a product on top of it?
3. What value do we ADD beyond the raw data? (structure, enrichment, cross-domain linking)
4. Can our pipeline CONTINUOUSLY produce MORE or BETTER data?

**If the answer to (1) is yes and (4) is no, you're building a commodity. Find a different angle.**

### Phase 3: Competitive Landscape Analysis

Map the competitive landscape across these dimensions:

| Dimension | What to look for |
|-----------|-----------------|
| **Direct competitors** | Who offers the same service on the same data? |
| **Indirect competitors** | Who solves the same problem differently? |
| **Substitute products** | What do people use TODAY instead of our product? |
| **Potential entrants** | Who could copy us and eat our lunch? |
| **Complementary products** | What existing products would our product make better? |

**Use the DuckDuckGo search tool** to find competitors. Search for the core use case (e.g., "故障码查询", "DTC lookup", "OBD code API") and analyze the top results.

#### Gap Analysis

For each competitor, assess:

| Competitor | Strengths | Weaknesses | Our opportunity |
|-----------|-----------|------------|----------------|
| obd-codes.com | Domain age, SEO rank | Old design, no API, no GEO | API service, GEO optimization |
| open-source DBs | Free, accessible | No service, no UI | API layer, structured UX |
| OBD hardware apps | Integrated HW+SW | Vendor lock-in, expensive | Data layer unbundling |

**Look for the AI search angle.** Traditional competitors may have decade-old domain authority, but AI search (ChatGPT, Perplexity) doesn't care about domain age — it cares about structured, citable content. This is the gap.

### Phase 4: Build the Strategic Roadmap

Produce a **phased product roadmap** with clear milestones, time estimates, and revenue projections.

#### Phase Structure Template

| Phase | Duration | Goal | Key Deliverables |
|-------|----------|------|-----------------|
| **Phase 1: Beachhead** | 1-2 weeks | Validate the concept with minimal product | MVP API + SEO landing pages |
| **Phase 2: Monetization** | 3-6 weeks | Convert traffic to revenue | API pricing, ads, subscription |
| **Phase 3: Moat Building** | 7-12 weeks | Build the defensible advantage | Cross-domain data, pipeline automation |

#### For Each Phase, Specify:

1. **Technical architecture** — map to existing templates and shared kernel
2. **Data flow** — how data moves from source to product
3. **SEO/GEO strategy** — how each phase captures search traffic (see `seo-geo-hardening` skill)
4. **Cost analysis** — infrastructure cost (should be near-zero on CF Free)
5. **Success metrics** — what does "done" look like?

### Phase 5: Write the Strategic Document

Write a comprehensive document covering all phases, and save it to the project's `docs/` directory with proper numbering.

#### Document Structure

```
# {序号}\_{中文标题}\_{日期}.md

## 一、核心结论（Executive Summary）
- 做什么？不做什么？（关键决策）
- 一句话价值主张
- 推荐策略

## 二、行业全景分析
- 底层逻辑图（数据层 → 应用层 → 终端用户）
- 市场格局（玩家地图：谁在哪里）
- 2026 年的关键变数（AI 搜索、GEO 等）

## 三、真实护城河分析
- 什么不是护城河（常见误区）
- 什么是真护城河（pipeline、cross-domain、automation）
- 种子数据 vs 持续产出

## 四、产品路线图（按阶段）
### Phase 1: Beachhead
### Phase 2: Monetization
### Phase 3: Moat Building
- 每个阶段：技术架构图、数据流、SEO/GEO策略、成本、成功标准

## 五、技术选型合理性
- 与现有模板的匹配度
- 使用共享内核的哪些模块
- 预估上市时间

## 六、竞争态势与风险
- 竞争格局图
- 风险矩阵（概率/影响/缓解措施）
- 成功标准和放弃条件

## 七、落地行动计划（0-12 周）
- 按周列出的可执行清单
- 每个任务标注使用的模板/工具

## 八、更广阔的图景
- 如果只做当前产品 → 天花板
- 如果做到极致 → 终极形态
- 数据飞轮效应

## 九、最终建议
- 做/不做/怎么做
- 关键注意事项
```

**Numbering convention**: Use the next available number in the `docs/` directory. Check existing files with `ls docs/` and use the highest prefix number + 1 (e.g., if highest is `700_个人开发者SEO_GEO可行性分析_20260529.md`, next is `701`).

## Key Insights from Practice

### 1. The Data Itself Is Usually Not the Moat

In my practice, the user had **18,805 DTC fault codes**. I initially assumed this was the asset. But after analysis:

- The data was from a **public MIT-licensed GitHub project** — anyone can download it
- Pure DTC lookup is a **commodity** — dozens of sites already do it
- **The real moat was the data cleaning pipeline** (`autoclean`) that could extract, normalize, and structure fault codes from PDFs automatically, and the **cross-domain capability** (auto + industrial)

**Lesson**: Always ask "could someone replicate this with a weekend of work?" If yes, look deeper.

### 2. Programmatic SEO Pages Are the Fastest Path to Traffic

With a structured dataset (18,805 codes), generating one SEO page per code is:

- **19,000 unique, citable pages** from a single script
- **Schema.org structured data** built into each page → GEO-friendly
- **AI search loves pages with structured data** about specific entities

**Lesson**: Structured data + programmatic generation = perfect GEO content. AI search engines (ChatGPT, Perplexity) prefer to cite specific code references over generic overview pages.

### 3. Cross-Domain Superposition Creates Unique Value

The DTC data (automotive) alone was a commodity. The industrial fault codes alone were a niche. But **combining them** under one API/query interface = something nobody else has.

**Lesson**: Look for cross-domain connections in your data. The intersection of two niches can create a new category.

### 4. GEO Is the Small Player's Strategy

Traditional SEO requires 12-18 months and domain authority building. But:

- 89% of ChatGPT citations come from Google rank 20+
- AI search scores 4.4× higher conversion than traditional search
- Structured data (Schema.org) is the input signal AI search uses

**For a new product**: Don't fight the SEO war. Win the GEO war. Focus on structured data, citable content, and API documentation that AI search engines can reference.

### 5. "3-5 Days to MVP" Is Real with the Right Infrastructure

With shared kernel (auth, db, cache) + templates (cf-api for API, cf-static for SEO pages) + deploy automation:

- Data import: 0.5 days (Drizzle ORM, no raw SQL)
- API endpoints: 1 day (cf-api template)
- SEO page generation: 1-2 days (cf-static template + generation script)
- Deployment: 0.5 days (one-click.sh)

**Total: 3-5 days from zero to live product**, costing ~$1.6/month in infrastructure.

## Verification Checklist

After writing the strategic document:

```
□ Phase 1 is buildable in ≤2 weeks
□ True moat is identified (not the data, but the pipeline/capability)
□ Competitive gap is validated (at least 1 competitor gap we can exploit)
□ GEO strategy is explicit (Schema.org, llms.txt, structured pages)
□ Cost analysis shows near-zero infrastructure spend
□ Document is saved to docs/ with correct numbering
□ Document is committed to git with Chinese commit message
□ At least one "don't do this" boundary is identified
□ Success criteria for stopping/abandoning are clear
□ Each phase has concrete technical deliverables tied to existing templates
```

## References

- Practice example: `docs/701_DTC故障码查询服务战略分析_20260530.md` — full strategic analysis using this methodology
- Infrastructure: `packages/cf-core/` — shared kernel
- Templates: `templates/cf-api/`, `templates/cf-static/`, `templates/cf-tools/`
- SEO/GEO hardening: `seo-geo-hardening` skill
- Data pipeline: `/Users/dingyuwang/0-X/bot/autoclean/` — AutoClean data cleaning system (cross-project reference)
- Product creation: `create-product-template` skill