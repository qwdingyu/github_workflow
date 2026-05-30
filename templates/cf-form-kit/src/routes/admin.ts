/**
 * 管理端路由
 *
 * GET /admin/submissions — 查询提交记录（需 ADMIN_TOKEN）
 */

import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import type { AppEnv } from "../bindings";
import { ok } from "@eforge/cf-core/http";
import { createAdminAuth } from "@eforge/cf-core/middleware";
import { submissions } from "../db/schema";

export const adminRoute = new Hono<AppEnv>();

adminRoute.use("*", createAdminAuth());

adminRoute.get("/submissions", async (c) => {
  const db = c.get("db");
  const formSlug = c.req.query("form") || "";

  let query = db
    .select({
      id: submissions.id,
      formSlug: submissions.formSlug,
      contact: submissions.contact,
      payloadJson: submissions.payloadJson,
      source: submissions.source,
      status: submissions.status,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .orderBy(desc(submissions.createdAt))
    .limit(50);

  if (formSlug) {
    query = query.where(eq(submissions.formSlug, formSlug)) as typeof query;
  }

  const rows = await query;

  return ok(c, {
    submissions: rows.map((row) => ({
      ...row,
      payload: JSON.parse(row.payloadJson || "{}"),
      payloadJson: undefined,
    })),
  });
});
