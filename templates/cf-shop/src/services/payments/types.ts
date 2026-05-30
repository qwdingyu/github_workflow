/**
 * 支付渠道抽象层 — 统一的 Provider 接口定义。
 *
 * 每个支付渠道（支付宝 / Stripe / USDT）实现此接口，
 * 通过 registry.ts 注册后即可被订单路由自动选用。
 *
 * 设计原则：
 * - Provider 实例化时注入凭证（构造函数），方法内不再读 env
 * - 所有金额统一用「分」(cents) + 货币代码，避免浮点精度问题
 * - verifyCallback 接收原始数据，不预读 body（部分渠道需 raw body 验签）
 * - 可选方法（queryStatus / refund）不强制实现，按需使用
 */

// ── 创建支付 ──

export interface CreatePaymentInput {
  /** 系统订单号（如 "S20260529ABC123"），用于通知渠道方 */
  orderNo: string;
  /** 应付金额（分） */
  amountCents: number;
  /** 货币代码（如 CNY / USD） */
  currency: string;
  /** 异步回调地址，渠道方支付成功后 POST 到此 URL */
  notifyUrl: string;
  /** 同步跳转地址（用户支付完成后浏览器跳转，可选） */
  returnUrl?: string;
  /** 订单描述（可选） */
  description?: string;
  /** 渠道级扩展参数（如 Stripe metadata、支付宝 body 等） */
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  /** 渠道方交易号（可选，部分渠道异步返回） */
  providerTradeNo?: string;
  /** 扫码支付二维码 URL */
  qrCode?: string;
  /** 跳转支付 URL（如 Stripe Checkout） */
  redirectUrl?: string;
  /** 渠道原始响应数据（调试用） */
  raw?: Record<string, unknown>;
}

// ── 回调验签 ──

export interface CallbackResult {
  /** 系统订单号（从渠道回调中提取） */
  orderNo: string;
  /** 渠道方交易号 */
  providerTradeNo: string;
  /** 回调金额（分） */
  amountCents: number;
  /** 货币代码 */
  currency: string;
  /** 支付时间 ISO 格式 */
  paidAt: string;
  /** 渠道原始回调数据 */
  raw?: Record<string, unknown>;
}

// ── 查询状态 ──

export interface QueryStatusResult {
  /** 是否已支付 */
  paid: boolean;
  /** 渠道方交易号 */
  providerTradeNo?: string;
}

// ── Provider 接口 ──

export interface PaymentProvider {
  /** 渠道标识（如 "alipay" / "stripe"） */
  readonly name: string;

  /** 渠道显示名称（中文，管理后台 / 前端展示用） */
  readonly displayName: string;

  /** 支持的货币列表（如 ["CNY"] / ["USD", "EUR"]） */
  readonly supportedCurrencies: string[];

  /**
   * 创建支付订单，返回前端需要的展示数据（二维码 / 跳转链接）。
   */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /**
   * 验证回调请求签名 + 解析回调数据，返回标准化的 CallbackResult。
   * 签名验证失败时抛出 Error。
   *
   * @param params - 已解析的回调参数（路由层从 Request body 解析后传入）
   */
  verifyCallback(params: Record<string, string>): Promise<CallbackResult>;

  /**
   * 主动查询支付状态（可选，部分渠道不支持）。
   */
  queryStatus?(tradeNo: string): Promise<QueryStatusResult>;
}
