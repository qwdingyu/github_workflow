/**
 * DTC 故障码查询服务 — 环境变量与 Hono 变量类型定义
 */

import type { DbType } from "./db/database";

/**
 * Cloudflare Workers 环境变量
 */
export interface AppBindings {
  /** Turso 数据库 URL（必填） */
  TURSO_URL: string;
  /** Turso 认证 Token */
  TURSO_TOKEN?: string;
  /** 站点域名 */
  APP_ORIGIN?: string;
  /** 限流盐值 */
  RATE_LIMIT_SALT?: string;
  /** Cloudflare 静态资源绑定 */
  ASSETS: Fetcher;
}

/**
 * Hono Variables
 */
export interface AppVariables {
  /** Drizzle 数据库实例 */
  db: DbType;
  /** Cloudflare ExecutionContext */
  executionCtx: ExecutionContext;
}

/**
 * Hono 环境类型
 */
export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}