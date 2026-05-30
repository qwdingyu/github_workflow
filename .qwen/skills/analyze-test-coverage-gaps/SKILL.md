---
name: analyze-test-coverage-gaps
description: Systematically audit test coverage gaps, prioritize by risk level, and fill critical gaps before production deployment
source: auto-skill
extracted_at: '2026-05-30T13:30:00.000Z'
---

# Analyze Test Coverage Gaps and Fill Critical Gaps

Before declaring a shared library or product template "production ready", systematically audit which modules lack tests, prioritize by risk level, and fill the most critical gaps. This prevents the common trap of having 80+ tests that cover only "easy" pure-function modules while entry points, auth, and payment modules remain untested.

## When to Use

- Before launching any product to production
- After building a shared library with multiple modules
- When test count looks good (80+) but you're unsure what's actually covered
- When a user asks "is our testing sufficient?"
- After a production incident reveals an untested code path

## Step 1: Build the Source-to-Test Map

For every source file, identify whether a corresponding test file exists. This reveals the coverage landscape at a glance.

### How to audit

For a typical shared library at `packages/cf-core/`:

1. **List all source files** in `src/` and `features/` (excluding `index.ts` re-exports and pure type files)
2. **List all test files** in `tests/` and `features/*/tests/`
3. **Map each source file to its test file** (if one exists)
4. **Count exported functions/classes per source file**
5. **Count `it()`/`test()` calls per test file**

### Output format

| Source file | Exports | Test file | Test count | Coverage |
|-------------|---------|-----------|------------|----------|
| `bootstrap.ts` | 1 fn, 1 interface | ❌ None | 0 | **UNTESTED** |
| `middleware/admin-auth.ts` | 1 fn, 1 interface | ❌ None | 0 | **UNTESTED** |
| `features/payment/index.ts` | 4 fns, 1 class | ❌ None | 0 | **UNTESTED** |
| `db/connection.ts` | 5 fns, 1 type | ❌ None | 0 | **UNTESTED** |
| `crypto.ts` | 4 fns | `tests/crypto.test.ts` | 8 | ✅ Full |
| `http.ts` | 8 fns | `tests/http.test.ts` | 12 | Partial (4/8) |

### Key metric: Module-level coverage

Calculate the percentage of modules (not lines) that have at least one test:

```
Modules needing tests: 21
Modules with tests: 11
Modules with zero tests: 10
Module coverage: 52%
```

**52% module coverage with 81 tests** means the tests are concentrated in a few well-tested modules while half the codebase has zero coverage. This is the gap this skill addresses.

## Step 2: Prioritize by Risk Level

Not all untested modules are equally dangerous. Prioritize using this risk framework:

| Risk Level | Module Type | Why Critical | Examples |
|-----------|-------------|-------------|---------|
| 🔴 **P0** | Entry points | Every request flows through here; bugs affect all users | `bootstrap.ts`, main middleware |
| 🔴 **P0** | Auth/Security | Security breaches, unauthorized access | `admin-auth.ts`, `api-key-auth.ts` |
| 🔴 **P0** | Money | Financial loss, chargebacks, fraud | `payment/`, `refund`, `subscription` |
| 🟡 **P1** | Data integrity | Corrupt or lost data | `db/connection.ts`, `idempotency.ts` |
| 🟡 **P1** | Infrastructure | System stability | `config.ts`, `cache.ts` |
| 🟢 **P2** | Utilities | Localized impact, easy to catch | `logger.ts`, remaining `http.ts` functions |
| 🟢 **P3** | Features (optional) | Only used by some templates | `telegram-miniapp/`, remaining `email/` |

### Risk assessment questions

For each untested module, ask:
1. **How many code paths?** — More branches = more potential bugs
2. **What happens if it breaks?** — "All requests fail" vs "one edge case misbehaves"
3. **Is it security-sensitive?** — Auth, crypto, payment always get highest priority
4. **Is it a recent change?** — Newly modified code is more likely to have bugs
5. **Has it been tested manually?** — Manual testing is not a substitute for automated tests, but reduces immediate risk

## Step 3: Write Tests for P0 Modules First

### Testing patterns by module type

**Entry point (bootstrap/factory):**

```typescript
// Mock the infrastructure dependencies
vi.mock("../src/db/connection", () => ({
  initDatabaseWithHealthCheck: vi.fn().mockResolvedValue({ mock: true }),
}));

// Create a minimal app for testing
function createApp(opts = {}) {
  return bootstrap({
    registerRoutes: (api) => {
      api.get("/health", (c) => c.json({ status: "ok" }));
      api.get("/error", () => { throw new Error("boom"); });
    },
    ...opts,
  });
}

// Mock the ASSETS binding (static files)
function mockAssets(files = {}) {
  return {
    fetch: vi.fn(async (req) => {
      const url = new URL(req.url);
      return new Response(files[url.pathname] ?? `content:${url.pathname}`, { status: 200 });
    }),
  };
}

// Test each routing branch
it("GET /api/health → 200 JSON", async () => { ... });
it("GET /api/unknown → 404 JSON", async () => { ... });
it("GET /admin → returns admin.html + admin security headers", async () => { ... });
it("Content-Length over limit → 413", async () => { ... });
it("DB init failure → 503 for non-health, degraded for health", async () => { ... });
```

