/**
 * 支付渠道抽象层 — 统一导出。
 *
 * 使用方式：
 *   import { createProviderRegistry } from "../services/payments";
 *
 *   const registry = createProviderRegistry(c.env);
 *   const provider = registry.get("stripe");
 *   if (provider) {
 *     const result = await provider.createPayment({ ... });
 *   }
 */

export type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  CallbackResult,
  QueryStatusResult,
} from "./types";

export {
  createProviderRegistry,
  VALID_PROVIDER_NAMES,
} from "./registry";

export type { ProviderRegistry } from "./registry";
