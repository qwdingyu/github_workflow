---
name: build-dtc-code-lookup-service
description: Full end-to-end pattern for building a DTC/fault code lookup service — data import, API, SEO pages, closed-loop frontend, all on CF Free + Turso
source: auto-skill
extracted_at: '2026-05-30T12:16:32.699Z'
---

# Build a DTC / Fault Code Lookup Service

Build a production-grade OBD-II diagnostic trouble code (DTC) lookup service on Cloudflare Free + Turso Free + GitHub Free. Covers: data import → API → SEO page generation → frontend closed loop → deploy.

## When to Use

- You have structured fault code data (or any structured entity data) that maps to individual SEO pages
- You want both static SEO pages (for search engines) and a dynamic API (for developers)
- You need a closed-loop user experience: exact code → static page, keyword → API search results
- Infrastructure: Cloudflare Workers + Turso + Drizzle ORM (see `import-data-to-turso` skill for DB setup)

## Step 1: Schema Design

Design the Drizzle ORM schema for the fault codes. Two tables:

### dtc_codes — 码定义表

Key fields:
- `id` (auto-increment PK)
- `code` (e.g., "P0420") — NOT NULL, indexed
- `system` / `system_short` — full name and abbreviation (P/B/C/U)
- `description` — the fault description text
- `description_zh` — Chinese translation (SEO value)
- `manufacturer` — "GENERIC" or brand-specific
- `is_generic` — 1 for OBD standard codes, 0 for manufacturer-specific
- `cause` / `remedy` / `severity` — diagnostic info (empty at start, enriched in Phase 2)
- `related_codes` — JSON array of related DTC codes

### manufacturers — 制造商表

- `id` (PK, e.g., "BMW", "FORD")
- `display_name` / `full_name` / `country`
- `code_count` — denormalized count for fast queries

**Critical indexes:** `code`, `manufacturer`, `system_short`, composite `(code, manufacturer)`

## Step 2: Data Import

Use the `import-data-to-turso` skill for the full import pipeline. Key DTC-specific considerations:

### Multi-source dedup

When merging data from multiple sources (e.g., wal33d primary + dtcmapping supplement):

```javascript
const codeMap = new Map();
// Primary source first (higher priority)
for (const r of primaryRecords) {
  codeMap.set(`${r.code}_${r.manufacturer}`, r);
}
// Secondary source (only if key doesn't exist)
for (const r of secondaryRecords) {
  const key = `${r.code}_GENERIC`;
  if (!codeMap.has(key)) {
    codeMap.set(key, { ...r, manufacturer: "GENERIC" });
  }
}
```

### System short code extraction (⚠️ Critical — Easy to Get Wrong)

DTC records may have `type` field ("P"/"B"/"C"/"U") or `system` field ("Powertrain"/"Body"/"Chassis"/"Network"). Some records have NEITHER. The extraction logic must be defensive:

```javascript
function extractSystemShort(record, code) {
  // Priority 1: type field (most reliable)
  if (record.type && /^[PBCU]$/i.test(record.type)) {
    return record.type.toUpperCase();
  }
  // Priority 2: system full name → abbreviation
  const map = { powertrain: "P", body: "B", chassis: "C", network: "U" };
  if (record.system && map[record.system.toLowerCase()]) {
    return map[record.system.toLowerCase()];
  }
  // Priority 3: DTC code first character (last resort)
  if (code && /^[PBCU]/i.test(code[0])) {
    return code[0].toUpperCase();
  }
  return "P"; // Default fallback
}
```

**Failure symptom**: Getting `'undefined'` as a string in `system_short` column (because `v.systemShort + ''` produces `'undefined'` when the value is undefined). This happens when ALL three extraction methods fail.

### Factory reset when DELETE fails

Turso HTTP mode's `client.execute("DELETE FROM ...")` sometimes fails transiently. When it happens, use `turso db shell` to drop and recreate tables:

```bash
turso db shell <db-name> "DROP TABLE IF EXISTS dtc_codes; DROP TABLE IF EXISTS manufacturers;"
# Then re-run the import script — it will CREATE TABLE from scratch
```

## Step 3: API Service (cf-api template)

Structure the API around entity-based endpoints:

```
GET  /api/v1/dtc/{code}                           → Single code lookup
GET  /api/v1/dtc/search?q=keyword                 → Keyword search (code + description + manufacturer)
POST /api/v1/dtc/batch                            → Bulk lookup (up to 500 codes)
GET  /api/v1/dtc/stats                            → Dataset statistics
GET  /api/v1/dtc/by-manufacturer/{manufacturer}   → Codes by brand
POST /api/v1/dtc/extract                          → Extract DTC codes from text
GET  /api/v1/dtc/normalize/{code}                 → Validate and normalize a code
GET  /api/v1/manufacturers                        → Manufacturer list
```

### Cache hot paths

Use cf-core's `createCache()` to cache frequent lookups (GENERIC codes only, since manufacturer-specific codes change rarely):

```typescript
import { createCache } from "@eforge/cf-core/cache";
const cache = createCache("dtc-v1");

// In route handler:
const cached = await cache.get(cacheKey);
if (cached) return cached;

const response = c.json({ ok: true, dtc: result }, 200);
await cache.put(cacheKey, response.clone(), 3600); // 1 hour
return response;
```

### Drizzle ORM version conflict resolution

When using cf-core's `DrizzleInstance` type in a project that has its own `drizzle-orm` dependency, TypeScript sees two different type instances (due to `protected` members in Drizzle column types).

**Solution**: Don't import `DrizzleInstance` from cf-core. Use local type definition:

