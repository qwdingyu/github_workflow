import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { jsonOk } from "../lib/http";
import { requireAdmin } from "../lib/security";

export const adminRoute = new Hono<AppEnv>();

adminRoute.use("*", requireAdmin);

adminRoute.get("/submissions", async (c) => {
  const formSlug = c.req.query("form") || "";
  const rows = await c.env.DB.prepare(`
    SELECT id, form_slug AS formSlug, contact, payload_json AS payloadJson, source, status, created_at AS createdAt
    FROM submissions
    WHERE (?1 = '' OR form_slug = ?1)
    ORDER BY created_at DESC
    LIMIT 50
  `).bind(formSlug).all();

  return jsonOk(c, {
    submissions: (rows.results || []).map((row: Record<string, unknown>) => ({
      ...row,
      payload: JSON.parse(String(row.payloadJson || "{}")),
      payloadJson: undefined
    }))
  });
});
