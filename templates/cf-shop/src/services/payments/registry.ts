/**
 * 支付提供者注册表
 *
 * 统一管理所有支付方式的注册和获取。
 * 支持按 ID 查找支付提供者。
 */

import type { PaymentProvider } from "./types";
import { AlipayProvider } from "./alipay";

/**
 * 支付提供者注册表
 *
 * 所有支持的支付方式在此注册。
 * 新增支付方式时，在此处 import 并注册。
 */
const providers = new Map<string, PaymentProvider>();

// ── 注册支付宝 ──
providers.set("alipay", new AlipayProvider());

/**
 * 获取支付提供者
 *
 * @param id - 支付方式 ID（如 "alipay"）
 * @returns 支付提供者实例，不存在返回 undefined
 */
export function getPaymentProvider(id: string): PaymentProvider | undefined {
  return providers.get(id);
}

/**
 * 获取所有已注册的支付方式
 *
 * @returns 支付方式列表（id + name）
 */
export function getAllPaymentProviders(): Array<{ id: string; name: string }> {
  return Array.from(providers.values()).map((p) => ({
    id: p.id,
    name: p.name,
  }));
}

/**
 * 注册自定义支付提供者
 *
 * @param provider - 支付提供者实例
 */
export function registerPaymentProvider(provider: PaymentProvider): void {
  providers.set(provider.id, provider);
}
