---
name: resolve-drizzle-version-conflicts
description: Resolve Drizzle ORM version conflicts in monorepo — Option A keeps bootstrap() with as-cast (recommended), Option B is independent DB init (alternative)
source: auto-skill
extracted_at: '2026-05-30T10:17:39.017Z'
---

# Resolve Drizzle ORM Version Conflicts in Monorepo

**推荐方案：保留 `bootstrap()` 标准流水线**，在路由层用 `as unknown as Db` 转型解决类型冲突。这比放弃 bootstrap() 更干净。

When creating a **new product project** in a monorepo that depends on `@eforge/cf-core` via `"file:../packages/cf-core"`, you will encounter **Drizzle ORM version conflicts** between the project's `node_modules/drizzle-orm` and cf-core's `node_modules/drizzle-orm`. TypeScript sees them as incompatible types, producing errors like:

```
Type 'SQLiteColumn<...>' is not assignable to type 'SQLiteColumn<...>'.
  Property 'config' is protected but type 'Column<T, TRuntimeConfig, TTypeConfig>'
  is not a class derived from 'Column<T, TRuntimeConfig, TTypeConfig>'.
```

This skill describes the **diagnosis** and **resolution** for this issue.

## When to Use

- You create a new project in the monorepo (e.g., `dtc/`, `pricing-api/`, `image-tool/`)
- The project depends on `@eforge/cf-core` as a `file:` dependency
- You run `npm run type-check` and get Drizzle type errors
- The errors mention "not assignable", "protected property", or "separate declarations of a private property"

## Root Cause

```
Monorepo Project (e.g., dtc/)          cf-core package
  ├── node_modules/                        ├── node_modules/
  │   ├── drizzle-orm@0.45.2               │   ├── drizzle-orm@0.45.2
  │   │   └── SQLiteColumn                 │   │   └── SQLiteColumn (SAME CLASS)
  │   └── @eforge/cf-core                  │   └── ...
  │       └── (file: link to cf-core)
```

Even though both resolve to `drizzle-orm@0.45.2`, **npm installs them as separate copies** under different `node_modules/` paths. TypeScript resolves each import independently and sees two class declarations that happen to have the same name but are technically different classes (they have a `protected config` property from different declaration instances).

This only happens with **`file:` dependencies in monorepos**. If cf-core were published to npm (even to GitHub Packages), npm would hoist and dedupe the dependency, resolving the conflict.

## The Two Options

### Option A: Keep `bootstrap()` + Cast (Recommended ⭐)

Keep using cf-core's standard `bootstrap()` pipeline. The Drizzle type conflict is contained with a **type-safe cast pattern** — accept `db: unknown` from Hono Context, then cast to the project's own `Db` type in route handlers. This preserves the full pipeline (security headers, error handling, route splitting, static assets).

### Option B: Switch to Independent DB Init Pattern (Alternative)

Don't use cf-core's **`bootstrap()`** factory. Instead, use **eshop's DB init pattern** — the project manages its own database initialization independently.

> ⚠️ **Historical note:** Option B was attempted first in the DTC project (2026-05-30) but rejected because the user rightfully required using the standard pipeline. If you're building a product in this monorepo, **prefer Option A** unless you have specific reasons to avoid bootstrap().

## Resolution Steps (Option A — Recommended: Keep bootstrap())

### Step 1: Keep `bindings.ts` Minimal

Use `CoreBindings`/`CoreVariables` from cf-core but keep `db` as `unknown` (CoreVariables default):

```typescript
// src/bindings.ts — db stays unknown, routes cast via getDb()
import type { CoreBindings, CoreVariables } from "@eforge/cf-core/types";

export interface AppBindings extends CoreBindings {
  ASSETS: Fetcher;
}

export interface AppVariables extends CoreVariables {
  // db stays as 'unknown' from CoreVariables — no Drizzle type import from cf-core
  executionCtx: ExecutionContext;
}

export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}
```

### Step 2: Define `Db` Type in Service Layer

Define the `Db` type using the project's own `drizzle-orm` (from local `node_modules`):

```typescript
// src/services/dtc-service.ts — define Db using local drizzle-orm
import { eq, sql, and, count as drizzleCount, inArray } from "drizzle-orm";
import { dtcCodes, manufacturers } from "../db/schema";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type * as schema from "../db/schema";

/** 数据库实例类型 — 使用本地 drizzle-orm 定义 */
export type Db = LibSQLDatabase<typeof schema>;
```

Then use `Db` as the parameter type for all service functions:

```typescript
export async function lookup(db: Db, code: string, manufacturer = "GENERIC"): Promise<DtcResult | null> {
  const record = await db
    .select()
    .from(dtcCodes)
    .where(and(eq(dtcCodes.code, code), eq(dtcCodes.manufacturer, manufacturer)))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  // ...
}

export async function search(db: Db, keyword: string, options?: { ... }): Promise<{ ... }> {
  // db.select().from(dtcCodes).where(...)
}
```

### Step 3: Add `getDb()` Cast Helper in Route Layer

