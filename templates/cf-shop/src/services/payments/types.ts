/**
 * 支付提供者接口
 *
 * 定义统一的支付接口规范，支持多种支付方式（支付宝、微信、手动等）。
 * 所有支付提供者必须实现此接口。
 */

/**
 * 创建支付请求的参数
 */
export interface CreatePaymentParams {
  /** 商户订单号（我方生成的） */
  outTradeNo: string;
  /** 订单金额（分） */
  amountCents: number;
  /** 商品描述 */
  subject: string;
  /** 回调通知地址 */
  notifyUrl: string;
  /** 返回地址（支付完成后跳转） */
  returnUrl?: string;
}

/**
 * 创建支付请求的响应
 */
export interface CreatePaymentResult {
  /** 是否成功 */
  ok: boolean;
  /** 支付页面 URL（用户跳转） */
  paymentUrl?: string;
  /** 支付表单 HTML（自动提交） */
  paymentForm?: string;
  /** 二维码 URL（扫码支付） */
  qrCode?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 支付回调通知的数据
 */
export interface PaymentNotification {
  /** 是否支付成功 */
  success: boolean;
  /** 商户订单号 */
  outTradeNo: string;
  /** 第三方交易号 */
  tradeNo: string;
  /** 支付金额（分） */
  amountCents: number;
  /** 支付时间 */
  paidAt: string;
  /** 原始通知数据（用于日志） */
  rawData: Record<string, unknown>;
}

/**
 * 支付提供者接口
 *
 * 所有支付方式必须实现此接口。
 */
export interface PaymentProvider {
  /** 支付方式标识（如 "alipay", "wechat"） */
  readonly id: string;
  /** 支付方式名称（如 "支付宝"） */
  readonly name: string;

  /**
   * 创建支付请求
   *
   * @param params - 创建支付参数
   * @param env - Cloudflare 环境变量（含支付密钥）
   * @returns 创建支付结果
   */
  createPayment(
    params: CreatePaymentParams,
    env: Record<string, unknown>,
  ): Promise<CreatePaymentResult>;

  /**
   * 验证支付回调通知
   *
   * @param body - 回调请求体（URL 编码或 JSON）
   * @param headers - 请求头
   * @param env - Cloudflare 环境变量
   * @returns 解析后的通知数据
   */
  verifyNotification(
    body: string,
    headers: Headers,
    env: Record<string, unknown>,
  ): Promise<PaymentNotification>;
}
