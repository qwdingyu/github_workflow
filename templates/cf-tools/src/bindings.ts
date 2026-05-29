/**
 * cf-tools — 环境变量绑定 & Hono 上下文类型
 *
 * 扩展 @eforge/cf-core 的 CoreBindings，添加本项目的专属环境变量。
 * 所有 Secrets 通过 wrangler secret put 设置，不会出现在代码中。
 */

import type { CoreBindings, CoreVariables } from "@eforge/cf-core/types";
import type { DrizzleInstance } from "@eforge/cf-core/db";
import type * as schema from "./db/schema";

// ── 环境变量绑定 ──────────────────────────────────────────────────────────────
// 继承 cf-core 的公共绑定（TURSO_URL, TURSO_TOKEN, ADMIN_TOKEN 等）
// 添加 cf-tools 专属的环境变量

/**
 * cf-tools 的 Cloudflare Workers 环境变量
 */
export interface AppBindings extends CoreBindings {
  /** JWT 签名密钥（HMAC-SHA256，至少 32 字符） */
  JWT_SECRET: string;

  /** KV 命名空间绑定（可选，用于缓存/限流） */
  KV?: KVNamespace;

  /** 静态资源绑定（wrangler.jsonc 自动注入） */
  ASSETS: Fetcher;

  /** AES-256-GCM 加密密钥（64 字符 hex = 256 bit，与部署脚本命名一致） */
  CREDENTIALS_ENCRYPTION_KEY?: string;
}

// ── Hono Variables ────────────────────────────────────────────────────────────
// 存储在 c.set() 中的运行时变量

/**
 * cf-tools 的 Hono 上下文变量
 */
export interface AppVariables extends CoreVariables {
  /** Drizzle ORM 数据库实例（由 bootstrap 中间件注入） */
  db: DrizzleInstance<typeof schema>;

  /** 当前登录用户 ID（由认证中间件注入） */
  userId?: string;

  /** 当前登录用户邮箱 */
  userEmail?: string;

  /** 是否为管理员角色 */
  isAdmin?: boolean;

  /** 执行上下文（用于 waitUntil） */
  executionCtx?: ExecutionContext;
}

// ── Hono 环境类型 ─────────────────────────────────────────────────────────────

/**
 * Hono 环境类型 — 用于路由定义时的泛型参数
 *
 * 使用示例：
 * ```ts
 * import type { AppEnv } from "./bindings";
 * const router = new Hono<AppEnv>();
 * ```
 */
export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};
