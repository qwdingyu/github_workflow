import type { Context, Next } from "hono";
import type { AppEnv } from "../bindings";
import { jsonError } from "./http";

export async function verifyTurnstile(c: Context<AppEnv>, token?: string) {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: "缺少 Turnstile token" };

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  formData.append("remoteip", c.req.header("cf-connecting-ip") || "");

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData
  });
  const result = await response.json<{ success?: boolean; "error-codes"?: string[] }>();

  if (!result.success) {
    return { ok: false, error: "Turnstile 校验失败", details: result["error-codes"] || [] };
  }

  return { ok: true };
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return jsonError(c, "管理接口未配置 ADMIN_TOKEN", 503);

  const header = c.req.header("authorization") || "";
  if (header !== `Bearer ${token}`) return jsonError(c, "未授权", 401);

  await next();
}
