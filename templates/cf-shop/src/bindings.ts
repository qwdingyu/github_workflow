import type { DbType } from "./db/client";

export type IssueMode = "direct" | "manual";

export type Bindings = {
  // Turso 数据库连接（必填）
  TURSO_URL: string;
  TURSO_TOKEN?: string;
  ASSETS: Fetcher;
  // 生产环境必须通过 wrangler secret put 设置；本地开发通过 .dev.vars 提供。
  ADMIN_TOKEN?: string;
  // 配置后，用户侧创建订单必须通过 Turnstile；未配置时本地和低风险演示可以跳过。
  TURNSTILE_SECRET_KEY?: string;
  // 用于把真实 IP 哈希化后写入 request_logs，避免日志里保存明文 IP。
  RATE_LIMIT_SALT?: string;
  // 生成 lookupUrl 时使用的正式站点域名。
  APP_ORIGIN?: string;
  // ── 支付宝当面付（个人可用，0.6% 费率，扫码支付）──
  // 通过 wrangler secret put 配置 ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY
  ALIPAY_APP_ID?: string;
  ALIPAY_PRIVATE_KEY?: string;
  ALIPAY_PUBLIC_KEY?: string;
  // ── TRC20/USDT 加密货币支付（零资质全球收款）──
  // 使用单地址 + 唯一 Memo 模式区分不同订单。
  // 用户向指定地址转账后，前端轮询 /pay/status 时自动检查链上交易。
  // 通过 wrangler secret put 配置。
  TRC20_WALLET_ADDRESS?: string;  // TRC20 收款地址（如 TR7NHq...）
  TRONGRID_API_KEY?: string;      // TronGrid API Key（免费方案即可）
  // ── Stripe 支付（资质就绪后启用） ──
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // Resend API Key，用于订单发卡后邮件通知买家。通过 wrangler secret put 配置。
  RESEND_API_KEY?: string;
  // Resend 已验证的发件域名（如 "eshop <noreply@eforge.xyz>"），未配置时使用默认值。
  EMAIL_FROM?: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    // 中间件保证 db 一定已初始化（非 undefined）；
    // health 路由在 DB 不可用时 db 为 undefined，由路由自行降级处理。
    db: DbType | undefined;
    // ExecutionContext，用于 ctx.waitUntil() 异步邮件发送（节省请求 CPU 时间）
    executionCtx: ExecutionContext;
  };
};
