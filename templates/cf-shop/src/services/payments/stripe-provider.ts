/**
 * Stripe Provider — 标准支付渠道集成。
 *
 * 使用 Stripe Checkout Sessions 模式：
 * 1. createPayment() → 创建 Checkout Session，返回 redirectUrl
 * 2. 用户跳转到 Stripe 完成支付
 * 3. Stripe webhook → verifyCallback() → markPaidAndIssue
 *
 * Workers 下使用 fetch 调用 Stripe API，不使用 stripe-node SDK。
 */

import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  CallbackResult,
  QueryStatusResult,
} from "./types";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

/**
 * 使用 Web Crypto API 验证 Stripe webhook 签名。
 * 签名 = HMAC-SHA256(webhookSecret, timestamp.rawBody)
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

  // 验证时间戳偏差（±5 分钟，防止重放攻击）
  const sigTime = parseInt(timestamp, 10) * 1000;
  if (isNaN(sigTime) || Math.abs(Date.now() - sigTime) > 5 * 60 * 1000) {
    return false;
  }

  const encoder = new TextEncoder();
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signatureBytes = hexToBytes(signature);
  return await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(signedPayload),
  );
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly displayName = "Stripe";
  readonly supportedCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"];

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const orderNo = input.orderNo;
    const origin = this.extractOrigin(input.notifyUrl);

    const params = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][product_data][name]": input.description || "商品购买",
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][quantity]": "1",
      "metadata[order_no]": orderNo,
      success_url: `${origin}/lookup?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/shop`,
    });

    if (input.returnUrl) {
      params.set("success_url", input.returnUrl);
    }

    const resp = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Stripe API error: ${resp.status} - ${errorBody}`);
    }

    const session = await resp.json() as { id: string; url?: string };

    if (!session.url) {
      throw new Error("Stripe returned no checkout URL");
    }

    return {
      redirectUrl: session.url,
      providerTradeNo: session.id,
    };
  }

  async verifyCallback(params: Record<string, string>): Promise<CallbackResult> {
    const rawPayload = params["_raw_body"];
    const signatureHeader = params["_stripe_signature"];

    if (!rawPayload || !signatureHeader) {
      throw new Error("Stripe callback missing signature headers");
    }

    const valid = await verifyStripeSignature(rawPayload, signatureHeader, this.webhookSecret);
    if (!valid) {
      throw new Error("Stripe webhook signature invalid");
    }

    const event = JSON.parse(rawPayload) as {
      type?: string;
      data?: {
        object?: {
          metadata?: Record<string, string>;
          amount_total?: number;
          currency?: string;
          payment_intent?: string;
          id?: string;
        };
      };
    };

    if (event.type !== "checkout.session.completed") {
      throw new Error(`Unexpected Stripe event type: ${event.type}`);
    }

    const session = event.data?.object;
    if (!session) {
      throw new Error("Stripe event missing session object");
    }

    const orderNo = session.metadata?.order_no;
    if (!orderNo) {
      throw new Error("Stripe session missing order_no metadata");
    }

    return {
      orderNo,
      providerTradeNo: session.payment_intent || session.id || "",
      amountCents: session.amount_total || 0,
      currency: (session.currency || "usd").toUpperCase(),
      paidAt: new Date().toISOString(),
    };
  }

  async queryStatus(tradeNo: string): Promise<QueryStatusResult> {
    const resp = await fetch(`${STRIPE_API_BASE}/checkout/sessions/${tradeNo}`, {
      headers: { "Authorization": `Bearer ${this.secretKey}` },
    });

    if (!resp.ok) return { paid: false };

    const session = await resp.json() as {
      payment_status?: string;
      payment_intent?: string;
    };

    const paid = session.payment_status === "paid";
    return { paid, providerTradeNo: paid ? session.payment_intent : undefined };
  }

  private extractOrigin(notifyUrl: string): string {
    try {
      const url = new URL(notifyUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      return "https://localhost";
    }
  }
}
