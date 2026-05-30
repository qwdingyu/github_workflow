/**
 * 表单提交路由
 *
 * GET  /:slug             — 获取表单定义
 * POST /:slug/submissions — 提交表单（限流 + Turnstile + 幂等）
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../bindings";
import { getFormDefinition, submissionSchema, validateBusinessFields } from "../config/forms";
import { ok, fail } from "@eforge/cf-core/http";
import { getIpHash, verifyTurnstile } from "@eforge/cf-core/security";
import { DbRateLimiter } from "@eforge/cf-core/rate-limit";
import { checkIdempotency, saveIdempotentResponse } from "@eforge/cf-core/idempotency";
import { rateLimitWindows, submissions, requestLogs } from "../db/schema";

/** 从请求头提取幂等键 */
function readIdempotencyKey(c: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const key = c.req.header("idempotency-key") || "";
  if (!key) return undefined;
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(key)) return undefined;
  return key;
}

/** 写入请求日志（审计用） */
async function writeRequestLog(
  db: AppEnv["Variables"]["db"],
  input: { ipHash: string; action: string; statusCode: number; method: string; path: string },
): Promise<void> {
  await db.insert(requestLogs).values({
    id: crypto.randomUUID(),
    ipHash: input.ipHash,
    method: input.method,
    path: input.path,
    action: input.action,
    statusCode: input.statusCode,
    createdAt: new Date().toISOString(),
  });
}

export const formsRoute = new Hono<AppEnv>();

formsRoute.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const form = getFormDefinition(slug);
  if (!form) return fail(c, "表单不存在", 404);

  return ok(c, { form });
});

formsRoute.post(
  "/:slug/submissions",
  zValidator("json", submissionSchema, (result, c) => {
    if (!result.success) return fail(c, "提交内容格式不正确", 400, result.error.message);
  }),
  async (c) => {
    const db = c.get("db");
    const slug = c.req.param("slug");
    const form = getFormDefinition(slug);
    if (!form) return fail(c, "表单不存在", 404);

    const input = c.req.valid("json");
    const action = `submit:${slug}`;
    const path = new URL(c.req.url).pathname;

    // ── 限流（DB 版，5 次 / 60 秒） ──
    const ipHash = await getIpHash(c);
    const limiter = new DbRateLimiter(
      db as unknown as DbRateLimiter extends { db: infer D } ? D : never,
      rateLimitWindows,
      {
        action: rateLimitWindows.action,
        ipHash: rateLimitWindows.ipHash,
        windowStart: rateLimitWindows.windowStart,
        requestCount: rateLimitWindows.requestCount,
      },
    );
    const rate = await limiter.check(`${action}:${ipHash}`, 5, 60_000);
    if (!rate.ok) {
      await writeRequestLog(db, { ipHash, action, statusCode: 429, method: c.req.method, path });
      return fail(c, "提交过于频繁，请稍后再试", 429);
    }

    // ── Turnstile 人机验证 ──
    const turnstile = await verifyTurnstile(c, input.turnstileToken);
    if (!turnstile.ok) {
      await writeRequestLog(db, { ipHash, action, statusCode: 403, method: c.req.method, path });
      return fail(c, turnstile.message || "安全校验失败", 403);
    }

    // ── 业务字段校验 ──
    const business = validateBusinessFields(form, input.fields);
    if (!business.ok) {
      await writeRequestLog(db, { ipHash, action, statusCode: 400, method: c.req.method, path });
      return fail(c, "业务字段校验失败", 400, business.errors);
    }

    // ── 幂等性检查 ──
    const idempotencyKey = readIdempotencyKey(c);
    if (idempotencyKey) {
      const { shouldProceed, cachedResponse } = await checkIdempotency(
        db as unknown as Parameters<typeof checkIdempotency>[0],
        idempotencyKey,
        action,
      );
      if (!shouldProceed && cachedResponse) {
        return c.json(JSON.parse(cachedResponse), 200);
      }
    }

    // ── 写入提交记录 ──
    const submissionId = crypto.randomUUID();
    const response = {
      ok: true,
      submission: {
        id: submissionId,
        formSlug: slug,
        contact: input.contact,
        source: input.source,
      },
    };

    await db.insert(submissions).values({
      id: submissionId,
      formSlug: slug,
      contact: input.contact,
      payloadJson: JSON.stringify(business.cleaned),
      source: input.source,
      idempotencyKey: idempotencyKey || null,
      createdAt: new Date().toISOString(),
    });

    // ── 保存幂等响应 ──
    if (idempotencyKey) {
      await saveIdempotentResponse(
        db as unknown as Parameters<typeof saveIdempotentResponse>[0],
        idempotencyKey,
        action,
        submissionId,
        response,
      );
    }

    await writeRequestLog(db, { ipHash, action, statusCode: 201, method: c.req.method, path });
    return c.json(response, 201);
  },
);
