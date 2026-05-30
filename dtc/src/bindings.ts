/**
 * DTC 故障码查询服务 — 环境变量与 Hono 变量类型定义
 *
 * 扩展 @eforge/cf-core 的 CoreBindings / CoreVariables。
 * db 类型使用 CoreVariables 的 unknown，路由层通过 getDb() 助手转型。
 */

import type { CoreBindings, CoreVariables } from "@eforge/cf-core/types";

/** Cloudflare Workers 环境变量 */
export interface AppBindings extends CoreBindings {
  ASSETS: Fetcher;
}

/** Hono Variables — db 保持 unknown（运行时实际为 DrizzleInstance），路由层转型使用 */
export interface AppVariables extends CoreVariables {
  executionCtx: ExecutionContext;
}

/** Hono 环境类型 */
export interface AppEnv {
  Bindings: AppBindings;
  Variables: AppVariables;
}