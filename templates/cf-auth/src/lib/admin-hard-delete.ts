/**
 * 平台 Admin 硬删除（清理测试垃圾 / 误建数据）。
 *
 * 防灾难原则（docs/020 扩展，docs/024）：
 * - 仅按显式 id 删除，禁止无 where 整表删
 * - client：先清该 clientId 下 token/consent，再删 client 行
 * - user：先完整下线，再清相关 blocklist，再删 user（FK cascade session/account/…）
 * - 永不删除 admin_audit_log
 * - 禁止删除白名单管理员与操作者本人
 */
import { and, eq } from "drizzle-orm";
import {
  account,
  authBlocklist,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  session,
  user,
} from "../db/schema";
import type { AuthDb } from "../db/client";
import { normalizeEmail } from "./blocklist";
import {
  revokeAllAccessForUser,
  type RevokeUserAccessResult,
} from "./session-revoke";

export type HardDeleteClientResult =
  | {
      ok: true;
      clientId: string;
      name: string | null;
      refreshDeleted: number;
      accessDeleted: number;
      consentDeleted: number;
    }
  | { ok: false; reason: "not_found" };

export type HardDeleteUserResult =
  | {
      ok: true;
      userId: string;
      email: string;
      revoke: RevokeUserAccessResult;
      blocklistRemoved: number;
    }
  | {
      ok: false;
      reason: "not_found" | "protected_admin" | "cannot_delete_self";
    };

export type UserDeleteGuards = {
  /** ADMIN_USER_IDS */
  protectedUserIds: Set<string>;
  /** ADMIN_EMAILS（小写） */
  protectedEmails: Set<string>;
  /** 当前 session 管理员 id；API Key 为 null */
  actorUserId: string | null;
};

/** 批量硬删除上限（严于启停 20） */
export const HARD_DELETE_BATCH_MAX = 10;

/** 请求体必须带 confirm === "DELETE" */
export function isDeleteConfirmed(body: { confirm?: unknown } | null | undefined): boolean {
  return body?.confirm === "DELETE";
}

/**
 * 删除 OAuth client 及其令牌/同意记录。
 * clientId 为公开 client_id（与 token 表 clientId 列一致）。
 */
export async function hardDeleteOAuthClient(
  db: AuthDb,
  clientId: string,
): Promise<HardDeleteClientResult> {
  const id = clientId.trim();
  if (!id) return { ok: false, reason: "not_found" };

  const [row] = await db
    .select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, id))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };

  // token 表无 FK 到 oauthClient → 必须先手清，否则孤儿令牌
  const refresh = await db
    .delete(oauthRefreshToken)
    .where(eq(oauthRefreshToken.clientId, id));
  const access = await db
    .delete(oauthAccessToken)
    .where(eq(oauthAccessToken.clientId, id));
  const consent = await db
    .delete(oauthConsent)
    .where(eq(oauthConsent.clientId, id));

  await db.delete(oauthClient).where(eq(oauthClient.clientId, id));

  return {
    ok: true,
    clientId: row.clientId,
    name: row.name,
    refreshDeleted: refresh.rowsAffected ?? 0,
    accessDeleted: access.rowsAffected ?? 0,
    consentDeleted: consent.rowsAffected ?? 0,
  };
}

/**
 * 物理删除用户：完整下线 → 相关黑名单 → 删 user 行。
 * session/account/oauth*（按 userId）依赖 DB ON DELETE CASCADE。
 */
export async function hardDeleteUser(
  db: AuthDb,
  userId: string,
  guards: UserDeleteGuards,
): Promise<HardDeleteUserResult> {
  const id = userId.trim();
  if (!id) return { ok: false, reason: "not_found" };

  const [u] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  if (!u) return { ok: false, reason: "not_found" };

  if (guards.actorUserId && u.id === guards.actorUserId) {
    return { ok: false, reason: "cannot_delete_self" };
  }
  if (guards.protectedUserIds.has(u.id)) {
    return { ok: false, reason: "protected_admin" };
  }
  const emailNorm = normalizeEmail(u.email);
  if (guards.protectedEmails.has(emailNorm)) {
    return { ok: false, reason: "protected_admin" };
  }

  // 先完整下线（session + refresh 标记 + access 删）
  const revoke = await revokeAllAccessForUser(db, id);

  // 不依赖 PRAGMA foreign_keys：显式清剩余关联（含已 revoked 的 refresh）
  await db.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, id));
  await db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, id));
  await db.delete(oauthConsent).where(eq(oauthConsent.userId, id));
  await db.delete(session).where(eq(session.userId, id));
  await db.delete(account).where(eq(account.userId, id));
  // oauthClient.userId → SET NULL 语义
  await db
    .update(oauthClient)
    .set({ userId: null, updatedAt: new Date() })
    .where(eq(oauthClient.userId, id));

  // 清理该用户相关黑名单条目（user_id + 精确 email）；不动 email_domain
  const blUser = await db
    .delete(authBlocklist)
    .where(
      and(eq(authBlocklist.type, "user_id"), eq(authBlocklist.value, id)),
    );
  const blEmail = await db
    .delete(authBlocklist)
    .where(
      and(eq(authBlocklist.type, "email"), eq(authBlocklist.value, emailNorm)),
    );
  const blocklistRemoved =
    (blUser.rowsAffected ?? 0) + (blEmail.rowsAffected ?? 0);

  await db.delete(user).where(eq(user.id, id));

  return {
    ok: true,
    userId: id,
    email: u.email,
    revoke,
    blocklistRemoved,
  };
}

export function hardDeleteUserFailMessage(
  reason: Exclude<HardDeleteUserResult, { ok: true }>["reason"],
): string {
  switch (reason) {
    case "not_found":
      return "用户不存在";
    case "protected_admin":
      return "禁止删除管理员名单中的账号";
    case "cannot_delete_self":
      return "禁止删除当前登录的管理员本人";
    default:
      return "删除失败";
  }
}
