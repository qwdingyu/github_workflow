/**
 * 平台管理员鉴权（docs/013 §5.4）。
 *
 * 设计：
 * - Better Auth 的「已登录用户」≠「平台管理员」
 * - MVP 用 env 白名单 ADMIN_EMAILS / ADMIN_USER_IDS，不搬 lottery 多租户 RBAC
 * - 可选 ADMIN_API_KEY：仅 CI/脚本 Header 鉴权，不进浏览器
 * - 写操作必须落 audit（由路由调用 writeAdminAudit）
 */
import type { Context, Next } from "hono";
import type { AppEnv } from "../bindings";
import type { AuthInstance } from "./auth";
import { fail, clientIp } from "./http";
import { getEnv } from "./platform";
import { adminAuditLog } from "../db/schema";
import type { AuthDb } from "../db/client";

export type AdminActor = {
  /** session 用户；API Key 路径为 null */
  userId: string | null;
  email: string | null;
  /** session | api_key */
  via: "session" | "api_key";
  ip: string;
};

function splitCsv(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 解析平台管理员白名单。
 * 未配置任何白名单且无 API Key 时，管理面全部拒绝（安全默认）。
 */
export function resolveAdminPolicy(env: {
  ADMIN_EMAILS?: string;
  ADMIN_USER_IDS?: string;
  ADMIN_API_KEY?: string;
}): {
  emails: Set<string>;
  userIds: Set<string>;
  apiKey: string | null;
  configured: boolean;
} {
  const emails = new Set(splitCsv(env.ADMIN_EMAILS));
  const userIds = new Set(
    (env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const apiKey = env.ADMIN_API_KEY?.trim() || null;
  const configured = emails.size > 0 || userIds.size > 0 || Boolean(apiKey);
  return { emails, userIds, apiKey, configured };
}

function isWhitelisted(
  policy: ReturnType<typeof resolveAdminPolicy>,
  user: { id: string; email: string },
): boolean {
  if (policy.userIds.has(user.id)) return true;
  if (policy.emails.has(user.email.trim().toLowerCase())) return true;
  return false;
}

/**
 * 从请求解析管理员身份。
 * 优先 API Key（脚本），其次 Better Auth session + 白名单。
 */
export async function resolveAdminActor(
  c: Context<AppEnv>,
  auth: AuthInstance,
): Promise<AdminActor | null> {
  const policy = resolveAdminPolicy({
    ADMIN_EMAILS: getEnv(c, "ADMIN_EMAILS") ?? undefined,
    ADMIN_USER_IDS: getEnv(c, "ADMIN_USER_IDS") ?? undefined,
    ADMIN_API_KEY: getEnv(c, "ADMIN_API_KEY") ?? undefined,
  });
  const ip = clientIp(c);

  // ① 脚本 / CI：Bearer 或 X-Admin-Api-Key
  if (policy.apiKey) {
    const headerKey =
      c.req.header("X-Admin-Api-Key") ||
      (c.req.header("Authorization")?.startsWith("Bearer ")
        ? c.req.header("Authorization")!.slice(7).trim()
        : null);
    if (headerKey && timingSafeEqual(headerKey, policy.apiKey)) {
      return { userId: null, email: null, via: "api_key", ip };
    }
  }

  if (!policy.configured) {
    return null;
  }

  // ② 浏览器：Better Auth session cookie
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return null;
    const user = session.user as { id: string; email: string };
    if (!isWhitelisted(policy, user)) return null;
    return {
      userId: user.id,
      email: user.email,
      via: "session",
      ip,
    };
  } catch {
    return null;
  }
}

/** 常量时间比较，降低 API Key 时序侧信道 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/** 从 Context 读管理员策略（Bindings / process.env） */
export function adminPolicyFromContext(c: Context<AppEnv>) {
  return resolveAdminPolicy({
    ADMIN_EMAILS: getEnv(c, "ADMIN_EMAILS") ?? undefined,
    ADMIN_USER_IDS: getEnv(c, "ADMIN_USER_IDS") ?? undefined,
    ADMIN_API_KEY: getEnv(c, "ADMIN_API_KEY") ?? undefined,
  });
}

/**
 * Hono 中间件：要求平台管理员。
 * 未配置白名单 → 503（避免误开「全员可管」）。
 */
export function requirePlatformAdmin(auth: AuthInstance, db?: AuthDb) {
  return async (c: Context<AppEnv>, next: Next) => {
    const policy = adminPolicyFromContext(c);
    if (!policy.configured) {
      return fail(c, "管理功能未启用", 503);
    }
    const actor = await resolveAdminActor(c, auth);
    if (!actor) {
      // 登录失败审计：记录尝试者 IP
      if (db) {
        db.insert(adminAuditLog).values({
          id: crypto.randomUUID(),
          action: "admin.login_blocked",
          targetType: "admin",
          meta: JSON.stringify({ ip: clientIp(c) }),
          ip: "",
          createdAt: new Date(),
        }).catch(() => {});
      }
      return fail(c, "需要平台管理员身份", 401);
    }
    // 登录成功审计
    if (db) {
      db.insert(adminAuditLog).values({
        id: crypto.randomUUID(),
        action: "admin.login",
        targetType: "admin",
        targetId: actor.userId || "",
        meta: JSON.stringify({ ip: actor.ip, via: actor.via, email: actor.email || null }),
        ip: "",
        createdAt: new Date(),
      }).catch(() => {});
    }
    c.set("adminActor", actor);
    await next();
  };
}

/**
 * P0-1：拦截 Better Auth 插件开放的 client 注册路径。
 * 任意登录用户默认可调 create-client；生产必须仅平台管理员或走 /api/admin/clients。
 * 未配置管理员时直接 503，避免「全员可发 client」。
 */
export function blockOpenClientRegistration(auth: AuthInstance) {
  return async (c: Context<AppEnv>, next: Next) => {
    const path = new URL(c.req.url).pathname;
    const isOpenRegister =
      path.endsWith("/oauth2/create-client") ||
      path.endsWith("/oauth2/register") ||
      path.includes("/oauth2/register") ||
      // 动态注册关闭后仍可能暴露的路径
      path.endsWith("/oauth2/client/register");

    if (!isOpenRegister) {
      await next();
      return;
    }

    const policy = adminPolicyFromContext(c);
    if (!policy.configured) {
      return c.json(
        {
          error: "access_denied",
          error_description:
            "client 注册已收口：请配置 ADMIN_* 后使用 /api/admin/clients",
        },
        503,
      );
    }

    const actor = await resolveAdminActor(c, auth);
    if (!actor) {
      return c.json(
        {
          error: "access_denied",
          error_description:
            "仅平台管理员可注册 OAuth client；请使用 /api/admin/clients 或管理员会话",
        },
        403,
      );
    }

    // 已是管理员：放行 BA 原路径（兼容旧脚本 + 已登录管理员）
    c.set("adminActor", actor);
    await next();
  };
}
