/**
 * 支付宝当面付（扫码支付）实现
 *
 * 使用 RSA2 签名，Web Crypto API（Workers 原生）。
 * 支持创建支付请求和验证回调通知。
 */

import type {
  PaymentProvider,
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentNotification,
} from "./types";

/**
 * Base64 编码（去除换行）
 */
function base64Encode(str: string): string {
  return btoa(str).replace(/\n/g, "");
}

/**
 * Base64 解码
 */
function base64Decode(str: string): string {
  return atob(str.replace(/\s/g, ""));
}

/**
 * PEM 格式私钥转 ArrayBuffer
 */
function pemToBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN (.+?)-----/, "")
    .replace(/-----END (.+?)-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * RSA2 签名（SHA256WithRSA）
 *
 * @param content - 待签名字符串
 * @param privateKeyPem - RSA 私钥（PEM 格式）
 * @returns Base64 编码的签名
 */
async function rsa2Sign(content: string, privateKeyPem: string): Promise<string> {
  const keyBuffer = pemToBuffer(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(content),
  );
  return base64Encode(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * RSA2 验签
 *
 * @param content - 待验签字符串
 * @param signature - Base64 编码的签名
 * @param publicKeyPem - RSA 公钥（PEM 格式）
 * @returns 验签是否通过
 */
async function rsa2Verify(content: string, signature: string, publicKeyPem: string): Promise<boolean> {
  const keyBuffer = pemToBuffer(publicKeyPem);
  const key = await crypto.subtle.importKey(
    "spki",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sigBytes = new Uint8Array(
    atob(signature)
      .split("")
      .map((c) => c.charCodeAt(0)),
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    sigBytes,
    new TextEncoder().encode(content),
  );
}

/**
 * 构造支付宝签名字符串
 *
 * 按参数名 ASCII 排序，拼接为 key1=value1&key2=value2 格式。
 */
function buildSignContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => params[key] !== "" && params[key] !== undefined && key !== "sign")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

/**
 * 支付宝当面付提供者
 */
export class AlipayProvider implements PaymentProvider {
  readonly id = "alipay";
  readonly name = "支付宝";

  /**
   * 创建当面付二维码支付请求
   */
  async createPayment(
    params: CreatePaymentParams,
    env: Record<string, unknown>,
  ): Promise<CreatePaymentResult> {
    const appId = env.ALIPAY_APP_ID as string;
    const privateKey = env.ALIPAY_PRIVATE_KEY as string;
    const notifyUrl = params.notifyUrl;

    if (!appId || !privateKey) {
      return { ok: false, error: "支付宝未配置" };
    }

    // 构造公共参数
    const bizContent = JSON.stringify({
      out_trade_no: params.outTradeNo,
      total_amount: (params.amountCents / 100).toFixed(2),
      subject: params.subject,
    });

    const commonParams: Record<string, string> = {
      app_id: appId,
      method: "alipay.trade.precreate",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      version: "1.0",
      notify_url: notifyUrl,
      biz_content: bizContent,
    };

    // 签名
    const signContent = buildSignContent(commonParams);
    const sign = await rsa2Sign(signContent, privateKey);

    // 调用支付宝 API
    const formData = new URLSearchParams({ ...commonParams, sign });

    try {
      const response = await fetch("https://openapi.alipay.com/gateway.do", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await response.json<any>();
      const result = data.alipay_trade_precreate_response;

      if (result?.code !== "10000") {
        console.error("[alipay] createPayment error:", result);
        return { ok: false, error: result?.sub_msg || "创建支付失败" };
      }

      return {
        ok: true,
        qrCode: result.qr_code,
      };
    } catch (err) {
      console.error("[alipay] createPayment fetch error:", err);
      return { ok: false, error: "支付宝接口调用失败" };
    }
  }

  /**
   * 验证支付宝回调通知
   */
  async verifyNotification(
    body: string,
    headers: Headers,
    env: Record<string, unknown>,
  ): Promise<PaymentNotification> {
    const publicKey = env.ALIPAY_PUBLIC_KEY as string;
    const params = Object.fromEntries(new URLSearchParams(body));

    // 验签
    const signContent = buildSignContent(params as Record<string, string>);
    const sign = params.sign || "";

    const verified = publicKey ? await rsa2Verify(signContent, sign, publicKey) : true;

    if (!verified) {
      return {
        success: false,
        outTradeNo: "",
        tradeNo: "",
        amountCents: 0,
        paidAt: "",
        rawData: params as Record<string, unknown>,
      };
    }

    // 解析通知
    const tradeStatus = params.trade_status;
    const isSuccess = tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED";

    return {
      success: isSuccess,
      outTradeNo: params.out_trade_no || "",
      tradeNo: params.trade_no || "",
      amountCents: Math.round(parseFloat(params.total_amount || "0") * 100),
      paidAt: params.gmt_payment || new Date().toISOString(),
      rawData: params as Record<string, unknown>,
    };
  }
}