In each route file, add a helper that casts `unknown` → `Db`:

```typescript
// src/routes/dtc.ts — cast helper bridges the type gap
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../bindings";
import type { Db } from "../services/dtc-service";
import { ok, fail } from "@eforge/cf-core/http";
import { lookup, search } from "../services/dtc-service";

/** 从 Hono Context 获取类型安全的 Db 实例（运行时由 bootstrap 保证 db 已初始化） */
function getDb(c: Context<AppEnv>): Db {
  return c.get("db") as unknown as Db;
}

const dtc = new Hono<AppEnv>();

dtc.get("/:code", async (c) => {
  const db = getDb(c);
  const result = await lookup(db, c.req.param("code"));
  if (!result) return fail(c, "未找到", 404);
  return ok(c, { dtc: result });
});

export { dtc };
```

### Step 4: Keep `index.ts` Using `bootstrap()`

Continue using the standard pipeline — this is the whole point of Option A:

```typescript
// src/index.ts — UNCHANGED, uses bootstrap() normally
import { bootstrap } from "@eforge/cf-core/bootstrap";
import * as schema from "./db/schema";
import { health } from "./routes/health";
import { dtc } from "./routes/dtc";

export default bootstrap({
  schema,
  apiPrefix: "/api",
  maxBodySize: 50 * 1024,
  securityHeaders: {},
  registerRoutes: (api) => {
    api.route("/health", health);
    api.route("/v1/dtc", dtc);
  },
});
```

### Step 5: Verify

```bash
npm run type-check   # Must pass with 0 errors
npm test             # Must pass
```

## Why the Cast Is Safe

The cast `as unknown as Db` is safe because:

1. **Both drizzle-orm instances are the same version** (`0.45.2` in both `dtc/node_modules` and `cf-core/node_modules`)
2. **The classes are structurally identical** — same methods, same properties, same generics
3. **TypeScript rejects them only because of `protected` class members** — TypeScript treats `protected` members from different module declarations as different, even when they're identical
4. **At runtime, the JavaScript objects are completely compatible** — the cast is erased in JS and has zero performance cost

## What You Still CAN Import from cf-core

Not everything from cf-core causes version conflicts. The following modules are **safe** because they don't export Drizzle types:

| Subpath | Safe? | Notes |
|---------|-------|-------|
| `@eforge/cf-core/http` | ✅ | Pure functions (ok, fail, maskContact) |
| `@eforge/cf-core/security` | ✅ | Pure crypto functions (sha256, verifyTurnstile) |
| `@eforge/cf-core/cache` | ✅ | Cache API wrapper |
| `@eforge/cf-core/error` | ✅ | Error classification |
| `@eforge/cf-core/logger` | ✅ | Structured logging |
| `@eforge/cf-core/crypto` | ✅ | AES-256-GCM encrypt/decrypt |
| `@eforge/cf-core/rate-limit` | ✅ | Rate limiter (no drizzle deps) |
| `@eforge/cf-core/config` | ✅ | System config reader |
| `@eforge/cf-core/idempotency` | ⚠️ | Has drizzle queries internally but only exports pure functions |
| `@eforge/cf-core/auth/jwt` | ✅ | JWT sign/verify |
| `@eforge/cf-core/auth/password` | ✅ | Password hashing |
| `@eforge/cf-core/middleware` | ⚠️ | Some middleware imports drizzle types — check before using |
| `@eforge/cf-core/db` | ❌ | **Drizzle version conflict** |
| `@eforge/cf-core/db/schema` | ❌ | **Drizzle version conflict** |
| `@eforge/cf-core/bootstrap` | ❌ | **Drizzle version conflict** |
| `@eforge/cf-core/types` | ❌ | Re-exports Drizzle types (CoreBindings includes drizzle types) |

**Rule of thumb:** If a cf-core module's public API includes Drizzle types (like `DrizzleInstance`, `DrizzleType`, or schema types), it will cause version conflicts. Import it at your own risk.

## Verification Checklist (Option A — Keep bootstrap)

```
□ src/bindings.ts extends CoreBindings/CoreVariables with db: unknown (no Drizzle type import from cf-core)
□ src/services/*.ts define their own Db type using local drizzle-orm (LibSQLDatabase<typeof schema>)
□ src/routes/*.ts use getDb() helper with as unknown as Db cast
□ src/index.ts uses bootstrap() from @eforge/cf-core/bootstrap
□ npm run type-check passes with 0 errors
□ npm test passes
```

## References

- Working pattern: `dtc/src/bindings.ts` — CoreBindings + CoreVariables with db: unknown
- Working pattern: `dtc/src/services/dtc-service.ts` — Db = LibSQLDatabase<typeof schema> (local drizzle-orm)
- Working pattern: `dtc/src/routes/dtc.ts` — getDb() helper with as unknown as Db
- Working pattern: `dtc/src/index.ts` — bootstrap() from cf-core
- Audit document: `docs/702_DTC服务审核报告_20260530.md`
- Strategic analysis: `docs/701_DTC故障码查询服务战略分析_20260530.md`