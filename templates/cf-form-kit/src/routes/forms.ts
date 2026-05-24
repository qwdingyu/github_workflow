import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../bindings";
import { getFormDefinition, submissionSchema, validateBusinessFields } from "../config/forms";
import { jsonError, jsonOk } from "../lib/http";
import { readIdempotencyKey, getStoredIdempotency, storeIdempotency } from "../lib/idempotency";
import { enforceRateLimit, writeRequestLog } from "../lib/rate-limit";
import { verifyTurnstile } from "../lib/security";

export const formsRoute = new Hono<AppEnv>();

formsRoute.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const form = getFormDefinition(slug);
  if (!form) return jsonError(c, "表单不存在", 404);

  return jsonOk(c, { form });
});

formsRoute.post(
  "/:slug/submissions",
  zValidator("json", submissionSchema, (result, c) => {
    if (!result.success) return jsonError(c, "提交内容格式不正确", 400, result.error.message);
  }),
  async (c) => {
    const slug = c.req.param("slug");
    const form = getFormDefinition(slug);
    if (!form) return jsonError(c, "表单不存在", 404);

    const input = c.req.valid("json");
    const action = `submit:${slug}`;
    const rate = await enforceRateLimit(c, action, 5, 60);
    if (!rate.ok) {
      await writeRequestLog(c, { ipHash: rate.ipHash, action, statusCode: 429 });
      return jsonError(c, "提交过于频繁，请稍后再试", 429);
    }

    const turnstile = await verifyTurnstile(c, input.turnstileToken);
    if (!turnstile.ok) {
      await writeRequestLog(c, { ipHash: rate.ipHash, action, statusCode: 403 });
      return jsonError(c, turnstile.error || "安全校验失败", 403, turnstile.details);
    }

    const business = validateBusinessFields(form, input.fields);
    if (!business.ok) {
      await writeRequestLog(c, { ipHash: rate.ipHash, action, statusCode: 400 });
      return jsonError(c, "业务字段校验失败", 400, business.errors);
    }

    const idempotencyKey = readIdempotencyKey(c);
    if (idempotencyKey) {
      const stored = await getStoredIdempotency(c, idempotencyKey, action);
      if (stored) return c.json(JSON.parse(stored.responseJson), 200);
    }

    const submissionId = crypto.randomUUID();
    const response = {
      ok: true,
      submission: {
        id: submissionId,
        formSlug: slug,
        contact: input.contact,
        source: input.source
      }
    };

    await c.env.DB.prepare(`
      INSERT INTO submissions (id, form_slug, contact, payload_json, source, idempotency_key)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      submissionId,
      slug,
      input.contact,
      JSON.stringify(business.cleaned),
      input.source,
      idempotencyKey || null
    ).run();

    if (idempotencyKey) {
      await storeIdempotency(c, {
        key: idempotencyKey,
        action,
        resourceId: submissionId,
        response
      });
    }

    await writeRequestLog(c, { ipHash: rate.ipHash, action, statusCode: 201 });
    return c.json(response, 201);
  }
);
