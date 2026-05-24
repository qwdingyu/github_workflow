import type { Context } from "hono";
import type { AppEnv } from "../bindings";

export function readIdempotencyKey(c: Context) {
  const key = c.req.header("idempotency-key") || "";
  if (!key) return undefined;
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(key)) return undefined;
  return key;
}

export async function getStoredIdempotency(c: Context<AppEnv>, key: string, action: string) {
  return c.env.DB.prepare(`
    SELECT response_json AS responseJson
    FROM idempotency_keys
    WHERE key = ?1 AND action = ?2
  `).bind(key, action).first<{ responseJson: string }>();
}

export async function storeIdempotency(
  c: Context<AppEnv>,
  input: { key: string; action: string; resourceId: string; response: unknown }
) {
  await c.env.DB.prepare(`
    INSERT INTO idempotency_keys (key, action, resource_id, response_json)
    VALUES (?1, ?2, ?3, ?4)
  `).bind(input.key, input.action, input.resourceId, JSON.stringify(input.response)).run();
}
