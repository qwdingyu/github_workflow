import type { Context } from "hono";
import type { AppEnv } from "../bindings";
import { getClientIp, hashValue } from "./http";

export async function enforceRateLimit(c: Context<AppEnv>, action: string, limit: number, windowSeconds: number) {
  const salt = c.env.RATE_LIMIT_SALT || "dev-only";
  const ipHash = await hashValue(getClientIp(c), salt);
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const count = await c.env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM request_logs
    WHERE action = ?1 AND ip_hash = ?2 AND created_at >= ?3
  `).bind(action, ipHash, since).first<{ count: number }>();

  if ((count?.count || 0) >= limit) {
    return { ok: false, ipHash, retryAfter: windowSeconds };
  }

  return { ok: true, ipHash };
}

export async function writeRequestLog(
  c: Context<AppEnv>,
  input: { ipHash: string; action: string; statusCode: number }
) {
  const path = new URL(c.req.url).pathname;
  await c.env.DB.prepare(`
    INSERT INTO request_logs (id, ip_hash, method, path, action, status_code)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(crypto.randomUUID(), input.ipHash, c.req.method, path, input.action, input.statusCode).run();
}
