---
name: create-product-template
description: Create standardized product templates from a shared library for rapid project replication (30-min deploy)
source: auto-skill
extracted_at: '2026-05-29T11:00:00.000Z'
---

# Create Product Templates from a Shared Library

After extracting common code into a shared library (see `extract-shared-library` skill), create standardized product templates that enable "copy + configure + deploy" project creation.

## When to Use

- You have a shared library already built (e.g., `@eforge/cf-core`)
- Multiple projects share the same tech stack but differ in business logic
- Goal: new projects should go from template to production in <30 minutes
- You have 2+ project "archetypes" (e.g., e-commerce, API service, tool hub)

## Step 1: Identify Project Archetypes

Group existing projects by their **structural pattern**, not their domain:

| Archetype | Pattern | Example Projects |
|-----------|---------|-----------------|
| **Commerce** | Products + Orders + Payments + Fulfillment | eshop, ticket-shop |
| **API Service** | Tokens/Resources + Channels + Quotas | vcode, proxy-api |
| **Tool Hub** | Users + Tools Registry + Auth | xtools, converter-hub |
| **Form/Collect** | Submissions + Validation + Admin | cf-form-kit |

Each archetype becomes one template. Don't create templates per-domain — create them per-structural-pattern.

## Step 2: Design the Bootstrap Factory

The single most important abstraction: a **factory function** that creates a complete application from configuration.

```typescript
// Shared library provides the factory
export function bootstrap<TSchema>(options: BootstrapOptions<TSchema>) {
  // 1. Create Hono app
  // 2. Inject DB middleware (isolate-level connection reuse)
  // 3. Add request body size limit
  // 4. Register user's routes
  // 5. Add security headers (pre-computed, not per-request)
  // 6. Set up API/static routing split
  // 7. Return { fetch } handler
}
```

**Template entry point becomes trivial:**

```typescript
import { bootstrap } from "@eforge/cf-core/bootstrap";
import * as schema from "./db/schema";

export default bootstrap({
  schema,
  registerRoutes: (api) => {
    api.route("/products", productRoutes);
    api.route("/orders", orderRoutes);
    api.route("/admin", adminRoutes);
  },
  pageRoutes: { "/admin": "/admin.html" },
  spaRoutes: { fallback: "/index.html", paths: ["/shop", "/order"] },
  immutablePrefixes: ["/_app/assets/"],
});
```

**Key design rules:**
- Bootstrap handles ALL infrastructure (DB, security, error handling, routing split)
- Template only registers business routes and page mappings
- Security headers are pre-computed (admin vs non-admin), not per-request
- `immutablePrefixes` enables long-cache for hashed assets (saves request quota on Free tiers)

## Step 3: Standard Template File Structure

Every template follows the exact same layout:

```
templates/cf-{name}/
├── package.json           # Depends on shared library
├── tsconfig.json          # Path aliases to shared library
├── wrangler.jsonc         # Platform config (Workers/Pages)
├── README.md              # Chinese usage guide
├── .gitignore
├── src/
│   ├── index.ts           # bootstrap() call ONLY — no boilerplate
│   ├── bindings.ts        # Extends CoreBindings with project-specific vars
│   ├── config.ts          # ★ Business config (user's main edit point)
│   ├── db/schema.ts       # Imports shared tables + defines business tables
│   ├── routes/            # Business routes only
│   └── services/          # Business logic only
├── public/
│   ├── index.html         # User-facing page
│   ├── admin.html         # Admin panel (Vue 3 + Element Plus CDN)
│   └── _headers           # Security headers
├── migrations/
│   └── 0001_init.sql      # Idempotent (all IF NOT EXISTS)
├── scripts/               # Copied from templates/.shared/
│   ├── deploy.sh
│   ├── migrate.mjs
│   ├── smoke-readonly.mjs
│   └── smoke-admin.mjs
└── .github/workflows/
    └── deploy.yml         # Copied from templates/.shared/
```

**Critical rules:**
- `src/config.ts` is the **primary edit point** — well-commented, domain-specific settings
- `src/index.ts` should be <50 lines — just bootstrap() + route registration
- No `lib/` directory — everything comes from the shared library
- `bindings.ts` extends `CoreBindings`, never duplicates it

