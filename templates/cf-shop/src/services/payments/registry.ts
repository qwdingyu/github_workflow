/**
 * 支付 Provider 注册表（per-request 工厂模式）。
 *
 * 每次请求通过 createProviderRegistry(env) 创建独立的 Registry 实例，
 * 避免 Workers isolate 复用导致的跨请求全局状态泄漏。
 */

import type { PaymentProvider } from "./types";
import type { ShopBindings } from "../../bindings";
import { AlipayProvider } from "./alipay-provider";
import { Trc20Provider } from "./trc20-provider";
import { StripeProvider } from "./stripe-provider";

/** 合法的 provider 名称列表（回调路由白名单校验用） */
export const VALID_PROVIDER_NAMES = ["alipay", "stripe", "usdt_trc20"] as const;

export interface ProviderRegistry {
  /** 按名称获取指定 Provider */
  get(name: string): PaymentProvider | undefined;
  /** 按优先级选择第一个可用的线上支付渠道 */
  selectOnline(): PaymentProvider | null;
  /** 列出所有已注册的渠道名称 */
  list(): string[];
}

/**
 * 创建 per-request 的 Provider 注册表。
 * 根据 env 中配置的凭证，实例化对应的 Provider。
 * 未配置的渠道不会注册。
 */
export function createProviderRegistry(env: ShopBindings): ProviderRegistry {
  const registry = new Map<string, PaymentProvider>();

  // 支付宝当面付
  if (env.ALIPAY_APP_ID && env.ALIPAY_PRIVATE_KEY && env.ALIPAY_PUBLIC_KEY) {
    registry.set("alipay", new AlipayProvider(
      env.ALIPAY_APP_ID,
      env.ALIPAY_PRIVATE_KEY,
      env.ALIPAY_PUBLIC_KEY,
    ));
  }

  // TRC20/USDT
  if (env.TRC20_WALLET_ADDRESS && env.TRONGRID_API_KEY) {
    registry.set("usdt_trc20", new Trc20Provider(
      env.TRC20_WALLET_ADDRESS,
      env.TRONGRID_API_KEY,
    ));
  }

  // Stripe
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) {
    registry.set("stripe", new StripeProvider(
      env.STRIPE_SECRET_KEY,
      env.STRIPE_WEBHOOK_SECRET,
    ));
  }

  return {
    get(name: string) {
      return registry.get(name);
    },

    selectOnline() {
      // 优先级：stripe > alipay > usdt_trc20
      if (registry.has("stripe")) return registry.get("stripe") ?? null;
      if (registry.has("alipay")) return registry.get("alipay") ?? null;
      if (registry.has("usdt_trc20")) return registry.get("usdt_trc20") ?? null;
      return null;
    },

    list() {
      return [...registry.keys()];
    },
  };
}
