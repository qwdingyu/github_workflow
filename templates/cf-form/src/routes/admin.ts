/**
 * 管理端路由
 *
 * GET    /admin/submissions    — 查询提交记录（需 ADMIN_TOKEN）
 * GET    /admin/forms          — 表单列表
 * POST   /admin/forms          — 创建表单
 * PUT    /admin/forms/:id      — 更新表单
 * DELETE /admin/forms/:id      — 删除表单
 */

import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import type { AppEnv } from "../bindings";
import { ok, fail } from "@eforge/cf-core/http";
import { createAdminAuth } from "@eforge/cf-core/middleware";
import { submissions, forms } from "../db/schema";

export const adminRoute = new Hono<AppEnv>();

adminRoute.use("*", createAdminAuth());

// ── 提交记录 ──

adminRoute.get("/submissions", async (c) => {
  const db = c.get("db");
  const formSlug = c.req.query("form") || "";

  let query = db
    .select({
      id: submissions.id,
      formId: submissions.formId,
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

// ── 表单 CRUD ──

/** GET /admin/forms — 表单列表 */
adminRoute.get("/forms", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(forms)
    .orderBy(forms.sortOrder);

  return ok(c, {
    forms: rows.map((row) => ({
      ...row,
      formSchema: JSON.parse(row.formSchema),
      settings: JSON.parse(row.settings),
    })),
  });
});

/** POST /admin/forms — 创建表单 */
adminRoute.post("/forms", async (c) => {
  const db = c.get("db");
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(forms).values({
    id,
    slug: body.slug,
    title: body.title,
    description: body.description || "",
    formSchema: JSON.stringify(body.formSchema || []),
    settings: JSON.stringify(body.settings || {}),
    status: body.status || "active",
    sortOrder: body.sortOrder ?? 100,
    createdAt: now,
    updatedAt: now,
  });

  return ok(c, { id }, 201);
});

/** PUT /admin/forms/:id — 更新表单 */
adminRoute.put("/forms/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json();

  const updateData: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.slug !== undefined) updateData.slug = body.slug;
  if (body.formSchema !== undefined) updateData.formSchema = JSON.stringify(body.formSchema);
  if (body.settings !== undefined) updateData.settings = JSON.stringify(body.settings);
  if (body.status !== undefined) updateData.status = body.status;
  if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;

  await db.update(forms).set(updateData).where(eq(forms.id, id));

  return ok(c, { updated: true });
});

/** DELETE /admin/forms/:id — 删除表单 */
adminRoute.delete("/forms/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");

  await db.delete(forms).where(eq(forms.id, id));

  return ok(c, { deleted: true });
});
