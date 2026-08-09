/**
 * 平台级登录/授权黑名单（docs/020 §5）。
 *
 * 与 lottery 租户「参与黑名单」无关：本表无 tenantId，
 * 在 session 创建前与 Admin 封禁路径强制生效。
 */
import { and, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { authBlocklist, user } from "../db/schema";
import type { AuthDb } from "../db/client";
import {
  revokeAllAccessForUser,
  type RevokeUserAccessResult,
} from "./session-revoke";
import { canonicalEmail } from "@usethink/cf-core";

export const BLOCKLIST_TYPES = ["email", "user_id", "email_domain"] as const;
export type BlocklistType = (typeof BLOCKLIST_TYPES)[number];

export const BLOCKED_USER_MESSAGE = "账号不可用，请联系平台管理员";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeBlockValue(type: BlocklistType, value: string): string {
  const v = value.trim();
  if (type === "email" || type === "email_domain") return v.toLowerCase();
  return v;
}

function emailDomain(email: string): string | null {
  const n = normalizeEmail(email);
  const at = n.lastIndexOf("@");
  if (at <= 0 || at === n.length - 1) return null;
  return n.slice(at + 1);
}

function notExpiredClause(now: Date) {
  return or(isNull(authBlocklist.expiresAt), gt(authBlocklist.expiresAt, now));
}

/** 按 userId / email / 邮箱域判断是否命中未过期黑名单 */
export async function findBlocklistHit(
  db: AuthDb,
  input: { userId?: string | null; email?: string | null },
): Promise<{ id: string; type: string; value: string } | null> {
  const now = new Date();
  const clauses = [];

  if (input.userId) {
    clauses.push(
      and(
        eq(authBlocklist.type, "user_id"),
        eq(authBlocklist.value, input.userId),
        notExpiredClause(now),
      ),
    );
  }

  if (input.email) {
    const email = normalizeEmail(input.email);
    clauses.push(
      and(
        eq(authBlocklist.type, "email"),
        eq(authBlocklist.value, email),
        notExpiredClause(now),
      ),
    );
    // Gmail 去点号/加号别名防绕过（docs/091 P1-12）：
    // canonicalEmail 将 u.ser+tag@gmail.com → user@gmail.com，
    // 防止被封用户用别名重新注册；同时保留原 normalizeEmail 路径兼容旧 blocklist 数据。
    const canonical = canonicalEmail(input.email);
    if (canonical !== email) {
      clauses.push(
        and(
          eq(authBlocklist.type, "email"),
          eq(authBlocklist.value, canonical),
          notExpiredClause(now),
        ),
      );
    }
    const domain = emailDomain(email);
    if (domain) {
      clauses.push(
        and(
          eq(authBlocklist.type, "email_domain"),
          eq(authBlocklist.value, domain),
          notExpiredClause(now),
        ),
      );
    }
  }

  if (clauses.length === 0) return null;

  const [row] = await db
    .select({
      id: authBlocklist.id,
      type: authBlocklist.type,
      value: authBlocklist.value,
    })
    .from(authBlocklist)
    .where(or(...clauses))
    .limit(1);

  return row ?? null;
}

export async function isBlocked(
  db: AuthDb,
  input: { userId?: string | null; email?: string | null },
): Promise<boolean> {
  return (await findBlocklistHit(db, input)) != null;
}

export type AddBlocklistInput = {
  type: BlocklistType;
  value: string;
  reason?: string | null;
  expiresAt?: Date | null;
  createdByUserId?: string | null;
  createdByEmail?: string | null;
};

export type AddBlocklistResult = {
  entry: typeof authBlocklist.$inferSelect;
  created: boolean;
  revoke: RevokeUserAccessResult | null;
  matchedUserIds: string[];
};

function isValidEmail(email: string): boolean {
  // 运营录入校验：简单 RFC 子集，与 lottery isValidEmail 精神一致
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 写入黑名单；若能解析到已有 user，则级联完整下线。
 * 同 type+value 已存在未过期记录 → 更新 reason/expires，不重复插行。
 */
export async function addToBlocklist(
  db: AuthDb,
  input: AddBlocklistInput,
): Promise<AddBlocklistResult> {
  if (!BLOCKLIST_TYPES.includes(input.type)) {
    throw new Error("invalid_blocklist_type");
  }
  const value = normalizeBlockValue(input.type, input.value);
  if (!value) throw new Error("empty_blocklist_value");
  if (input.type === "email" && !isValidEmail(value)) {
    throw new Error("invalid_email");
  }
  if (input.type === "email_domain") {
    // 禁止 LIKE 通配符进入 value：级联解析与命中检测均按「精确域名」
    if (
      value.includes("@") ||
      value.includes(" ") ||
      value.includes("%") ||
      value.includes("_") ||
      !value.includes(".")
    ) {
      throw new Error("invalid_email_domain");
    }
  }

  const now = new Date();
  const [existing] = await db
    .select()
    .from(authBlocklist)
    .where(and(eq(authBlocklist.type, input.type), eq(authBlocklist.value, value)))
    .limit(1);

  let entry: typeof authBlocklist.$inferSelect;
  let created: boolean;

  if (existing) {
    await db
      .update(authBlocklist)
      .set({
        reason: input.reason?.trim() || existing.reason,
        expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
        createdByUserId: input.createdByUserId ?? existing.createdByUserId,
        createdByEmail: input.createdByEmail ?? existing.createdByEmail,
      })
      .where(eq(authBlocklist.id, existing.id));
    const [updated] = await db
      .select()
      .from(authBlocklist)
      .where(eq(authBlocklist.id, existing.id))
      .limit(1);
    if (!updated) throw new Error("blocklist_update_missing");
    entry = updated;
    created = false;
  } else {
    const id = crypto.randomUUID();
    await db.insert(authBlocklist).values({
      id,
      type: input.type,
      value,
      reason: input.reason?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
      createdByEmail: input.createdByEmail ?? null,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
    });
    const [inserted] = await db
      .select()
      .from(authBlocklist)
      .where(eq(authBlocklist.id, id))
      .limit(1);
    if (!inserted) throw new Error("blocklist_insert_missing");
    entry = inserted;
    created = true;
  }

  // 去重后再下线，避免 user_id+email 双匹配时同一用户 revoke 两次
  const matchedUserIds = [
    ...new Set(await resolveUsersForBlock(db, input.type, value)),
  ];
  let revoke: RevokeUserAccessResult | null = null;
  for (const uid of matchedUserIds) {
    const r = await revokeAllAccessForUser(db, uid);
    if (!revoke) revoke = r;
    else {
      revoke = {
        sessionsDeleted: revoke.sessionsDeleted + r.sessionsDeleted,
        refreshRevoked: revoke.refreshRevoked + r.refreshRevoked,
        accessDeleted: revoke.accessDeleted + r.accessDeleted,
      };
    }
  }

  return { entry, created, revoke, matchedUserIds };
}

async function resolveUsersForBlock(
  db: AuthDb,
  type: BlocklistType,
  value: string,
): Promise<string[]> {
  if (type === "user_id") return [value];
  if (type === "email") {
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${value}`);
    return rows.map((r) => r.id);
  }
  // email_domain：精确匹配 @ 后域名（禁止 LIKE 通配，与 findBlocklistHit 的 eq 一致）
  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user);
  const domain = value.toLowerCase();
  return rows
    .filter((r) => {
      const at = r.email.lastIndexOf("@");
      if (at < 0) return false;
      return r.email.slice(at + 1).toLowerCase() === domain;
    })
    .map((r) => r.id);
}

export async function removeFromBlocklist(
  db: AuthDb,
  id: string,
): Promise<boolean> {
  const result = await db.delete(authBlocklist).where(eq(authBlocklist.id, id));
  return (result.rowsAffected ?? 0) > 0;
}

export async function listBlocklist(
  db: AuthDb,
  opts: { limit: number; offset: number; type?: string },
) {
  const where = opts.type
    ? eq(authBlocklist.type, opts.type)
    : undefined;
  const rows = await db
    .select()
    .from(authBlocklist)
    .where(where)
    .orderBy(desc(authBlocklist.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const [totalRow] = await db
    .select({ n: count() })
    .from(authBlocklist)
    .where(where);
  return { items: rows, total: totalRow?.n ?? 0 };
}
