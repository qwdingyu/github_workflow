/**
 * 凭证管理路由（需 API Key 认证）
 *
 * 所有端点都需要有效的 API Key（通过 createApiKeyAuth 中间件验证）。
 * API Key 上下文注入到 c.get("apiKeyContext")。
 *
 * 端点列表:
 *   POST /tokens/generate  — 生成新凭证
 *   GET  /tokens/:id       — 查询凭证详情
 *   POST /tokens/:id/use   — 使用凭证（提交到渠道）
 *   GET  /tokens/:id/check — 查询处理结果
 *   POST /tokens/:id/release — 释放凭证
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../bindings";
import { ok, fail, safeJsonBody } from "@eforge/cf-core/http";
import { getIpHash } from "@eforge/cf-core/security";
import { logger } from "@eforge/cf-core/logger";
import { createApiKeyAuth } from "@eforge/cf-core/middleware";
import { TokenService } from "../services/token-service";
import { SERVICE_TYPES } from "../config";

const tokens = new Hono<AppEnv>();

// ── API Key 认证中间件 ──
tokens.use("*", createApiKeyAuth({ prefix: "cfapi_", required: true }));

// ═══════════════════════════════════════════════════════════════════════════════
// POST /generate — 生成新凭证
// ═══════════════════════════════════════════════════════════════════════════════

const generateSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES),
  /** 业务参数（按服务类型不同而不同） */
  params: z.record(z.unknown()).optional(),
  /** 幂等键（可选，防重复生成） */
  idempotencyKey: z.string().max(128).optional(),
});

tokens.post("/generate", async (c) => {
  const body = await safeJsonBody(c);
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, "参数错误", 400, { issues: parsed.error.issues });
  }

  const { serviceType, params, idempotencyKey } = parsed.data;
  const apiKeyCtx = c.get("apiKeyContext")!;
  const ipHash = await getIpHash(c);
  const db = c.get("db");

  const svc = new TokenService(db, c.env);

  try {
    const token = await svc.generate({
      serviceType,
      params: params || {},
      apiKeyId: apiKeyCtx.id,
      ipHash,
      idempotencyKey,
    });

    logger.resourceAction("generate", token.id, {
      serviceType,
      apiKeyId: apiKeyCtx.id,
    });

    return ok(c, { token }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "生成失败";
    logger.error("token.generate", { error: msg, serviceType });
    return fail(c, msg, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /:id — 查询凭证详情
// ═══════════════════════════════════════════════════════════════════════════════

tokens.get("/:id", async (c) => {
  const id = c.req.param("id");
  const apiKeyCtx = c.get("apiKeyContext")!;
  const db = c.get("db");
  const svc = new TokenService(db, c.env);

  const token = await svc.getById(id);
  if (!token) return fail(c, "凭证不存在", 404);

  // 安全校验：只能查看自己 API Key 创建的凭证
  if (token.apiKeyId !== apiKeyCtx.id) {
    return fail(c, "无权访问", 403);
  }

  return ok(c, { token });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:id/use — 使用凭证（提交到渠道处理）
// ═══════════════════════════════════════════════════════════════════════════════

tokens.post("/:id/use", async (c) => {
  const id = c.req.param("id");
  const apiKeyCtx = c.get("apiKeyContext")!;
  const ipHash = await getIpHash(c);
  const db = c.get("db");
  const svc = new TokenService(db, c.env);

  const body = await safeJsonBody(c);
  const useParams = (body as Record<string, unknown>)?.params as Record<string, unknown> | undefined;

  try {
    const result = await svc.use(id, {
      apiKeyId: apiKeyCtx.id,
      ipHash,
      params: useParams || {},
    });

    logger.resourceAction("use", id, {
      status: result.status,
      channel: result.channelId,
    });

    return ok(c, { token: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "使用失败";
    logger.error("token.use", { error: msg, tokenId: id });

    // 区分客户端错误和服务端错误
    if (msg.includes("不存在") || msg.includes("状态") || msg.includes("无权")) {
      return fail(c, msg, 400);
    }
    return fail(c, msg, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /:id/check — 查询处理结果
// ═══════════════════════════════════════════════════════════════════════════════

tokens.get("/:id/check", async (c) => {
  const id = c.req.param("id");
  const apiKeyCtx = c.get("apiKeyContext")!;
  const db = c.get("db");
  const svc = new TokenService(db, c.env);

  const token = await svc.getById(id);
  if (!token) return fail(c, "凭证不存在", 404);
  if (token.apiKeyId !== apiKeyCtx.id) return fail(c, "无权访问", 403);

  // 如果还在处理中，尝试从渠道拉取最新状态
  if (token.status === "active" || token.status === "pending") {
    try {
      const updated = await svc.checkResult(id);
      return ok(c, { token: updated });
    } catch {
      // 拉取失败时返回当前状态
      return ok(c, { token, pending: true });
    }
  }

  return ok(c, { token });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:id/release — 释放凭证
// ═══════════════════════════════════════════════════════════════════════════════

tokens.post("/:id/release", async (c) => {
  const id = c.req.param("id");
  const apiKeyCtx = c.get("apiKeyContext")!;
  const db = c.get("db");
  const svc = new TokenService(db, c.env);

  try {
    const token = await svc.release(id, apiKeyCtx.id);
    logger.resourceAction("release", id, {});
    return ok(c, { token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "释放失败";
    if (msg.includes("不存在") || msg.includes("状态") || msg.includes("无权")) {
      return fail(c, msg, 400);
    }
    return fail(c, msg, 500);
  }
});

export { tokens };
