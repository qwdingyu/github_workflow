---
name: build-plugin-system
description: Add optional business features (payments, email, webhooks, routing) as flat feature modules to a shared library — avoid over-engineering with abstract plugin interfaces
source: auto-skill
extracted_at: '2026-05-29T12:00:00.000Z'
updated_at: '2026-05-29T13:30:00.000Z'
---

# Build Feature Modules for a Shared Library

After creating a shared library (Phase 1) and product templates (Phase 2), add optional business features as **flat feature modules** that templates import directly.

## ⚠️ Critical Anti-Pattern: Don't Over-Engineer

The initial version of this skill recommended abstract plugin interfaces (`PluginBase`, `ServicePlugin`, `RoutePlugin`) and a `PluginRegistry` class. **These were dead code** — no template ever consumed them. After honest review, the system was simplified:

| Removed (dead code) | Why |
|---|---|
| `PluginBase` / `ServicePlugin` / `RoutePlugin` interfaces | No code consumed them, YAGNI |
| `PluginRegistry` class | No template used it |
| `payment-core` as separate package | Only one consumer (payment-alipay) |
| `src/` subdirectories per plugin | One file per feature, no need for nesting |
| The "plugin" concept itself | Adds cognitive overhead; they're just library functions |

**Lesson**: Start with plain library functions. Add abstractions only when 2+ consumers demand them.

## When to Use

- Your shared library handles infrastructure (DB, auth, security, HTTP) but NOT business features
- Different templates need different optional features (shop needs payments, API service needs smart routing)
- You want "pay for what you use" — templates only import features they need

## Step 1: Use Flat Directory Structure

```
packages/cf-core/features/
├── payment/
│   ├── index.ts              # PaymentProvider interface + AlipayProvider + factory
│   └── tests/index.test.ts
├── email/
│   ├── index.ts              # EmailService + template interpolation
│   └── tests/index.test.ts
├── webhook/
│   ├── index.ts              # WebhookService + HMAC signing + retry
│   └── tests/index.test.ts
├── thompson-router/
│   ├── index.ts              # ThompsonRouter + Beta sampling + Wilson Score
│   └── tests/index.test.ts
├── anti-abuse/
│   ├── index.ts              # AntiAbuseService + 4 abuse types
│   └── tests/index.test.ts
└── telegram-miniapp/
    ├── index.ts              # Platform detection + theme mapping
    └── tests/index.test.ts
```

**Rules:**
- One `index.ts` per feature — no `src/` subdirectory
- Tests live in `{feature}/tests/index.test.ts`
- No shared `index.ts` re-exporting everything (unnecessary barrel)
- No abstract interfaces — just classes and functions

## Step 2: Register in package.json exports

```json
{
  "exports": {
    "./features/payment": "./features/payment/index.ts",
    "./features/email": "./features/email/index.ts",
    "./features/webhook": "./features/webhook/index.ts",
    "./features/thompson-router": "./features/thompson-router/index.ts",
    "./features/anti-abuse": "./features/anti-abuse/index.ts",
    "./features/telegram-miniapp": "./features/telegram-miniapp/index.ts"
  }
}
```

## Step 3: Use the ProviderFactory Pattern for Multi-Implementation Features

When a feature has multiple implementations (e.g., payment channels), use a **factory pattern** that checks environment availability. This is the ONE abstraction worth keeping:

```typescript
interface ProviderFactory {
  name: string;
  priority: number;
  isAvailable(env: Record<string, unknown>): boolean;
  create(env: Record<string, unknown>): Provider;
}

function createProviderRegistry(env: Record<string, unknown>, factories: ProviderFactory[]) {
  const registry = new Map<string, Provider>();
  for (const f of factories) {
    if (f.isAvailable(env)) registry.set(f.name, f.create(env));
  }
  const sorted = [...factories].sort((a, b) => a.priority - b.priority);
  return {
    get(name: string) { return registry.get(name); },
    selectOnline() {
      for (const f of sorted) {
        const p = registry.get(f.name);
        if (p) return p;
      }
      return null;
    },
    list() { return [...registry.keys()]; },
  };
}
```

**Why keep this abstraction?** Because it has real consumers — the payment feature uses it today, and adding Stripe later only needs a new factory object.

## Step 4: Build Features by Priority

| Priority | Feature | Key Exports |
|----------|---------|-------------|
| P1 | payment | `PaymentProvider` interface, `AlipayProvider`, `alipayFactory`, `createProviderRegistry`, `signRSA2`/`verifyRSA2` |
| P1 | email | `EmailService`, `interpolate`, `escapeHtml` |
| P1 | webhook | `WebhookService` |
| P2 | thompson-router | `ThompsonRouter`, `wilsonScore` |
| P2 | anti-abuse | `AntiAbuseService` |
| P2 | telegram-miniapp | `detectPlatform`, `initTelegramWebApp`, `applyTelegramTheme` |

## Step 5: Merge Related Abstractions Into One File

