/**
 * SEO Guardian 用户认证中间件
 *
 * 使用 Drizzle ORM 查询，HTTP 响应使用 cf-core 的 ok/fail。
 */

import { eq, asc, desc, like, and, count, isNotNull } from "drizzle-orm";
import { users, sites } from "../db/schema";
import type { DB } from "../db/schema";
import { fail } from "@eforge/cf-core/http";

export interface AuthUser {
  id: string;
  email: string;
  plan: string;
  token: string;
  trialEndsAt: string | null;
}

function getDb<E extends { Bindings: { DB: DB } }>(c: import("hono").Context<E>): DB {
  return c.env.DB;
}

/** 从 x-auth-token header 验证用户 */
export async function checkAuth<E extends { Bindings: { DB: DB } }>(c: import("hono").Context<E>): Promise<AuthUser | null> {
  const token = c.req.header("x-auth-token");
  if (!token) return null;
  const [row] = await getDb(c).select().from(users).where(eq(users.token, token)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    plan: row.plan,
    token: row.token,
    trialEndsAt: row.trialEndsAt,
  };
}

/** 401 响应 */
export function unauthorized<E extends { Bindings: { DB: DB } }>(c: import("hono").Context<E>, reason = "missing token") {
  return fail(c, `Unauthorized — ${reason}`, 401);
}

/** 套餐等级检查 */
const PLAN_TIER: Record<string, number> = { free: 0, starter: 1, pro: 2, agency: 3 };

export function checkPlan(user: AuthUser, minPlan: string): boolean {
  return (PLAN_TIER[user.plan] ?? 0) >= (PLAN_TIER[minPlan] ?? 0);
}

/** 验证站点归属 */
export async function verifySite<E extends { Bindings: { DB: DB } }>(c: import("hono").Context<E>, siteId: string, userId: string) {
  const [site] = await getDb(c)
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId)))
    .limit(1);
  return site || null;
}

export async function verifySiteOr404<E extends { Bindings: { DB: DB } }>(c: import("hono").Context<E>, siteId: string, userId: string) {
  const site = await verifySite(c, siteId, userId);
  if (!site) return null;
  return site;
}

/** 站点搜索（按名称或 URL） */
export async function searchSites<E extends { Bindings: { DB: DB } }>(
  c: import("hono").Context<E>,
  userId: string,
  q: string,
  offset: number,
  limit: number,
) {
  const search = `%${q}%`;
  const rows = await getDb(c)
    .select()
    .from(sites)
    .where(and(eq(sites.userId, userId), and(like(sites.name, search), like(sites.url, search))))
    .orderBy(asc(sites.name))
    .offset(offset)
    .limit(limit);
  const [{ total }] = await getDb(c)
    .select({ total: count() })
    .from(sites)
    .where(and(eq(sites.userId, userId), and(like(sites.name, search), like(sites.url, search))));
  return { sites: rows, total: total ?? 0 };
}

/** 获取用户信息（含站点数和最近扫描） */
export async function getUserWithStats<E extends { Bindings: { DB: DB } }>(c: import("hono").Context<E>, token: string) {
  const [user] = await getDb(c).select().from(users).where(eq(users.token, token)).limit(1);
  if (!user) return null;

  const [{ siteCount }] = await getDb(c)
    .select({ siteCount: count() })
    .from(sites)
    .where(eq(sites.userId, user.id));

  const [latestScan] = await getDb(c)
    .select({ siteId: sites.id, siteName: sites.name, siteUrl: sites.url, score: scans.score, scannedAt: scans.scannedAt })
    .from(scans)
    .innerJoin(sites, eq(scans.siteId, sites.id))
    .where(eq(sites.userId, user.id))
    .orderBy(desc(scans.scannedAt))
    .limit(1);

  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    siteCount: siteCount ?? 0,
    latestScan: latestScan || null,
  };
}
