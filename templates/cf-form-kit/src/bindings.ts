/**
 * cf-form-kit — 环境变量与 Hono 变量类型定义
 *
 * 扩展 @eforge/cf-core 的 CoreBindings / CoreVariables，
 * 添加表单工具特有的环境变量。
 */

import type { CoreBindings, CoreVariables } from "@eforge/cf-core/types";
import type { DbType } from "./db/client";

/**
 * Cloudflare Workers 环境变量（Secrets + Vars）
 */
export interface FormKitBindings extends CoreBindings {
  /** 静态资源 binding（wrangler assets） */
  ASSETS: Fetcher;

  /** 应用名称（展示用） */
  APP_NAME?: string;

  /** 默认表单 slug */
  DEFAULT_FORM_SLUG?: string;
}

/**
 * Hono Variables — 请求生命周期内的中间件注入变量
 */
export interface FormKitVariables extends CoreVariables {
  db: DbType;
}

/**
 * Hono 环境类型 — 所有路由和中间件的泛型约束
 */
export type AppEnv = {
  Bindings: FormKitBindings;
  Variables: FormKitVariables;
};