**Don't** split `payment-core` (interfaces) from `payment-alipay` (implementation) into separate packages. Merge them:

```typescript
// features/payment/index.ts — ALL payment code in ONE file

// Interfaces (the abstraction)
export interface PaymentProvider { ... }
export interface ProviderFactory { ... }

// Implementation (alipay)
export class AlipayProvider implements PaymentProvider { ... }
export const alipayFactory: ProviderFactory = { ... };

// Utilities (RSA signing)
export async function signRSA2(params, privateKeyPem) { ... }

// Registry factory
export function createProviderRegistry(env, factories) { ... }
```

**Why?** When adding Stripe, just append `StripeProvider` + `stripeFactory` to the same file. No new package, no cross-package imports.

## Step 6: Feature Design Patterns

### Pattern A: Stateless Service (email, webhook)

```typescript
class EmailService {
  constructor(private config: ResendConfig) {}
  async send(opts: SendEmailOptions): Promise<SendResult> { ... }
  async sendWithTemplate(to: string, template: EmailTemplate, data: Record<string, string>) { ... }
  async healthCheck(): Promise<boolean> { ... }
}
```

### Pattern B: Stateful Service with Feedback (thompson-router)

```typescript
class ThompsonRouter {
  select(candidates: ChannelCandidate[]): RouteDecision { ... }
  recordSuccess(candidates: ChannelCandidate[], channelId: string): void {
    candidates.find(c => c.id === channelId)!.alpha += 1;  // mutate in-place
  }
}
```

### Pattern C: In-Memory Detector (anti-abuse)

```typescript
class AntiAbuseService {
  record(resourceId: string, ipHash: string): AbuseEvent[] { ... }
  isSuspicious(ipHash: string): boolean { ... }
  cleanup(): void { ... }
}
```

### Pattern D: Pure Functions (telegram-miniapp)

```typescript
export function detectPlatform(): PlatformInfo { ... }
export function applyTelegramTheme(params: Record<string, string>): void { ... }
```

## Step 7: Testing Strategy

Test **pure logic** only — don't mock external APIs:

| Feature | What to Test | What to Skip |
|---------|-------------|-------------|
| email | Template interpolation, HTML escaping | Actual API calls |
| webhook | URL parsing, isConfigured logic | Network requests |
| thompson-router | Selection probability, feedback updates, wilsonScore | - |
| anti-abuse | All 4 abuse types, cleanup, isSuspicious | - |
| telegram-miniapp | Platform detection in Node.js | Browser behavior |

Update vitest config:
```typescript
include: ["tests/**/*.test.ts", "features/*/tests/**/*.test.ts"],
```

## Step 8: Create Documentation Per Feature

Each feature gets one doc file in `packages/cf-core/docs/`:

```
docs/
├── 001_架构总览.md
├── 002_快速开始.md
├── 010_核心模块_http.md
├── 011_核心模块_security.md
├── 012_核心模块_bootstrap.md
├── 050_功能模块_payment.md
├── 051_功能模块_email.md
├── 052_功能模块_webhook.md
├── 053_功能模块_thompson-router.md
├── 054_功能模块_anti-abuse.md
└── 055_功能模块_telegram-miniapp.md
```

Naming convention: `0XX_核心模块_{name}.md` for core, `0XX_功能模块_{name}.md` for features.

## Key Lessons Learned

1. **Flat > nested** — `features/payment/index.ts` beats `plugins/payment-alipay/src/index.ts`
2. **No abstract plugin interfaces** — just export classes and functions directly
3. **Merge related code into one file** — interfaces + implementation + factory in one `index.ts`
4. **Factory pattern is the ONE abstraction worth keeping** — for multi-implementation features like payments
5. **The word "plugin" adds cognitive overhead** — call them "features" or "modules"
6. **In-memory detection is fine** — Workers instances reset naturally
7. **Subpath imports for tree-shaking** — `@eforge/cf-core/features/email`
8. **RSA/crypto code is portable** — Web Crypto API works identically in Workers and Node.js
9. **Don't create abstractions until 2+ consumers exist** — YAGNI applies to interface design too
10. **Document alongside code** — `docs/` directory in the package, not scattered across the workspace

## What Comes Next

After building feature modules, the final phase is **automated deployment** — a unified one-click system that takes two API tokens and produces a fully deployed production application. See the `build-deploy-automation` skill for the complete approach (8 bash scripts + 3 CI/CD workflows, idempotent reruns, credential persistence, auto-generated secrets).

The full progression is: **Core Library → Templates → Feature Modules → Deploy Automation**

## References

- Feature modules: `packages/cf-core/features/`
- Documentation: `packages/cf-core/docs/`
- Deploy automation: `templates/.deploy/` (Phase 4, see `build-deploy-automation` skill)
- Implementation record: `docs/047_cf-core共享内核实施记录_2026-05-29.md` (Phase 3 section)
- Prerequisite skills: `extract-shared-library`, `create-product-template`
- Next skill: `build-deploy-automation` (Phase 4)
