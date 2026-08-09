/**
 * 统一 HTTP 响应 envelope（对齐 cf-lottery `lib/http` 思想）。
 * Admin / 运维 API 使用 { ok, data?, message? }，避免各路由自造形状。
 *
 * 自 v0.5.0 起：ok/fail 委托给 @usethink/cf-core/http（统一实现），
 * safeJsonBody 本地保留（返回 null 的契约，与 core 的 undefined 不同）。
 */
import type { Context } from "hono";
import type { AppEnv } from "../bindings";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ok as coreOk, fail as coreFail, clampInteger as coreClampInteger } from "@usethink/cf-core/http";

/** 成功：200 + ok:true + 业务字段展开到顶层（与 lottery 习惯一致） */
export function ok(c: Context<AppEnv>, data: Record<string, unknown> = {}) {
  return coreOk(c as any, data);
}

/**
 * 失败：双字段兼容（docs/091 P0-7）——同时输出 message（历史契约）与 error（与 cf-core 一致），
 * 不泄露内部堆栈；后续可逐步收敛到单一字段。
 */
export function fail(
  c: Context<AppEnv>,
  message: string,
  status: ContentfulStatusCode = 400,
) {
  return coreFail(c as any, message, status);
}

/** 安全解析 JSON；非法体返回 null 由调用方决定 400（保留本地契约，非 core 的 undefined） */
export async function safeJsonBody<T>(c: Context<AppEnv>): Promise<T | null> {
  try {
    return await c.req.json<T>();
  } catch {
    return null;
  }
}

/** 分页/计数钳位，防 NaN 与过大 offset（委托 core utils） */
export function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return coreClampInteger(value, fallback, min, max);
}

/**
 * 取客户端 IP —— 统一到 getClientIp（platform.ts 有条件信任 XFF）；
 * 保留此函数作为薄封装，避免逐个调用点改 import。
 */
export { getClientIp as clientIp } from "./platform";
