/**
 * 平台级「强制下线」：session + OAuth refresh/access 一并处理（docs/020 R1）。
 *
 * 仅删 Better Auth session 不足以表达运营期望的止血；
 * refresh 表有 revoked 字段，access 无 revoked → 删除未过期行。
 */
import { and, count, eq, isNull } from "drizzle-orm";
import {
  oauthAccessToken,
  oauthRefreshToken,
  session,
} from "../db/schema";
import type { AuthDb } from "../db/client";

export type RevokeUserAccessResult = {
  sessionsDeleted: number;
  refreshRevoked: number;
  accessDeleted: number;
};

/** 将 user 的 refresh 标记 revoked（未撤销的） */
async function revokeRefreshTokensForUser(
  db: AuthDb,
  userId: string,
): Promise<number> {
  const now = new Date();
  const result = await db
    .update(oauthRefreshToken)
    .set({ revoked: now })
    .where(
      and(eq(oauthRefreshToken.userId, userId), isNull(oauthRefreshToken.revoked)),
    );
  return result.rowsAffected ?? 0;
}

/** 删除该 user 的 access token（短生命周期；无 revoked 列） */
async function deleteAccessTokensForUser(
  db: AuthDb,
  userId: string,
): Promise<number> {
  const result = await db
    .delete(oauthAccessToken)
    .where(eq(oauthAccessToken.userId, userId));
  return result.rowsAffected ?? 0;
}

async function deleteSessionsForUser(
  db: AuthDb,
  userId: string,
): Promise<number> {
  const result = await db.delete(session).where(eq(session.userId, userId));
  return result.rowsAffected ?? 0;
}

/**
 * 完整下线某一用户：浏览器 session + refresh 撤销 + access 删除。
 */
export async function revokeAllAccessForUser(
  db: AuthDb,
  userId: string,
): Promise<RevokeUserAccessResult> {
  const sessionsDeleted = await deleteSessionsForUser(db, userId);
  const refreshRevoked = await revokeRefreshTokensForUser(db, userId);
  const accessDeleted = await deleteAccessTokensForUser(db, userId);
  return { sessionsDeleted, refreshRevoked, accessDeleted };
}

/**
 * 仅下线单条 session，并尽量清理挂在该 sessionId 上的 OAuth 令牌。
 */
export async function revokeOneSession(
  db: AuthDb,
  sessionId: string,
): Promise<
  | { ok: true; userId: string; refreshRevoked: number; accessDeleted: number }
  | { ok: false }
> {
  const [row] = await db
    .select()
    .from(session)
    .where(eq(session.id, sessionId))
    .limit(1);
  if (!row) return { ok: false };

  const now = new Date();
  const refreshResult = await db
    .update(oauthRefreshToken)
    .set({ revoked: now })
    .where(
      and(
        eq(oauthRefreshToken.sessionId, sessionId),
        isNull(oauthRefreshToken.revoked),
      ),
    );
  const accessResult = await db
    .delete(oauthAccessToken)
    .where(eq(oauthAccessToken.sessionId, sessionId));

  await db.delete(session).where(eq(session.id, sessionId));

  return {
    ok: true,
    userId: row.userId,
    refreshRevoked: refreshResult.rowsAffected ?? 0,
    accessDeleted: accessResult.rowsAffected ?? 0,
  };
}

/** 测试/诊断：统计用户未撤销 refresh 数 */
export async function countActiveRefreshForUser(
  db: AuthDb,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(oauthRefreshToken)
    .where(
      and(eq(oauthRefreshToken.userId, userId), isNull(oauthRefreshToken.revoked)),
    );
  return row?.n ?? 0;
}

/** 测试/诊断：统计用户 access 数 */
export async function countAccessForUser(
  db: AuthDb,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(oauthAccessToken)
    .where(eq(oauthAccessToken.userId, userId));
  return row?.n ?? 0;
}
