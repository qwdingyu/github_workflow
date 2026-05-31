/**
 * 支付功能模块 — Provider 注册表
 *
 * per-request 工厂模式：根据 env 中配置的凭证，自动实例化已配置的渠道。
 * 优先级由调用方传入 factory 数组的顺序决定。
 */

import type { PaymentProvider, ProviderFactory, ProviderRegistry } from "./types";

/**
 * 创建 per-request 的 Provider 注册表。
 *
 * @example
 * ```ts
 * import { createProviderRegistry, stripeFactory, alipayFactory } from "@eforge/cf-core/features/payment";
 *
 * // 按业务需求决定优先级顺序
 * const registry = createProviderRegistry(env, [
 *   stripeFactory,    // 国际用户优先
 *   alipayFactory,    // 国内用户
 * ]);
 * const provider = registry.selectOnline();
 * ```
 */
export function createProviderRegistry(
  env: Record<string, unknown>,
  factories: ProviderFactory[],
): ProviderRegistry {
  const registry = new Map<string, PaymentProvider>();

  for (const factory of factories) {
    if (factory.isAvailable(env)) {
      registry.set(factory.name, factory.create(env));
    }
  }

  const sorted = [...factories].sort((a, b) => a.priority - b.priority);

  return {
    get(name) { return registry.get(name); },
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
