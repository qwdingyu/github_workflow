/**
 * ToolDriver 接口 — 工具驱动抽象
 *
 * 所有工具必须实现此接口。添加新工具只需：
 * 1. 创建新文件实现 ToolDriver 接口
 * 2. 在 registry.ts 中注册
 * 3. 在 config.ts 的 registeredTools 中添加元数据
 */

import type { AppBindings } from "../../bindings";

// ── 工具执行上下文 ───────────────────────────────────────────────────────────

/**
 * 工具执行时可访问的上下文信息
 */
export interface ToolContext {
  /** Cloudflare Workers 环境变量 */
  env: AppBindings;
  /** 当前用户 ID（未登录为 undefined） */
  userId?: string;
}

// ── 工具驱动接口 ─────────────────────────────────────────────────────────────

/**
 * 工具驱动接口
 *
 * 每个工具实现此接口，提供统一的输入/输出契约。
 *
 * @example
 * ```ts
 * import type { ToolDriver } from "./types";
 *
 * export const myTool: ToolDriver = {
 *   name: "my-tool",
 *   description: "我的工具",
 *   async run(input, ctx) {
 *     // 实现工具逻辑
 *     return { result: "..." };
 *   },
 * };
 * ```
 */
export interface ToolDriver {
  /** 工具唯一标识（与数据库 slug 一致） */
  name: string;

  /** 工具描述 */
  description: string;

  /**
   * 执行工具
   *
   * @param input - 工具输入（来自请求体，已解析为对象）
   * @param ctx - 执行上下文（环境变量、用户信息等）
   * @returns 工具执行结果（任意可序列化的对象）
   * @throws Error 如果执行失败，抛出异常会被路由层捕获并记录
   */
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>>;
}
