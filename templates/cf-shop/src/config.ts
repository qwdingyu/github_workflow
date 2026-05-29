/**
 * 商城配置文件
 *
 * 这是用户主要修改的文件。包含商品分类、支付方式、邮件模板等配置。
 * 敏感配置从环境变量读取，非敏感配置在此文件中定义。
 */

/**
 * 商品分类
 */
export const PRODUCT_CATEGORIES = [
  { id: "account", name: "账号", description: "各类平台账号" },
  { id: "card", name: "卡密", description: "充值卡、激活码" },
  { id: "service", name: "服务", description: "订阅服务、会员服务" },
] as const;

/**
 * 支持的支付方式
 */
export const PAYMENT_METHODS = [
  {
    id: "alipay",
    name: "支付宝",
    icon: "alipay",
    enabled: true,
    description: "支付宝当面付（扫码支付）",
  },
  {
    id: "manual",
    name: "手动确认",
    icon: "manual",
    enabled: true,
    description: "线下转账，管理员手动确认",
  },
] as const;

/**
 * 订单状态
 */
export const ORDER_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  ISSUED: "issued",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
} as const;

/**
 * 卡密状态
 */
export const CARD_STATUS = {
  AVAILABLE: "available",
  LOCKED: "locked",
  ISSUED: "issued",
  RETURNED: "returned",
} as const;

/**
 * 订单过期时间（分钟）
 */
export const ORDER_EXPIRE_MINUTES = 30;

/**
 * 库存告警阈值（低于此数量时标记为低库存）
 */
export const LOW_STOCK_THRESHOLD = 10;

/**
 * 默认分页大小
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * 最大分页大小
 */
export const MAX_PAGE_SIZE = 100;

/**
 * 缓存配置（秒）
 */
export const CACHE_TTL = {
  PRODUCTS_LIST: 300, // 商品列表 5 分钟
  PRODUCT_DETAIL: 180, // 商品详情 3 分钟
  HEALTH_CHECK: 60, // 健康检查 1 分钟
} as const;

/**
 * 邮件模板配置
 */
export const EMAIL_TEMPLATES = {
  orderConfirmed: {
    subject: "订单确认 - {{orderNo}}",
    body: `
您好！

您的订单已确认：
订单号：{{orderNo}}
商品：{{productName}}
数量：{{quantity}}
金额：{{amount}}

卡密信息：
{{cards}}

如有问题，请联系客服。
    `.trim(),
  },
  orderExpired: {
    subject: "订单已过期 - {{orderNo}}",
    body: `
您好！

您的订单已过期：
订单号：{{orderNo}}
商品：{{productName}}

如需购买，请重新下单。
    `.trim(),
  },
};

/**
 * Turnstile 配置
 */
export const TURNSTILE_CONFIG = {
  siteKey: "YOUR_TURNSTILE_SITE_KEY", // 替换为你的 Turnstile Site Key
};

/**
 * 系统配置键名（存储在 system_config 表中）
 */
export const CONFIG_KEYS = {
  SITE_NAME: "site_name",
  SITE_DESCRIPTION: "site_description",
  ANNOUNCEMENT: "announcement",
  ENABLE_REGISTRATION: "enable_registration",
  ENABLE_COUPON: "enable_coupon",
  CONTACT_EMAIL: "contact_email",
  CONTACT_TELEGRAM: "contact_telegram",
} as const;
