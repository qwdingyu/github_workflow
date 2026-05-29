/**
 * 用户认证服务
 *
 * 封装注册/登录/JWT 签发逻辑。
 * 使用 @eforge/cf-core 的 hashPassword/verifyPassword/signJwt。
 */

import { hashPassword, verifyPassword } from "@eforge/cf-core/auth/password";
import { signJwt } from "@eforge/cf-core/auth/jwt";
import { generateUUID } from "@eforge/cf-core/crypto";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { authConfig } from "../config";
import type { AppEnv } from "../bindings";
import type { Context } from "hono";

// ── 类型定义 ─────────────────────────────────────────────────────────────────

interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

interface RegisterResult {
  ok: boolean;
  userId?: string;
  error?: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface LoginResult {
  ok: boolean;
  userId?: string;
  email?: string;
  displayName?: string;
  role?: string;
  error?: string;
  status?: number;
}

// ── 认证服务实现 ─────────────────────────────────────────────────────────────

function createAuthService() {
  return {
    /**
     * 注册新用户
     *
     * 1. 检查邮箱是否已注册
     * 2. 密码哈希（PBKDF2-HMAC-SHA256）
     * 3. 写入数据库
     */
    async register(c: Context<AppEnv>, input: RegisterInput): Promise<RegisterResult> {
      const db = c.get("db");

      // 检查邮箱是否已存在
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existing.length > 0) {
        return { ok: false, error: "该邮箱已注册" };
      }

      // 哈希密码
      const { hash, salt } = await hashPassword(input.password);

      // 创建用户
      const userId = generateUUID();
      const now = new Date().toISOString();

      await db.insert(users).values({
        id: userId,
        email: input.email,
        passwordHash: hash,
        passwordSalt: salt,
        displayName: input.displayName,
        role: "user",
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      });

      return { ok: true, userId };
    },

    /**
     * 用户登录
     *
     * 1. 查找用户
     * 2. 验证密码（恒定时间比较）
     * 3. 更新最后登录时间
     */
    async login(c: Context<AppEnv>, input: LoginInput): Promise<LoginResult> {
      const db = c.get("db");

      // 查找用户
      const result = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (result.length === 0) {
        return { ok: false, error: "邮箱或密码错误", status: 401 };
      }

      const user = result[0];

      // 检查用户是否被禁用
      if (!user.enabled) {
        return { ok: false, error: "账户已被禁用，请联系管理员", status: 403 };
      }

      // 验证密码
      const isValid = await verifyPassword(input.password, user.passwordHash, user.passwordSalt);
      if (!isValid) {
        return { ok: false, error: "邮箱或密码错误", status: 401 };
      }

      // 更新最后登录时间
      await db
        .update(users)
        .set({ lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(eq(users.id, user.id));

      return {
        ok: true,
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      };
    },

    /**
     * 签发 JWT Token
     */
    async signToken(c: Context<AppEnv>, userId: string, email: string): Promise<string> {
      return signJwt(userId, email, c.env.JWT_SECRET, authConfig.jwtExpiry);
    },

    /**
     * 根据 ID 获取用户信息
     */
    async getUserById(c: Context<AppEnv>, userId: string) {
      const db = c.get("db");

      const result = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      return result.length > 0 ? result[0] : null;
    },
  };
}

/** 认证服务单例 */
export const authService = createAuthService();