## Step 4: Shared Schema Strategy

Templates import shared tables and add business tables in ONE file:

```typescript
// src/db/schema.ts
import { systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys, apiKeys }
  from "@eforge/cf-core/db/schema";

// Re-export for convenience
export { systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys, apiKeys };

// Business tables
export const products = sqliteTable("products", { ... });
export const orders = sqliteTable("orders", { ... });
```

**SQL migration must be idempotent** — every statement uses `IF NOT EXISTS` / `OR IGNORE`. Include shared tables + business tables + seed data in one `0001_init.sql`.

## Step 5: Shared Infrastructure Files

Create a `templates/.shared/` directory with files that are identical across templates:

| File | Purpose |
|------|---------|
| `deploy.sh` | Install → typecheck → test → deploy → smoke |
| `migrate.mjs` | Read `migrations/*.sql`, execute via libsql HTTP client |
| `smoke-readonly.mjs` | Test `/api/health` returns ok, 404 handling |
| `smoke-admin.mjs` | Test admin auth (no token → 401, valid token → 200) |
| `github-actions-deploy.yml` | CI/CD: install → check → test → migrate → deploy → smoke |

Copy these into each template. When updating, update `.shared/` first, then propagate.

## Step 6: Adapter/Registry Pattern for Business Logic

Each template should use the **same architectural pattern** for extensibility:

```typescript
// Define the interface
export interface PaymentProvider {
  createPayment(order: Order): Promise<PaymentResult>;
  verifyCallback(body: unknown): Promise<CallbackResult>;
}

// Registry
class ProviderRegistry {
  private providers = new Map<string, PaymentProvider>();
  register(name: string, provider: PaymentProvider) { ... }
  get(name: string): PaymentProvider | undefined { ... }
}
```

This pattern appears in all archetypes:
- **cf-shop**: `PaymentProvider` (alipay, stripe, offline)
- **cf-api**: `ChannelAdapter` (5sim, grizzlysms) + `ServiceHandler` (sms, email)
- **cf-tools**: `ToolDriver` (hash-generator, uuid-generator, base64)

**Why uniform?** When adding a new project, developers already know the pattern. "Implement the interface, register in the registry."

## Step 7: Frontend Strategy

| Page | Technology | Rationale |
|------|-----------|-----------|
| User-facing | Native HTML/JS + dark theme CSS | Zero build cost, Cache API friendly |
| Admin panel | Vue 3 + Element Plus via CDN | No build step, rich components |
| Complex SPA (optional) | Vue 3 + Vite | Only when needed |

**Admin panel template** (`public/admin.html`):
- Vue 3 via `<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js">`
- Element Plus via CDN
- Single file, no build step
- Communicates with API via `fetch()` + `Authorization: Bearer` header

## Step 8: Build All Templates in Parallel

Use parallel agents to create multiple templates simultaneously:

```
Agent 1 → cf-shop (commerce archetype)
Agent 2 → cf-api (API service archetype)
Agent 3 → cf-tools (tool hub archetype)
```

Each agent gets the same instructions with archetype-specific table/route requirements. This ensures consistency while allowing parallel execution.

## Step 9: Enforce Cross-Template Uniformity

Three configuration files must be **byte-identical** (except for project-specific values) across ALL templates:

### tsconfig.json — Must be identical

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@eforge/cf-core": ["../../packages/cf-core/src/index.ts"],
      "@eforge/cf-core/*": ["../../packages/cf-core/src/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", ".wrangler"]
}
```

**Why both paths entries?** Some templates import from root (`@eforge/cf-core`), others from subpaths (`@eforge/cf-core/db`). Both must resolve.

### bindings.ts — Field names MUST match deploy scripts

The most dangerous bug: if `bindings.ts` declares `ENCRYPTION_KEY` but the deploy script uploads `CREDENTIALS_ENCRYPTION_KEY`, the Worker gets `undefined` at runtime. **This is silent and fatal.**

```typescript
// ❌ WRONG — name doesn't match deploy script
export interface AppBindings extends CoreBindings {
  ENCRYPTION_KEY?: string;  // Deploy script uploads CREDENTIALS_ENCRYPTION_KEY
}

