---
name: extract-shared-library
description: Systematically extract common code from multiple similar projects into a shared library package
source: auto-skill
extracted_at: '2026-05-29T09:38:31.599Z'
---

# Extract Shared Library from Multiple Projects

When you have 2+ similar projects with duplicated infrastructure code, extract the common parts into a shared library package.

## Step 1: Parallel Source Audit

**Read ALL source files from ALL projects in parallel** before designing anything. Use multiple agents to read simultaneously:

```bash
# For each project, read in parallel:
# - All lib/* files
# - All db/* files  
# - All middleware/* files
# - Entry point (index.ts)
# - Type definitions (bindings.ts)
# - Any services/* that look shared
```

**Why parallel?** Sequential reading creates context drift. You need to see all implementations side-by-side to identify exact diff patterns.

**What to look for:**
- Files with identical names across projects (e.g., `lib/http.ts`, `lib/security.ts`)
- Functions with the same signature but different implementations
- Type definitions that are nearly identical
- Database schema tables that appear in multiple projects

## Step 2: Classify Duplication Patterns

Categorize each duplicated module:

| Pattern | Example | Strategy |
|---------|---------|----------|
| **Near-identical** | `lib/http.ts` in all 3 projects | Merge directly, take the most complete version |
| **Same interface, different backend** | Rate limiting: DB vs KV vs Memory | Define interface, implement all backends |
| **Complementary features** | Auth: Bearer token vs X-Header | Support both via configuration option |
| **Project-specific** | Payment processing in only 1 project | Keep in project, don't extract |

## Step 3: Design with Generics, Not Concrete Types

**Critical rule**: The shared library must NOT bind to any project's specific `AppEnv` type.

```typescript
// ❌ WRONG - binds to specific project
export function ok(c: Context<AppEnv>, data: object) { ... }

// ✅ RIGHT - generic constraint
export function ok<E extends { Bindings: Record<string, unknown> }>(
  c: Context<E>, 
  data: object
) { ... }
```

**Why?** Each project has its own `AppEnv` with different bindings. Generics let the same function work across all projects.

## Step 4: Handle Environment-Specific APIs

Some APIs exist in production but not in test environments. Provide fallbacks:

```typescript
// crypto.subtle.timingSafeEqual exists in Workers but not Node.js
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  
  // XOR comparison works in both Node.js and Workers
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}
```

**Pattern**: Use the most portable implementation that works everywhere, not the "best" implementation for one environment.

## Step 5: Unify Divergent Implementations Behind Interfaces

When projects solve the same problem differently, define an interface and implement all variants:

```typescript
// Define the contract
export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

// Implement all backends
export class MemoryRateLimiter implements RateLimiter { ... }
export class KvRateLimiter implements RateLimiter { ... }
export class DbRateLimiter implements RateLimiter { ... }
```

**Why?** Projects can choose the backend that fits their infrastructure without changing call sites.

## Step 6: Merge Complementary Auth Patterns

When projects use different auth mechanisms, support both:

```typescript
export interface AdminAuthOptions {
  mode?: "bearer" | "header" | "both";
}

export function createAdminAuth(options: AdminAuthOptions = {}) {
  const { mode = "both" } = options;
  
  return async (c: Context, next: Next) => {
    let token = "";
    if (mode === "bearer" || mode === "both") {
      token = getBearerToken(c);
    }
    if (!token && (mode === "header" || mode === "both")) {
      token = c.req.header("X-Admin-Token") || "";
    }
    // ... validate
  };
}
```

**Default to "both"** for maximum compatibility during migration.

## Step 7: Extract Shared Database Schema

Identify tables that appear in multiple projects with identical structure:

```typescript
// packages/cf-core/src/db/schema.ts
export const systemConfig = sqliteTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const adminAuditLogs = sqliteTable("admin_audit_logs", { ... });
export const rateLimitWindows = sqliteTable("rate_limit_windows", { ... });
```

Projects then import and extend:

```typescript
// projects/eshop/src/db/schema.ts
import { systemConfig, adminAuditLogs } from "@eforge/cf-core/db/schema";

// Project-specific tables
export const products = sqliteTable("products", { ... });
export const orders = sqliteTable("orders", { ... });
```

## Step 8: Write Tests Early, Fix Failures Immediately

Write tests as you implement each module. When tests fail, fix immediately:

**Common failures:**
1. **Environment API mismatches** — `timingSafeEqual` not in Node.js → use XOR fallback
2. **Missing return values** — first-call edge cases not returning expected fields
3. **Type mismatches** — generic constraints too loose or too strict

**Test coverage targets:**
- Pure functions (http, crypto, error): 90%+
- Database operations: Mock or skip (requires real DB)
- Middleware: Integration tests with real Hono context

## Step 9: Create Two Documents

**Document 1: The Plan (before implementation)**
- List all modules to extract
- Show which project each comes from
- Explain design decisions (generics, interfaces, fallbacks)
- Define the package structure

**Document 2: The Implementation Record (after completion)**
- File-by-file breakdown with line counts
- Test results (X tests, Y passed)
- Key design decisions and why
- Migration guide for existing projects
- Next steps (Phase 2, Phase 3)

## Step 10: Migration Strategy

