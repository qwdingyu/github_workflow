import { Hono } from "hono";
import { count } from "drizzle-orm";
import type { AppEnv } from "../bindings";
import { forms } from "../config/forms";
import { createDb } from "../db/client";
import { submissions } from "../db/schema";
import { jsonOk } from "../lib/http";

export const healthRoute = new Hono<AppEnv>();

healthRoute.get("/health", async (c) => {
  const db = createDb(c.env.DB);
  const [row] = await db.select({ count: count() }).from(submissions);
  return jsonOk(c, {
    service: c.env.APP_NAME || "cf-form-kit",
    storage: "d1",
    forms: forms.map((form) => form.slug),
    submissions: row?.count || 0
  });
});