**Target: 15-22 tests** covering: API routing, error handling, request size limits, static asset routing, SPA routing, security headers, DB failure degradation.

**Auth middleware:**

```typescript
// Test each mode (bearer, header, both)
// Test security edge cases (default token, missing token, wrong token)
// Test the timing-safe comparison path

it("未配置 ADMIN_TOKEN → 503", async () => { ... });
it("default token on localhost → allowed", async () => { ... });
it("default token on production domain → 503", async () => { ... });
it("valid Bearer token → 200", async () => { ... });
it("Bearer mode ignores X-Admin-Token", async () => { ... });
```

**Target: 12-15 tests** covering: unconfigured state, security checks, each auth mode, mode isolation.

**Payment/Crypto:**

```typescript
// Generate real test key pairs (don't hardcode fake keys)
async function generateTestKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, ... },
    true, ["sign", "verify"],
  );
  // Export to PEM format
}

// Test sign → verify round-trip
it("sign + verify round-trip", async () => { ... });
it("tampered params → verify fails", async () => { ... });
it("missing sign field → false", async () => { ... });

// Test registry/factory pattern
it("empty factories → null", () => { ... });
it("multiple factories → select by priority", () => { ... });
it("unavailable factory → skipped", () => { ... });
```

**Target: 15-20 tests** covering: signature round-trip, tamper detection, factory registry, availability checks.

## Step 4: Verify and Report

After writing tests for P0 modules:

```bash
# Run full test suite
cd packages/cf-core && npx vitest run

# Expected output:
# Test Files  14 passed (14)
#      Tests  137 passed (137)
# Before: 81 tests → After: 137 tests (+69%)
```

### Coverage improvement report

| Module | Before | After | Tests Added |
|--------|--------|-------|-------------|
| bootstrap.ts | 0 tests | 22 tests | Entry point fully covered |
| admin-auth.ts | 0 tests | 15 tests | Auth defense fully covered |
| payment/ | 0 tests | 19 tests | RSA2 + registry covered |
| **Total** | **81** | **137** | **+56** |

## Step 5: Track Remaining Gaps

Document what's still untested and why it's acceptable (or not):

| Module | Risk | Reason to defer | When to test |
|--------|------|----------------|-------------|
| `db/connection.ts` | P1 | Requires real Turso connection for meaningful tests | Integration test phase |
| `idempotency.ts` | P1 | Requires real DB; unit tests would just mock everything | Integration test phase |
| `config.ts` | P2 | Simple key-value store, low branch complexity | When bugs appear |
| `cache.ts` | P2 | Thin wrapper around Cache API | When cache bugs appear |

**Rule: Document WHY you're deferring, not just WHAT.** "Requires real DB" is a valid reason. "Haven't gotten to it" is not.

## Key Lessons Learned

1. **Test count is misleading** — 81 tests sounds good, but if they only cover crypto/hash/utility functions while bootstrap/auth/payment have zero tests, the system is fragile. Always check module-level coverage, not just test count.

2. **Pure functions get tested first because they're easy** — this creates a false sense of security. The hard-to-test modules (entry points with many branches, middleware with side effects, payment with external APIs) are exactly the ones that need tests most.

3. **Mock the infrastructure, test the logic** — for entry point tests, mock the DB connection (`vi.mock("../src/db/connection")`) and the ASSETS binding. You're testing routing logic, not database connectivity.

4. **Generate real test keys for crypto tests** — don't hardcode fake PEM strings. Use `crypto.subtle.generateKey()` to create real RSA key pairs in `beforeEach`. This catches real-world key format issues.

5. **Test the failure paths, not just happy paths** — "DB down → 503" is more important than "DB up → 200". "Invalid token → 401" is more important than "valid token → 200". Failure paths are where bugs hide.

6. **Document deferred tests with reasons** — "db/connection.ts: requires real Turso connection" is honest. Leaving it undocumented means the next person doesn't know if it was intentionally skipped or forgotten.

7. **P0 test count targets**: Entry points need 15-22 tests (many branches), auth middleware needs 12-15 (multiple modes × edge cases), payment/crypto needs 15-20 (sign/verify round-trips + factory patterns).

8. **Use `vi.mock()` at module level for entry point tests** — the bootstrap function calls `initDatabaseWithHealthCheck()` internally. Mocking this at the module level (not per-test) keeps tests fast and focused on routing logic.

## References

- Example test files: `packages/cf-core/tests/bootstrap.test.ts` (22 tests), `packages/cf-core/tests/admin-auth.test.ts` (15 tests), `packages/cf-core/features/payment/tests/index.test.ts` (19 tests)
- Test configuration: `packages/cf-core/vitest.config.ts` (coverage thresholds: functions 70%, branches 50%, lines 60%)
- Related skills: `verify-deployment-end-to-end` (E2E deployment testing), `create-product-template` (scaffold script testing)
