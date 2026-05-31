/**
 * 支付渠道适配层 — cf-shop → @eforge/cf-core/features/payment
 *
 * 此文件是薄适配器，将所有支付能力从 cf-core 重新导出，
 * 并提供 cf-shop 专用的 createProviderRegistry(env: Bindings) 签名。
 *
 * 所有支付逻辑（Provider 实现、RSA2 签名、HMAC 验证、HTTP 重试）
 * 均在 cf-core 中维护，cf-shop 不再持有本地副本。
 */

// ═══════════════════════════════════════════════════════════════
// 从 cf-core 重新导出类型
// ═══════════════════════════════════════════════════════════════

export type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  CallbackResult,
  QueryStatusResult,
  RefundInput,
  RefundResult,
  ProviderRegistry,
  ProviderFactory,
} from "@eforge/cf-core/features/payment";

// ═══════════════════════════════════════════════════════════════
// 从 cf-core 重新导出 Provider 类（测试 / 调试用）
// ═══════════════════════════════════════════════════════════════

export { AlipayProvider } from "@eforge/cf-core/features/payment";
export { StripeProvider } from "@eforge/cf-core/features/payment";
export { Trc20Provider } from "@eforge/cf-core/features/payment";

// ═══════════════════════════════════════════════════════════════
// Provider 白名单（回调路由校验用）
// ═══════════════════════════════════════════════════════════════

export const VALID_PROVIDER_NAMES = ["alipay", "stripe", "usdt_trc20"] as const;

// ═══════════════════════════════════════════════════════════════
// cf-shop 专用注册表工厂
// ═══════════════════════════════════════════════════════════════

import {
  createProviderRegistry as createCoreRegistry,
  stripeFactory,
  alipayFactory,
  trc20Factory,
} from "@eforge/cf-core/features/payment";
import type { Bindings } from "../../bindings";
import type { ProviderRegistry } from "@eforge/cf-core/features/payment";

/**
 * 创建 per-request 的 Provider 注册表。
 *
 * 根据 Bindings 中配置的凭证，自动实例化已配置的渠道。
 * 优先级：stripe (200) > alipay (100) > usdt_trc20 (300)
 *
 * @example
 * ```ts
 * const registry = createProviderRegistry(c.env);
 * const provider = registry.selectOnline();
 * ```
 */
export function createProviderRegistry(env: Bindings): ProviderRegistry {
  return createCoreRegistry(env as Record<string, unknown>, [
    stripeFactory,    // 优先级 200 — 国际用户优先
    alipayFactory,    // 优先级 100 — 国内用户
    trc20Factory,     // 优先级 300 — 兜底
  ]);
}
