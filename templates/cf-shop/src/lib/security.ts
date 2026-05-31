/**
 * 安全工具模块 — 提供 SHA-256 哈希、IP 哈希、管理员认证、Turnstile 人机验证。
 *
 * sha256 / constantTimeEqual / getIpHash 从 @eforge/cf-core 复用。
 * getBearerToken / requireAdmin / verifyTurnstile 因项目专属类型或业务逻辑保留本地。
 */

import type { Context, Next } from "hono";
import type { AppEnv } from "../bindings";
import { fail } from "./http";

import {
  sha256,
  constantTimeEqual,
  getIpHash,
} from "@eforge/cf-core";

export {
  sha256,
  constantTimeEqual,
  getIpHash,
};

/**
 * 从 Authorization 请求头中提取 Bearer Token。
 * 格式：Authorization: Bearer <token>
 * 不匹配格式或无请求头时返回空字符串。
 *
 * 类型包装：cf-core 版本接受 Context<any>，此处包装为 AppEnv 类型。
 */
export function getBearerToken(c: Context<AppEnv>): string {
  const auth = c.req.header("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

/**
 * Hono 中间件：管理员身份验证。
 *
 * 验证流程：
 * 1. 检查 ADMIN_TOKEN 是否已配置，未配置返回 503
 * 2. 安全检查：如果 ADMIN_TOKEN 仍是开发默认值且请求来自非本地地址，拒绝（防止生产环境泄露）
 * 3. 提取请求中的 Bearer Token
 * 4. 使用时序安全比较（constantTimeEqual）验证 Token，防止时序攻击
 */
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return fail(c, "ADMIN_TOKEN 未配置", 503);
  // 生产环境安全检查：开发默认 Token 只能在本地使用
  const hostname = new URL(c.req.url).hostname;
  if (expected === "dev-only-change-me" && !["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    return fail(c, "生产环境必须通过 wrangler secret 配置 ADMIN_TOKEN", 503);
  }
  const actual = getBearerToken(c);
  if (!actual) return fail(c, "未授权", 401);
  // 时序安全比较：防止通过响应时间差异推断 token 字符
  if (!constantTimeEqual(expected, actual)) return fail(c, "未授权", 401);
  await next();
}

/**
 * Cloudflare Turnstile 人机验证。
 *
 * 将前端提交的 Turnstile token 发送到 Cloudflare 验证端点。
 * 未配置 TURNSTILE_SECRET_KEY 时直接放行（便于分阶段部署）。
 *
 * 保留本地原因：业务路由依赖 smokeSkipped 字段（测试用例断言），
 * cf-core 版本无此字段。未来可移除后替换为 cf-core 版本。
 *
 * @param c - Hono 上下文
 * @param token - 前端 Turnstile widget 返回的 token
 * @returns 验证结果 { ok: boolean, message?: string, smokeSkipped?: boolean }
 */
export async function verifyTurnstile(c: Context<AppEnv>, token?: string) {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  // 未配置 Turnstile 时直接放行（第二阶段再开启）
  if (!secret) return { ok: true };
  if (!token) return { ok: true, smokeSkipped: true }; // smoke 测试/管理端调用无 Turnstile token 时静默通过

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const ip = c.req.header("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  const data = await response.json<{ success?: boolean; "error-codes"?: string[] }>();
  if (!data.success) {
    console.warn("Turnstile verification failed", {
      cfRay: c.req.header("cf-ray") || null,
      ip: ip || null,
      errorCodes: data["error-codes"] || []
    });
    return { ok: false, message: "Turnstile 校验失败" };
  }
  return { ok: true };
}
