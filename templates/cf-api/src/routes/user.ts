/**
 * 公开用户端路由（无需 API Key 认证）
 *
 * 通过凭证 ID 直接操作，适用于终端用户场景（如验证链接回调）。
 * 安全措施：
 * - IP 限流（防止暴力枚举）
 * - Turnstile 人机验证（可选）
 * - 凭证 ID 本身为 UUID，不可预测
 */

import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { ok, fail, safeJsonBody } from "@eforge/cf-core/http";
import { getIpHash, verifyTurnstile } from "@eforge/cf-core/security";
import { MemoryRateLimiter } from "@eforge/cf-core/rate-limit";
import { logger } from "@eforge/cf-core/logger";
import { TokenService } from "../services/token-service";

const user = new Hono<AppEnv>();

// ── IP 限流（每分钟 30 次） ──
const rateLimiter = new MemoryRateLimiter({
  maxRequests: 30,
  windowMs: 60_000,
});

user.use("*", async (c, next) => {
  const ipHash = await getIpHash(c);
  const result = rateLimiter.check(ipHash);
  if (!result.ok) {
    return fail(c, "请求过于频繁", 429, {
      retryAfterMs: result.resetMs,
    });
  }
  await next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /user/token/:id — 公开查询凭证状态
// ═══════════════════════════════════════════════════════════════════════════════

user.get("/token/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");
  const svc = new TokenService(db, c.env);

  const token = await svc.getById(id);
  if (!token) return fail(c, "凭证不存在", 404);

  // 公开端只返回安全字段（不泄露加密载荷）
  return ok(c, {
    id: token.id,
    serviceType: token.serviceType,
    status: token.status,
    result: token.resultJson,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /user/token/:id/submit — 终端用户提交数据
// ═══════════════════════════════════════════════════════════════════════════════

user.post("/token/:id/submit", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");
  const svc = new TokenService(db, c.env);

  // Turnstile 人机验证
  const body = await safeJsonBody(c);
  const data = (body || {}) as Record<string, unknown>;
  const turnstileToken = data.turnstileToken as string | undefined;

  const turnstile = await verifyTurnstile(c, turnstileToken);
  if (!turnstile.ok) {
    return fail(c, turnstile.message || "人机验证失败", 403);
  }

  try {
    const result = await svc.submitUserData(id, data);
    logger.info("user.submit", { tokenId: id });
    return ok(c, { result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "提交失败";
    return fail(c, msg, 400);
  }
});

export { user };
