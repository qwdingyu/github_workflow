/**
 * 信任域运营扩展（docs/029）。
 *
 * 信任域 = env 部署锚 ∪ DB 运营扩展（trusted_origin 表，Admin 热增删）。
 * purpose 维度隔离：cors（业务 RP 跨域）/ admin（管理写请求 CSRF）。
 * 解析时只取 enabled=true 的行；baseURL origin 由调用方/解析层强制并入，防自锁。
 * origin 一律经 normalizeOrigin 规范化后入库与比对（拒绝路径/query/凭据/非回环 http）。
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { trustedOrigin } from "../db/schema";
import type { AuthDb } from "../db/client";

export const TRUSTED_ORIGIN_PURPOSES = ["cors", "admin"] as const;
export type TrustedOriginPurpose = (typeof TRUSTED_ORIGIN_PURPOSES)[number];

export function isTrustedOriginPurpose(v: unknown): v is TrustedOriginPurpose {
  return (
    typeof v === "string" &&
    (TRUSTED_ORIGIN_PURPOSES as readonly string[]).includes(v)
  );
}

/**
 * 规范化 origin：仅 scheme://host[:port]。
 * 规则：https 或 http（http 仅限 localhost/127.0.0.1 回环，防明文信任域被中间人利用）；
 * 拒绝凭据、路径、query、hash。URL.origin 自动小写 host、省略默认端口。
 */
export function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  // origin 级信任域：不允许路径（除根）、query、hash
  if (u.pathname !== "/" && u.pathname !== "") return null;
  if (u.search || u.hash) return null;
  if (u.protocol === "http:") {
    // URL.hostname 对 IPv6 回环返回 "[::1]"（带方括号）
    const host = u.hostname.toLowerCase();
    if (
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      host !== "[::1]"
    ) {
      return null;
    }
  }
  return u.origin;
}

export type TrustedOriginRow = {
  id: string;
  origin: string;
  purpose: TrustedOriginPurpose;
  enabled: boolean;
  createdByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRow(r: (typeof trustedOrigin.$inferSelect)): TrustedOriginRow {
  return {
    id: r.id,
    origin: r.origin,
    purpose: r.purpose as TrustedOriginPurpose,
    enabled: Boolean(r.enabled),
    createdByEmail: r.createdByEmail,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** DB 内全部信任域（含停用行，供管理列表展示） */
export async function listTrustedOrigins(
  db: AuthDb,
  opts: { purpose?: TrustedOriginPurpose } = {},
): Promise<TrustedOriginRow[]> {
  const rows = await db
    .select()
    .from(trustedOrigin)
    .where(
      opts.purpose
        ? eq(trustedOrigin.purpose, opts.purpose)
        : undefined,
    )
    .orderBy(
      asc(trustedOrigin.purpose),
      desc(trustedOrigin.createdAt),
    );
  return rows.map(toRow);
}

/**
 * 解析生效信任域：env 部署锚（已规范化）∪ DB 启用行。
 * baseOrigin（如 BETTER_AUTH_URL origin）由调用方传入并入，保证同源永不被锁。
 */
export async function resolveTrustedOrigins(
  db: AuthDb,
  purpose: TrustedOriginPurpose,
  envList: string[],
  baseOrigin?: string,
): Promise<string[]> {
  const set = new Set<string>();
  for (const raw of envList) {
    const norm = normalizeOrigin(raw);
    if (norm) set.add(norm);
  }
  if (baseOrigin) {
    const norm = normalizeOrigin(baseOrigin);
    if (norm) set.add(norm);
  }
  const rows = await db
    .select({ origin: trustedOrigin.origin })
    .from(trustedOrigin)
    .where(
      and(
        eq(trustedOrigin.purpose, purpose),
        eq(trustedOrigin.enabled, true),
      ),
    );
  for (const r of rows) set.add(r.origin);
  return [...set];
}

export type AddTrustedOriginInput = {
  origin: string;
  purpose: TrustedOriginPurpose;
  actorEmail: string | null;
};

export type AddTrustedOriginResult =
  | { ok: true; row: TrustedOriginRow }
  | { ok: false; reason: "invalid_origin" | "invalid_purpose" | "duplicate" };

/** 创建信任域：校验 + 规范化；同 purpose 下 origin 唯一 */
export async function addTrustedOrigin(
  db: AuthDb,
  input: AddTrustedOriginInput,
): Promise<AddTrustedOriginResult> {
  const norm = normalizeOrigin(input.origin);
  if (!norm) return { ok: false, reason: "invalid_origin" };
  if (!isTrustedOriginPurpose(input.purpose)) {
    return { ok: false, reason: "invalid_purpose" };
  }
  const existing = await db
    .select({ id: trustedOrigin.id })
    .from(trustedOrigin)
    .where(
      and(
        eq(trustedOrigin.purpose, input.purpose),
        eq(trustedOrigin.origin, norm),
      ),
    )
    .limit(1);
  if (existing.length > 0) return { ok: false, reason: "duplicate" };

  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(trustedOrigin).values({
    id,
    origin: norm,
    purpose: input.purpose,
    enabled: true,
    createdByEmail: input.actorEmail,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, row: toRow((await getTrustedOriginById(db, id))!) };
}

async function getTrustedOriginById(
  db: AuthDb,
  id: string,
): Promise<(typeof trustedOrigin.$inferSelect) | null> {
  const [row] = await db
    .select()
    .from(trustedOrigin)
    .where(eq(trustedOrigin.id, id))
    .limit(1);
  return row ?? null;
}

export type SetTrustedOriginEnabledResult =
  | { ok: true; row: TrustedOriginRow }
  | { ok: false; reason: "not_found" };

/** 软启停：enabled 翻转；origin 不可改（改 = 删 + 建，防绕过审计） */
export async function setTrustedOriginEnabled(
  db: AuthDb,
  id: string,
  enabled: boolean,
): Promise<SetTrustedOriginEnabledResult> {
  const existing = await getTrustedOriginById(db, id);
  if (!existing) return { ok: false, reason: "not_found" };
  await db
    .update(trustedOrigin)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(trustedOrigin.id, id));
  return { ok: true, row: toRow((await getTrustedOriginById(db, id))!) };
}

export type RemoveTrustedOriginResult =
  | { ok: true; origin: string }
  | { ok: false; reason: "not_found" };

/** 硬删行：删除后该 origin 立即失去信任（env 锚不受影响） */
export async function removeTrustedOrigin(
  db: AuthDb,
  id: string,
): Promise<RemoveTrustedOriginResult> {
  const existing = await getTrustedOriginById(db, id);
  if (!existing) return { ok: false, reason: "not_found" };
  await db.delete(trustedOrigin).where(eq(trustedOrigin.id, id));
  return { ok: true, origin: existing.origin };
}
