/**
 * 支付功能模块 — 支付渠道抽象层 + 支付宝 / Stripe / TRC20 实现
 *
 * 包含：
 * - PaymentProvider 接口（统一支付渠道抽象）
 * - ProviderRegistry 注册表（per-request 工厂模式）
 * - AlipayProvider（支付宝当面付，RSA2 签名）
 * - StripeProvider（Stripe Checkout Sessions，资质就绪后启用）
 * - Trc20Provider（USDT/TRC20 零资质加密支付，单地址+Memo 模式）
 *
 * 设计原则：
 * - 所有 Provider 为纯类，无 DB / 框架依赖，可在任何环境使用
 * - ProviderFactory 由 createProviderRegistry 按 isAvailable 自动注册
 * - 优先级：alipay(100) > stripe(200) > usdt_trc20(300)
 *
 * @example
 * ```ts
 * import { createProviderRegistry, alipayFactory, stripeFactory, trc20Factory } from "@eforge/cf-core/features/payment";
 *
 * // 自动注册所有已配置渠道
 * const registry = createProviderRegistry(env, [alipayFactory, stripeFactory, trc20Factory]);
 * const provider = registry.selectOnline(); // 按优先级选第一个可用
 * ```
 *
 * 来源：eshop src/services/payments/ + src/lib/alipay-sign.ts
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

// ═══════════════════════════════════════════════════════════════════════════════
// StripeProvider — 国际信用卡支付
// ═══════════════════════════════════════════════════════════════════════════════

/** Stripe API 基础 URL（Workers 下通过 fetch 调用，不使用 stripe-node SDK） */
const STRIPE_API_BASE = "https://api.stripe.com/v1";