// ✅ CORRECT — exact match with deploy script secret name
export interface AppBindings extends CoreBindings {
  CREDENTIALS_ENCRYPTION_KEY?: string;
}
```

**Audit method**: For each template, compare bindings.ts field names against deploy script secret names:

```bash
# What deploy scripts upload
grep -o 'cred_save "[^"]*"' templates/.deploy/*.sh | sort -u

# What bindings.ts declares
grep -oP '\b[A-Z_]{3,}\??\s*:' templates/cf-*/src/bindings.ts | sort -u
```

### package.json dependencies — Must be identical

All templates must declare the same dependency versions for shared stack (hono, drizzle-orm, zod, @libsql/client, etc.).

## Step 10: Validation Checklist

After creating each template, verify:

```
□ Uses bootstrap() factory (src/index.ts < 50 lines)
□ Imports from @eforge/cf-core (grep -r "@eforge/cf-core" src/)
□ Extends CoreBindings (not duplicates it)
□ bindings.ts field names match deploy script secret names exactly
□ Imports shared schema tables
□ Has complete SQL migration (idempotent)
□ Has CI/CD pipeline
□ Has smoke tests (readonly + admin)
□ Has Chinese README with copy-deploy instructions
□ Frontend pages exist (index.html + admin.html)
□ wrangler.jsonc configured correctly
□ tsconfig.json is byte-identical to other templates (except project-specific)
□ package.json dependency versions match other templates
□ All @eforge/cf-core/X imports have corresponding exports in package.json
```

## Step 11: Documentation Trio

Create three documents:

1. **Architecture Plan** (`docs/046_*.md`) — the "why" and cross-project comparison
2. **Implementation Record** (`docs/047_*.md`) — the "what" with file counts, test results, decisions
3. **Usage Guide** (`docs/048_*.md`) — the "how" for end users creating new projects

## Key Lessons Learned

1. **`config.ts` is the UX of your template** — if users can't figure out what to change, the template fails
2. **Idempotent migrations** — `CREATE TABLE IF NOT EXISTS` everywhere, no ordering dependencies
3. **Shared scripts in `.shared/`** — single source of truth, copy to templates
4. **Admin panel via CDN** — zero build cost, works on Free tier, rich UI
5. **Bootstrap factory** — the entry point should be a configuration object, not boilerplate
6. **Same adapter pattern everywhere** — interface + registry + implementations
7. **Parallel template creation** — use agents to build all templates simultaneously
8. **Validation checklist** — grep for imports, check file counts, verify bootstrap usage

## What Comes Next

After creating templates, the next step is adding **optional business features as flat feature modules** — payments, email, webhooks, smart routing, anti-abuse detection. Templates opt into features via subpath imports:

```typescript
import { AlipayProvider, alipayFactory } from "@eforge/cf-core/features/payment";
import { EmailService } from "@eforge/cf-core/features/email";
import { ThompsonRouter } from "@eforge/cf-core/features/thompson-router";
```

See the `build-plugin-system` skill for the full feature module approach (flat directory structure, ProviderFactory pattern, 4 feature design patterns).

The full progression is: **Core Library → Templates → Feature Modules → Deploy Automation**

## References

- Templates: `templates/cf-shop/` (28 files), `templates/cf-api/` (27 files), `templates/cf-tools/` (26 files)
- Shared infrastructure: `templates/.shared/`
- Deploy automation: `templates/.deploy/` (8 scripts + 3 CI/CD workflows, see `build-deploy-automation` skill)
- Usage guide: `docs/048_产品模板使用指南_2026-05-29.md`
- Implementation record: `docs/047_cf-core共享内核实施记录_2026-05-29.md` (Phase 2 section)
- Prerequisite skill: `extract-shared-library` (Phase 1)
- Next skills: `build-plugin-system` (Phase 3), `build-deploy-automation` (Phase 4)
