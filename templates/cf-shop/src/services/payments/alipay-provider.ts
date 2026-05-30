/**
 * Alipay 支付宝当面付 Provider (alipay.trade.precreate)
 *
 * 使用支付宝开放平台 RSA2 签名（SHA256WithRSA），生成付款二维码。
 * 适配 Cloudflare Workers 环境（Web Crypto API）。
 */

import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  CallbackResult,
  QueryStatusResult,
} from "./types";
import { signRSA2, verifyRSA2 } from "../../lib/alipay-sign";

export class AlipayProvider implements PaymentProvider {
  readonly name = "alipay";
  readonly displayName = "支付宝当面付";
  readonly supportedCurrencies = ["CNY"];

  constructor(
    private readonly appId: string,
    private readonly privateKey: string,
    private readonly alipayPublicKey: string,
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const bizContent = JSON.stringify({
      out_trade_no: input.orderNo,
      total_amount: (input.amountCents / 100).toFixed(2),
      subject: input.description || "商品购买",
    });

    const timestamp = new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19);

    const params: Record<string, string> = {
      app_id: this.appId,
      method: "alipay.trade.precreate",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp,
      version: "1.0",
      notify_url: input.notifyUrl,
      biz_content: bizContent,
    };

    const sign = await signRSA2(params, this.privateKey);
    params.sign = sign;

    const body = new URLSearchParams(params).toString();
    const resp = await fetch("https://openapi.alipay.com/gateway.do", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body,
    });

    if (!resp.ok) {
      throw new Error(`Alipay API HTTP error: ${resp.status}`);
    }

    const data = (await resp.json()) as {
      alipay_trade_precreate_response?: {
        code?: string;
        msg?: string;
        sub_msg?: string;
        qr_code?: string;
      };
    };

    const result = data.alipay_trade_precreate_response;
    if (!result || result.code !== "10000") {
      throw new Error(`Alipay precreate failed: ${result?.sub_msg || result?.msg || "unknown"}`);
    }

    return { qrCode: result.qr_code || "" };
  }

  async verifyCallback(params: Record<string, string>): Promise<CallbackResult> {
    const valid = await verifyRSA2(params, this.alipayPublicKey);
    if (!valid) {
      throw new Error("Alipay callback signature invalid");
    }

    if (params.app_id !== this.appId) {
      throw new Error("Alipay callback app_id mismatch");
    }

    if (params.trade_status !== "TRADE_SUCCESS") {
      throw new Error(`Unexpected trade_status: ${params.trade_status}`);
    }

    const amountYuan = parseFloat(params.total_amount || "0");
    const amountCents = Math.round(amountYuan * 100);

    return {
      orderNo: params.out_trade_no,
      providerTradeNo: params.trade_no,
      amountCents,
      currency: "CNY",
      paidAt: params.gmt_payment || new Date().toISOString(),
    };
  }

  async queryStatus(orderNo: string): Promise<QueryStatusResult> {
    const timestamp = new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19);

    const bizContent = JSON.stringify({ out_trade_no: orderNo });

    const params: Record<string, string> = {
      app_id: this.appId,
      method: "alipay.trade.query",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp,
      version: "1.0",
      biz_content: bizContent,
    };

    const sign = await signRSA2(params, this.privateKey);
    params.sign = sign;

    const body = new URLSearchParams(params).toString();
    const resp = await fetch("https://openapi.alipay.com/gateway.do", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body,
    });

    if (!resp.ok) {
      throw new Error(`Alipay API HTTP error: ${resp.status}`);
    }

    const data = (await resp.json()) as {
      alipay_trade_query_response?: {
        code?: string;
        trade_status?: string;
      };
    };

    const result = data.alipay_trade_query_response;
    return { paid: result?.trade_status === "TRADE_SUCCESS" };
  }
}
