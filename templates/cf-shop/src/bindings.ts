/**
 * 应用环境变量类型定义
 *
 * 扩展 @eforge/cf-core 的 CoreBindings，添加发卡商城特有的环境变量。
 * 所有敏感变量通过 wrangler secret put 设置，非敏感变量在 wrangler.jsonc 中配置。
 */

import type { CoreBindings } from "@eforge/cf-core/types";
import type { DrizzleInstance } from "@eforge/cf-core/db";
import type * as schema from "./db/schema";

/**
 * 发卡商城环境变量
 *
 * 继承 CoreBindings（TURSO_URL, TURSO_TOKEN, ADMIN_TOKEN, TURNSTILE_SECRET_KEY 等）
 * 并添加支付、邮件等商城特有配置
 */
export interface ShopBindings extends CoreBindings {
  // ── 非敏感变量（wrangler.jsonc vars）──
  APP_ORIGIN: string;

  // ── 支付配置（wrangler secret put）──
  /** 支付宝应用 ID */
  ALIPAY_APP_ID?: string;
  /** 支付宝应用私钥（RSA2） */
  ALIPAY_PRIVATE_KEY?: string;
  /** 支付宝公钥（用于验签） */
  ALIPAY_PUBLIC_KEY?: string;
  /** 支付宝回调地址（可选，默认使用 APP_ORIGIN + /api/orders/alipay/notify） */
  ALIPAY_NOTIFY_URL?: string;

  // ── 邮件配置（wrangler secret put）──
  /** Resend API Key（用于发送订单通知邮件） */
  RESEND_API_KEY?: string;
  /** Resend 发件人地址（如 "shop <noreply@example.com>"） */
  EMAIL_FROM?: string;

  // ── 加密密钥（wrangler secret put，与部署脚本 02-setup-secrets.sh 命名一致）──
  /** AES-256-GCM 加密密钥（64 字符 hex = 32 字节 = 256 bit） */
  CREDENTIALS_ENCRYPTION_KEY?: string;

  // ── 静态资源 binding（wrangler.jsonc assets）──
  ASSETS: Fetcher;
}

/**
 * Hono 上下文变量
 */
export interface ShopVariables {
  /** Drizzle ORM 数据库实例（由 bootstrap 中间件注入） */
  db: DrizzleInstance<typeof schema>;
  /** Cloudflare Worker 执行上下文 */
  executionCtx: ExecutionContext;
}

/**
 * 应用环境类型（用于 Hono 泛型参数）
 */
export type AppEnv = {
  Bindings: ShopBindings;
  Variables: ShopVariables;
};
