/**
 * 支付功能模块 — 支付渠道抽象层 + 支付宝实现
 *
 * 包含：
 * - PaymentProvider 接口（统一支付渠道抽象）
 * - ProviderRegistry 注册表（per-request 工厂模式）
 * - AlipayProvider（支付宝当面付，RSA2 签名）
 *
 * 来源：eshop src/services/payments/ + src/lib/alipay-sign.ts
 *
 * @example
 * ```ts
 * import { AlipayProvider, createProviderRegistry, alipayFactory } from "@eforge/cf-core/features/payment";
 *
 * // 方式 1：直接使用
 * const alipay = new AlipayProvider({ appId, privateKey, alipayPublicKey });
 * const result = await alipay.createPayment({ orderNo, amountCents, currency: "CNY", notifyUrl });
 *
 * // 方式 2：通过 Registry 按优先级选择
 * const registry = createProviderRegistry(env, [alipayFactory]);
 * const provider = registry.selectOnline();
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 接口定义
// ═══════════════════════════════════════════════════════════════════════════════

export interface CreatePaymentInput {
  orderNo: string;
  amountCents: number;
  currency: string;
  notifyUrl: string;
  returnUrl?: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  providerTradeNo?: string;
  qrCode?: string;
  redirectUrl?: string;
  raw?: Record<string, unknown>;
}

export interface CallbackResult {
  orderNo: string;
  providerTradeNo: string;
  amountCents: number;
  currency: string;
  paidAt: string;
  raw?: Record<string, unknown>;
}

export interface QueryStatusResult {
  paid: boolean;
  providerTradeNo?: string;
}

export interface RefundInput {
  providerTradeNo: string;
  refundCents: number;
  reason?: string;
  refundNo?: string;
}

export interface RefundResult {
  success: boolean;
  providerRefundNo?: string;
  status: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly displayName: string;
  readonly supportedCurrencies: string[];
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyCallback(params: Record<string, string>): Promise<CallbackResult>;
  queryStatus?(tradeNo: string): Promise<QueryStatusResult>;
  refund?(input: RefundInput): Promise<RefundResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider 注册表（per-request 工厂模式）
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProviderRegistry {
  get(name: string): PaymentProvider | undefined;
  selectOnline(): PaymentProvider | null;
  list(): string[];
}

export interface ProviderFactory {
  name: string;
  priority: number;
  isAvailable(env: Record<string, unknown>): boolean;
  create(env: Record<string, unknown>): PaymentProvider;
}

/**
 * 创建 per-request 的 Provider 注册表。
 * 根据 env 中配置的凭证，自动实例化已配置的渠道。
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

// ═══════════════════════════════════════════════════════════════════════════════
// RSA2 签名工具（Web Crypto API，零依赖）
// ═══════════════════════════════════════════════════════════════════════════════

const encoder = new TextEncoder();

function buildSignString(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "" && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

function base64ToUint8Array(base64: string): Uint8Array {
  const s = atob(base64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g, "").replace(/-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, "").replace(/\s+/g, "");
  const der = base64ToUint8Array(body);
  try {
    return await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    const header = [0x30,0x82,0x01,0x22,0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00,0x04,0x82,0x01,0x0f];
    const pkcs8 = new Uint8Array(header.length + der.length);
    pkcs8.set(header); pkcs8.set(der, header.length);
    return await crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  }
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN\s+(RSA\s+)?PUBLIC\s+KEY-----/g, "").replace(/-----END\s+(RSA\s+)?PUBLIC\s+KEY-----/g, "").replace(/\s+/g, "");
  return await crypto.subtle.importKey("spki", base64ToUint8Array(body), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

export async function signRSA2(params: Record<string, string>, privateKeyPem: string): Promise<string> {
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(buildSignString(params)));
  return uint8ArrayToBase64(new Uint8Array(sig));
}

export async function verifyRSA2(params: Record<string, string>, publicKeyPem: string): Promise<boolean> {
  const sign = params["sign"];
  if (!sign) return false;
  const key = await importPublicKey(publicKeyPem);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64ToUint8Array(sign), encoder.encode(buildSignString(params)));
}

// ═══════════════════════════════════════════════════════════════════════════════
// AlipayProvider — 支付宝当面付
// ═══════════════════════════════════════════════════════════════════════════════

export interface AlipayConfig {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
}

export class AlipayProvider implements PaymentProvider {
  readonly name = "alipay";
  readonly displayName = "支付宝当面付";
  readonly supportedCurrencies = ["CNY"];

  constructor(private readonly config: AlipayConfig) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const bizContent = JSON.stringify({
      out_trade_no: input.orderNo,
      total_amount: (input.amountCents / 100).toFixed(2),
      subject: input.metadata?.subject || input.description || "商品购买",
    });
    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
    const params: Record<string, string> = {
      app_id: this.config.appId, method: "alipay.trade.precreate", charset: "utf-8",
      sign_type: "RSA2", timestamp, version: "1.0", notify_url: input.notifyUrl, biz_content: bizContent,
    };
    params.sign = await signRSA2(params, this.config.privateKey);

    const resp = await fetch("https://openapi.alipay.com/gateway.do", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams(params).toString(),
    });
    if (!resp.ok) throw new Error(`Alipay API HTTP error: ${resp.status}`);

    const data = await resp.json() as { alipay_trade_precreate_response?: { code?: string; msg?: string; sub_msg?: string; qr_code?: string } };
    const result = data.alipay_trade_precreate_response;
    if (!result || result.code !== "10000") throw new Error(`Alipay precreate failed: ${result?.sub_msg || result?.msg || "unknown"}`);
    return { qrCode: result.qr_code || "" };
  }

  async verifyCallback(params: Record<string, string>): Promise<CallbackResult> {
    if (!(await verifyRSA2(params, this.config.alipayPublicKey))) throw new Error("Alipay callback signature invalid");
    if (params.app_id !== this.config.appId) throw new Error("Alipay callback app_id mismatch");
    if (params.trade_status !== "TRADE_SUCCESS") throw new Error(`Unexpected trade_status: ${params.trade_status}`);
    return {
      orderNo: params.out_trade_no, providerTradeNo: params.trade_no,
      amountCents: Math.round(parseFloat(params.total_amount || "0") * 100),
      currency: "CNY", paidAt: params.gmt_payment || new Date().toISOString(),
    };
  }

  async queryStatus(orderNo: string): Promise<QueryStatusResult> {
    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
    const params: Record<string, string> = {
      app_id: this.config.appId, method: "alipay.trade.query", charset: "utf-8",
      sign_type: "RSA2", timestamp, version: "1.0", biz_content: JSON.stringify({ out_trade_no: orderNo }),
    };
    params.sign = await signRSA2(params, this.config.privateKey);
    const resp = await fetch("https://openapi.alipay.com/gateway.do", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams(params).toString(),
    });
    if (!resp.ok) throw new Error(`Alipay API HTTP error: ${resp.status}`);
    const data = await resp.json() as { alipay_trade_query_response?: { trade_status?: string } };
    return { paid: data.alipay_trade_query_response?.trade_status === "TRADE_SUCCESS" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 支付宝工厂
// ═══════════════════════════════════════════════════════════════════════════════

export const alipayFactory: ProviderFactory = {
  name: "alipay",
  priority: 100,
  isAvailable(env) { return !!(env.ALIPAY_APP_ID && env.ALIPAY_PRIVATE_KEY && env.ALIPAY_PUBLIC_KEY); },
  create(env) {
    return new AlipayProvider({
      appId: env.ALIPAY_APP_ID as string,
      privateKey: env.ALIPAY_PRIVATE_KEY as string,
      alipayPublicKey: env.ALIPAY_PUBLIC_KEY as string,
    });
  },
};