Don't refactor all projects at once. Use a phased approach:

**Phase 1**: New projects use the shared library from day one
**Phase 2**: Migrate the most mature project first (proves the library works)
**Phase 3**: Gradually migrate remaining projects

**For each project migration:**
1. Replace `lib/*` imports with `@eforge/cf-core/*` imports
2. Replace local schema with `@eforge/cf-core/db/schema` imports
3. Replace `index.ts` boilerplate with `bootstrap()` call
4. Run tests to verify nothing broke
5. Delete the now-redundant local files

## Step 11: Verify package.json exports Completeness

Every subpath that consumers `import` MUST appear in `package.json` exports. A missing export works with tsconfig `paths` but breaks strict bundlers.

**Audit method**: grep all consumer imports, compare against exports:

```bash
# Find all subpath imports used by consumers
grep -rh "@eforge/cf-core/" templates/*/src/ | grep -oP '"@eforge/cf-core/[^"]+' | sort -u

# Compare with exports in package.json
jq -r '.exports | keys[]' packages/cf-core/package.json | sort
```

**Common miss**: `./types` — consumers do `import type { CoreBindings } from "@eforge/cf-core/types"` but `./types` isn't in exports. It works via tsconfig paths but fails with strict bundlers.

**Rule**: If any consumer imports `@eforge/cf-core/X`, then `"./X": "./src/X.ts"` MUST be in exports.

## Key Lessons Learned

1. **Parallel reading is non-negotiable** — you can't design a shared library without seeing all implementations side-by-side
2. **Generics over concrete types** — the #1 mistake is binding to one project's types
3. **Portable implementations** — use XOR instead of timingSafeEqual, Map instead of WeakRef, etc.
4. **Interface + multiple implementations** — don't force one backend on all projects
5. **Default to compatibility** — auth mode="both", rate-limiter with fallback, etc.
6. **Test in the target environment** — Node.js tests catch Workers-incompatible code early (e.g., `timingSafeEqual` not in Node.js)
7. **Document both plan and implementation** — future you needs both the "why" and the "what"
8. **RSA/crypto code is portable** — Web Crypto API (signRSA2, AES-GCM, PBKDF2) works identically in Workers and Node.js. Extract it once, use everywhere
9. **Separate core from plugins** — infrastructure (DB, auth, HTTP) belongs in core; business features (payments, email, smart routing) belong in plugins. See `build-plugin-system` skill
10. **Verify exports completeness** — every subpath consumers import must be in package.json exports; tsconfig paths is not enough
11. **Token naming is a hard contract** — field names in bindings.ts MUST exactly match the secret names that deploy scripts upload; mismatches cause silent `undefined` at runtime (fatal). See `build-deploy-automation` Step 8 for the full naming table

## Example Package Structure

```
packages/cf-core/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts              # Unified exports
│   ├── types.ts              # Shared type constraints
│   ├── http.ts               # ok/fail/maskContact/csvEscape
│   ├── security.ts           # sha256/IP hash/Turnstile/headers
│   ├── rate-limit.ts         # Memory/KV/DB backends
│   ├── cache.ts              # Workers Cache API
│   ├── idempotency.ts        # Atomic UPSERT + sentinel
│   ├── audit.ts              # Fire-and-forget logging
│   ├── config.ts             # SystemConfig class
│   ├── bootstrap.ts          # Worker entry factory
│   ├── error.ts              # classifyError + retryWithBackoff
│   ├── logger.ts             # Structured JSON logging
│   ├── crypto.ts             # AES-256-GCM + UUID
│   ├── db/
│   │   ├── schema.ts         # Shared tables
│   │   └── connection.ts     # Isolate-level connection reuse
│   ├── auth/
│   │   ├── jwt.ts            # JWT sign/verify
│   │   └── password.ts       # PBKDF2 hashing
│   └── middleware/
│       ├── admin-auth.ts     # Bearer + X-Header dual mode
│       └── api-key-auth.ts   # SHA256 + atomic quota
└── tests/
    ├── http.test.ts
    ├── security.test.ts
    └── ...
```

## When NOT to Extract

- Projects have **fundamentally different architectures** (REST vs GraphQL vs RPC)
- Shared code is **less than 500 lines** — not worth the package overhead
- Projects are **moving in different directions** — forced sharing creates friction
- You have **only 1 project** — premature abstraction

## What Comes Next

After extracting the shared library, the next steps are:

1. **Phase 2: Product Templates** — standardized project starters enabling "copy + configure + deploy" in <30 minutes. See the `create-product-template` skill.
2. **Phase 3: Feature Modules** — optional business features (payments, email, webhooks, smart routing) as flat feature modules. See the `build-plugin-system` skill.

The full progression is: **Core Library → Templates → Feature Modules → Deploy Automation**

## References

- Implementation example: `packages/cf-core/` (19 modules, 53 core tests + 28 feature tests, all passing)
- Plan document: `docs/046_批量产品标准化架构方案_三项目横向对比_2026-05-29.md`
- Implementation record: `docs/047_cf-core共享内核实施记录_2026-05-29.md` (4 phases)
- Next skills: `create-product-template` (Phase 2), `build-plugin-system` (Phase 3), `build-deploy-automation` (Phase 4)