```typescript
// In bindings.ts — leave db as unknown (from CoreVariables)
export interface AppVariables extends CoreVariables {
  executionCtx: ExecutionContext;  // db stays as unknown from CoreVariables
}

// In routes — use a getDb() helper with type assertion
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type * as schema from "../db/schema";
type Db = LibSQLDatabase<typeof schema>;

function getDb(c: Context<AppEnv>): Db {
  return c.get("db") as unknown as Db;  // Cast through unknown to bypass protected member check
}
```

This is safe because both drizzle-orm instances are the same version (0.45.2), just seen by TypeScript as different modules due to npm hoisting. See `resolve-drizzle-version-conflicts` skill for details.

## Step 4: Static SEO Page Generation

Generate one HTML page per code using a Node.js script (`generate-pages.mjs`):

### Page types to generate

| Page type | Count | Purpose |
|-----------|-------|---------|
| `/dtc/{code}.html` | 19,000+ | Per-code detail page (primary SEO target) |
| `/p.html` / `/b.html` / `/c.html` / `/u.html` | 4 | System category index pages |
| `/manufacturers/{id}.html` | 30+ | Per-brand code listing |
| `/index.html` | 1 | Landing page with search + stats |
| More files | — | `sitemap.xml`, `robots.txt`, `_headers` |

### Per-code page SEO structure

Each page should include:
- ✅ **Title tag** with code + description
- ✅ **Meta description** with code, description, manufacturer, system
- ✅ **Canonical URL**
- ✅ **Open Graph** + **Twitter Card** meta tags
- ✅ **Schema.org JSON-LD** (`TechArticle` or `Thing` type)
- ✅ **FAQPage Schema** with 2-3 common questions about the code
- ✅ **Navigation** (back to home, related codes)
- ✅ **Google-friendly** content structure (H1, H2, paragraph)

### AI crawler optimization (GEO)

In `robots.txt`, explicitly allow AI search crawlers:

```nginx
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /
```

**Why**: Traditional SEO requires months of domain authority building. AI search engines don't care about domain age — they cite content based on structured data quality. 89% of ChatGPT citations come from pages ranked 20+ in Google.

### Batch size for large dataset generation

When generating 19,000+ pages, query the database in batches:

```javascript
const PAGE_SIZE = 500;
let offset = 0;
while (true) {
  const rows = await db.select().from(dtcCodes)
    .limit(PAGE_SIZE).offset(offset);
  if (rows.length === 0) break;
  for (const row of rows) { /* generate page */ }
  offset += PAGE_SIZE;
}
```

## Step 5: Closed-Loop Frontend (Critical — Don't Skip)

This is the most commonly overlooked step. A DTC service needs TWO search modes:

### The Two-Mode Search Pattern

```
User input
    ↓
┌─────────────────────────────────────────────────┐
│   Is it an exact DTC code? (regex: [PBCU]\d\w{3})  │
│     ├── YES → /dtc/{code}.html (static page)     │
│     └── NO  → /search.html?q={query} (API page)  │
└─────────────────────────────────────────────────┘
```

The frontend MUST:
1. **Detect exact DTC codes** with a regex (`/^[PBCU][0-9][0-9A-F]{3}$/i`)
2. **Redirect exact codes** to the pre-generated static page
3. **Send non-code queries** to the search page that calls the API

### search.html — API-Driven Results Page

The search page is an SPA that:
1. Reads `?q=` from URL
2. Calls `fetch('/api/v1/dtc/search?' + params)`
3. Renders results as clickable cards
4. Supports system filtering (P/B/C/U)
5. Supports pagination with SPA-style navigation

Key implementation:

```html
<form class="search-box" id="searchForm">
  <input type="text" id="searchInput" placeholder="Search by code or keyword...">
  <button type="submit">Search</button>
</form>
<div id="results"></div>

<script>
async function doSearch(query, system, page) {
  const params = new URLSearchParams({ q: query, limit: '30', offset: String(page * 30) });
  if (system) params.set('system', system);
  const res = await fetch('/api/v1/dtc/search?' + params.toString());
  const data = await res.json();
  // Render results as cards with links to /dtc/{code}.html
}
</script>
```

### 404.html — Intelligent Error Page

When a user hits a non-existent page, the 404 page should:
1. Display a friendly "not found" message
2. Auto-detect DTC codes in the URL path (for URLs like `/dtc/PO420.html` — typo detection)
3. Provide a search box that redirects to `search.html`
4. Link to system/landing pages

## Step 6: Deployment

```bash
# 1. Create Turso database
turso db create dtc-prod
export TURSO_URL=$(turso db show dtc-prod --url)
export TURSO_TOKEN=$(turso db tokens create dtc-prod)

# 2. Import data
cd dtc && node scripts/import-data.mjs

# 3. Generate SEO pages
SITE_URL=https://dtc.eforge.xyz node scripts/generate-pages.mjs

# 4. Deploy
npx wrangler deploy
```

## Verification Checklist

```
□ DTC codes imported (21,000+ for full dataset)
□ System short codes validated (no 'undefined' strings in DB)
□ API endpoints respond correctly (smoke test)
□ Static pages generated (one per code)
□ Exact code search → static page (check HTML title)
□ Keyword search → API results page (check search query)
□ 404 page shows for non-existent codes
□ sitemap.xml includes all pages
□ robots.txt allows AI crawlers
□ _headers sets proper Cache-Control
□ wrangler dry-run passes
```

## Related Skills

- `import-data-to-turso` — Detailed Turso import pipeline (batch INSERT, retry, DDL)
- `seo-geo-hardening` — SEO/GEO optimization (Schema.org, llms.txt)
- `resolve-drizzle-version-conflicts` — Drizzle ORM type issue solution
- `build-deploy-automation` — One-click deploy scripts
- `create-product-template` — Scaffolding new products from templates
- The shared kernel: `packages/cf-core/`
- Project templates: `templates/cf-api/`, `templates/cf-static/`