import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonOk(c: Context, data: Record<string, unknown> = {}, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true, ...data }, status);
}

export function jsonError(c: Context, message: string, status: ContentfulStatusCode = 400, details?: unknown) {
  return c.json({ ok: false, error: message, details }, status);
}

export function getClientIp(c: Context) {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
}

export async function hashValue(value: string, salt: string) {
  const input = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
