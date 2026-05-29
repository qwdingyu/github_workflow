/**
 * cf-api — 环境变量与 Hono 变量类型定义
 *
 * 扩展 @eforge/cf-core 的 CoreBindings / CoreVariables，
 * 添加 API 中间层服务特有的环境变量（渠道 API Key、加密密钥等）。
 */

import type { CoreBindings, CoreVariables } from "@eforge/cf-core/types";
import type { DrizzleInstance } from "@eforge/cf-core/db";
import type { ApiKeyContext } from "@eforge/cf-core/middleware";
import type * as schema from "./db/schema";

/**
 * Cloudflare Workers 环境变量（Secrets + Vars）
 *
 * 部署时通过 wrangler secret put 或 wrangler.jsonc [vars] 配置。
 */
export interface AppBindings extends CoreBindings {
  // ── 数据库（继承自 CoreBindings） ──
  // TURSO_URL: string;
  // TURSO_TOKEN: string;

  // ── 凭证加密密钥（64 字符 hex = 256 bit） ──
  CREDENTIALS_ENCRYPTION_KEY?: string;

  // ── 渠道 API Keys（按需添加） ──
  /** 渠道 A 的 API Key */
  CHANNEL_A_API_KEY?: string;
  /** 渠道 B 的 API Key */
  CHANNEL_B_API_KEY?: string;
  /** 渠道 C 的 API Key */
  CHANNEL_C_API_KEY?: string;

  // ── 静态资源 binding（wrangler assets） ──
  ASSETS: Fetcher;
}

/**
 * Hono Variables — 请求生命周期内的中间件注入变量
 */
export interface AppVariables extends CoreVariables {
  /** Drizzle 数据库实例（含完整 schema） */
  db: DrizzleInstance<typeof schema>;

  /** API Key 认证上下文（通过 createApiKeyAuth 注入） */
  apiKeyContext?: ApiKeyContext;

  /** 认证用户 ID */
  userId?: string;

  /** Cloudflare 执行上下文（waitUntil 等） */
  executionCtx: ExecutionContext;
}

/**
 * Hono 环境类型 — 所有路由和中间件的泛型约束
 */
export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}
