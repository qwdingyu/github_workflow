/**
 * 用户认证路由
 *
 * POST /api/auth/register — 注册
 * POST /api/auth/login    — 登录
 * GET  /api/auth/me       — 获取当前用户信息
 */

import { Hono } from "hono";
import { ok, fail } from "@eforge/cf-core/http";
import { extractJwt, verifyJwt } from "@eforge/cf-core/auth/jwt";
import { z } from "zod";
import type { AppEnv } from "../bindings";
import { authService } from "../services/auth-service";
import { authConfig } from "../config";

export const authRoutes = new Hono<AppEnv>();

// ── 请求体校验 Schema ─────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少 8 个字符"),
  displayName: z.string().max(50).optional(),
  turnstileToken: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(1, "请输入密码"),
  turnstileToken: z.string().optional(),
});

// ── 认证中间件（提取并验证 JWT） ─────────────────────────────────────────────

/**
 * 从请求中提取并验证 JWT，注入用户信息到 Context。
 * Token 无效时返回 401。
 */
async function requireAuth(c: Parameters<Parameters<typeof authRoutes.get>[1]>[0], next: () => Promise<void>) {
  const token = extractJwt(c);
  if (!token) {
    return fail(c, "未登录", 401);
  }

  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload) {
    return fail(c, "Token 已过期或无效", 401);
  }

  // 注入用户信息到 Context
  c.set("userId", payload.sub);
  c.set("userEmail", payload.email);

  await next();
}

// ── POST /api/auth/register — 注册 ──────────────────────────────────────────

authRoutes.post("/register", async (c) => {
  // 检查是否开放注册
  if (!authConfig.openRegistration) {
    return fail(c, "注册已关闭，请联系管理员", 403);
  }

  // 解析并校验请求体
  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, parsed.error.errors[0]?.message || "参数错误");
  }

  const { email, password, displayName } = parsed.data;

  // 调用认证服务注册
  const result = await authService.register(c, {
    email: email.toLowerCase().trim(),
    password,
    displayName: displayName || "",
  });

  if (!result.ok) {
    return fail(c, result.error, 409);
  }

  // 签发 JWT
  const token = await authService.signToken(c, result.userId, email.toLowerCase().trim());

  return ok(c, {
    token,
    user: {
      id: result.userId,
      email: email.toLowerCase().trim(),
      displayName: displayName || "",
    },
  }, 201);
});

// ── POST /api/auth/login — 登录 ──────────────────────────────────────────────

authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, parsed.error.errors[0]?.message || "参数错误");
  }

  const { email, password } = parsed.data;

  // 调用认证服务登录
  const result = await authService.login(c, {
    email: email.toLowerCase().trim(),
    password,
  });

  if (!result.ok) {
    return fail(c, result.error, result.status || 401);
  }

  // 签发 JWT
  const token = await authService.signToken(c, result.userId!, result.email!);

  return ok(c, {
    token,
    user: {
      id: result.userId,
      email: result.email,
      displayName: result.displayName,
      role: result.role,
    },
  });
});

// ── GET /api/auth/me — 获取当前用户 ──────────────────────────────────────────

authRoutes.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId")!;
  const user = await authService.getUserById(c, userId);

  if (!user) {
    return fail(c, "用户不存在", 404);
  }

  return ok(c, {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    },
  });
});