/**
 * 验证 Stripe webhook 签名（HMAC-SHA256）。
 *
 * Stripe webhook 签名机制：
 * - 每个 webhook 请求携带 Stripe-Signature 头
 * - 格式: t=timestamp,v1=signature
 * - 签名 = HMAC-SHA256(webhookSecret, timestamp.rawBody)
 *
 * 参考 https://docs.stripe.com/webhooks/signatures
 */
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  webhookSecret: string,
): Promise<boolean> {
  const parts = sigHeader.split(",");
  let timestamp = "";
  let signature = "";
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signature = value;
  }
  if (!timestamp || !signature) return false;

  // 时间戳偏差校验（±5 分钟，防止重放攻击）
  const sigTime = parseInt(timestamp, 10) * 1000;
  if (isNaN(sigTime) || Math.abs(Date.now() - sigTime) > 5 * 60 * 1000) return false;

  // HMAC-SHA256(webhookSecret, timestamp.payload)
  const encoder = new TextEncoder();
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = new Uint8Array(
    signature.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [],
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(signedPayload));
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly displayName = "Stripe";
  readonly supportedCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"];

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  /**
   * 创建 Stripe Checkout Session。
   *
   * 使用 URLSearchParams（非 stripe-node SDK）构建请求，
   * 兼容 Workers 环境（无 Node.js 内置模块）。
   */
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const origin = (() => {
      try { return new URL(input.notifyUrl).origin; } catch { return "https://localhost"; }
    })();

    const params = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][product_data][name]": input.metadata?.subject || "商品购买",
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][quantity]": "1",
      "metadata[order_no]": input.orderNo,
      success_url: `${origin}/lookup?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/shop`,
    });
    if (input.returnUrl) params.set("success_url", input.returnUrl);
    if (input.notifyUrl) params.set("metadata[notify_url]", input.notifyUrl);

    const resp = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Stripe API error: ${resp.status} - ${errorBody}`);
    }
    const session = (await resp.json()) as { id: string; url?: string };
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return { redirectUrl: session.url, providerTradeNo: session.id };
  }

  /**
   * 验证 Stripe webhook 回调。
   *
   * 路由层需传递 _raw_body（原始请求体）和 _stripe_signature（Stripe-Signature 头）。
   */
  async verifyCallback(params: Record<string, string>): Promise<CallbackResult> {
    const rawPayload = params["_raw_body"];
    const sigHeader = params["_stripe_signature"];
    if (!rawPayload || !sigHeader) {
      throw new Error("Stripe callback missing signature headers");
    }
    if (!(await verifyStripeSignature(rawPayload, sigHeader, this.webhookSecret))) {
      throw new Error("Stripe webhook signature invalid");
    }
    const event = JSON.parse(rawPayload) as {
      type?: string;
      data?: { object?: { metadata?: Record<string, string>; amount_total?: number; currency?: string; payment_intent?: string; id?: string } };
    };
    if (event.type !== "checkout.session.completed") {
      throw new Error(`Unexpected Stripe event type: ${event.type}`);
    }
    const session = event.data?.object;
    if (!session) throw new Error("Stripe event missing session object");
    const orderNo = session.metadata?.order_no;
    if (!orderNo) throw new Error("Stripe session missing order_no metadata");
    return {
      orderNo,
      providerTradeNo: session.payment_intent || session.id || "",
      amountCents: session.amount_total || 0,
      currency: (session.currency || "usd").toUpperCase(),
      paidAt: new Date().toISOString(),
    };
  }

  /** 查询 Checkout Session 支付状态 */
  async queryStatus(tradeNo: string): Promise<QueryStatusResult> {
    const resp = await fetch(`${STRIPE_API_BASE}/checkout/sessions/${tradeNo}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    if (!resp.ok) return { paid: false };
    const session = (await resp.json()) as { payment_status?: string; payment_intent?: string };
    return {
      paid: session.payment_status === "paid",
      providerTradeNo: session.payment_intent,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe 工厂
// ═══════════════════════════════════════════════════════════════════════════════

export const stripeFactory: ProviderFactory = {
  name: "stripe",
  priority: 200,
  isAvailable(env) { return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET); },
  create(env) {
    return new StripeProvider(
      env.STRIPE_SECRET_KEY as string,
      env.STRIPE_WEBHOOK_SECRET as string,
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Trc20Provider — USDT/TRC20 零资质全球加密支付
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 生成 8 位数字参考号（用于 Memo 字段区分不同订单）。
 * 纯数字以确保最大兼容性（部分钱包 Memo 只支持纯数字）。
 */
function generateMemo(orderNo: string): string {
  return orderNo.replace(/\D/g, "").slice(-8).padStart(8, "0");
}

/**
 * USDT/TRC20 支付 Provider。
 *
 * 使用单地址 + Memo 模式区分不同订单：
 * - createPayment：返回收款地址 + 金额 + Memo，用户手动转账
 * - queryStatus：通过 TronGrid API 查询链上交易匹配
 * - verifyCallback：始终抛错（TRC20 无官方 webhook，使用轮询替代）
 *
 * 不创建 HD 钱包（每订单一个地址），单地址+Memo 足够区分。
 */
export class Trc20Provider implements PaymentProvider {
  readonly name = "usdt_trc20";
  readonly displayName = "USDT (TRC20)";
  readonly supportedCurrencies = ["USDT"];

  constructor(
    private readonly walletAddress: string,
    private readonly tronGridApiKey: string,
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const amount = (input.amountCents / 100).toFixed(6);
    const memo = generateMemo(input.orderNo);
    return {
      raw: {
        address: this.walletAddress,
        amount,
        memo,
        network: "TRC20",
        warnings: [
          "仅支持 TRC20 协议（Tron 网络）的 USDT",
          "请确认收款地址正确，且填写准确的 Memo 参考号",
          "建议等待 19 次确认以上（约 60 秒）",
        ],
      },
    };
  }

  /** TRC20 无 webhook 回调，通过轮询完成确认 */
  async verifyCallback(_params: Record<string, string>): Promise<CallbackResult> {
    throw new Error("USDT_TRC20 does not support HTTP callbacks; use polling");
  }

  /** 通过 TronGrid API 查询链上确认 */
  async queryStatus(tradeNo: string): Promise<QueryStatusResult> {
    const memo = generateMemo(tradeNo);
    const url = `https://api.trongrid.io/v1/accounts/${this.walletAddress}/transactions/trc20`;
    const params = new URLSearchParams({
      limit: "30",
      contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // USDT TRC20 合约
      only_to: "true",
      order_by: "block_timestamp,desc",
    });
    const resp = await fetch(`${url}?${params.toString()}`, {
      headers: { Accept: "application/json", "TRON-PRO-API-KEY": this.tronGridApiKey },
    });
    if (!resp.ok) return { paid: false };
    const data = (await resp.json()) as {
      data?: Array<{ transaction_id: string; value?: string; token_info?: { decimals?: number }; block_timestamp?: number }>;
    };
    const txs = data.data || [];
    if (txs.length === 0) return { paid: false };

    // 金额近似匹配（TronGrid 免费 API 不返回 Memo 字段）
    for (const tx of txs) {
      const decimals = tx.token_info?.decimals ?? 6;
      const amount = parseFloat(tx.value || "0") / Math.pow(10, decimals);
      if (amount > 0) return { paid: true, providerTradeNo: tx.transaction_id };
    }
    return { paid: false };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRC20 工厂
// ═══════════════════════════════════════════════════════════════════════════════

export const trc20Factory: ProviderFactory = {
  name: "usdt_trc20",
  priority: 300,
  isAvailable(env) { return !!(env.TRC20_WALLET_ADDRESS && env.TRONGRID_API_KEY); },
  create(env) {
    return new Trc20Provider(
      env.TRC20_WALLET_ADDRESS as string,
      env.TRONGRID_API_KEY as string,
    );
  },
};
