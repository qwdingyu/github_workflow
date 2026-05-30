/**
 * 健康检查路由
 *
 * GET /health — 返回服务状态、数据库连通性、表单列表和提交统计。
 */

import { Hono } from "hono";
import { count } from "drizzle-orm";
import type { AppEnv } from "../bindings";
import { ok, fail } from "@eforge/cf-core/http";
import { forms, submissions } from "../db/schema";

export const healthRoute = new Hono<AppEnv>();

healthRoute.get("/", async (c) => {
  const db = c.get("db");
  if (!db) return fail(c, "数据库不可用", 503);

  const [submissionRow] = await db.select({ count: count() }).from(submissions);
  const formRows = await db.select({ slug: forms.slug, status: forms.status }).from(forms);

  return ok(c, {
    service: c.env.APP_NAME || "cf-form",
    storage: "turso",
    forms: formRows.filter((f) => f.status === "active").map((f) => f.slug),
    submissions: submissionRow?.count || 0,
  });
});
