/**
 * 优惠码服务 — 折扣码查询、报价和消耗。
 *
 * 核心流程：
 * 1. quoteCoupon() — 验证折扣码有效性，计算折扣金额
 * 2. consumeCoupon() — 原子消耗折扣码（usedCount + 1）
 *
 * 折扣码支持两种类型：
 * - fixed: 固定金额减免（discountValue 单位为分）
 * - percent: 百分比减免（discountValue 为 0-100 的整数）
 *
 * 折扣码可绑定商品（product_id 非空）或通用（product_id 为空）。
 * consumeCoupon 使用条件 UPDATE 实现原子消耗，防止并发超用。
 */

import { and, eq, or, sql } from "drizzle-orm";
import type { DbType } from "../db/client";
import { coupons } from "../db/schema";
import { normalizeCode } from "../lib/http";

/** 优惠码报价结果 */
export type CouponQuote = {
  couponCode: string;
  valid: boolean;
  discountCents: number;
  payableCents: number;
  message: string;
};

const couponSelect = {
  code: coupons.code,
  productId: coupons.productId,
  discountType: coupons.discountType,
  discountValue: coupons.discountValue,
  maxUses: coupons.maxUses,
  usedCount: coupons.usedCount,
  active: coupons.active,
  expiresAt: coupons.expiresAt,
};

export async function getCoupon(db: DbType, couponCode?: string) {
  const code = normalizeCode(couponCode);
  if (!code) return null;
  const [coupon] = await db
    .select(couponSelect)
    .from(coupons)
    .where(eq(sql`lower(${coupons.code})`, code))
    .limit(1);
  return coupon || null;
}

export async function quoteCoupon(db: DbType, priceCents: number, productId: string, couponCode?: string): Promise<CouponQuote> {
  const code = normalizeCode(couponCode);
  if (!code) return { couponCode: "", valid: true, discountCents: 0, payableCents: priceCents, message: "无折扣码，按原价购买" };

  // 折扣码查询属于普通 CRUD，使用 Drizzle ORM；折扣码可绑定商品，product_id 为空表示通用码。
  const [coupon] = await db
    .select(couponSelect)
    .from(coupons)
    .where(and(
      eq(sql`lower(${coupons.code})`, code),
      or(eq(coupons.productId, ""), eq(coupons.productId, productId))
    ))
    .limit(1);

  if (!coupon || coupon.active !== 1) {
    return { couponCode: code, valid: false, discountCents: 0, payableCents: priceCents, message: "折扣码不存在或已停用" };
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
    return { couponCode: code, valid: false, discountCents: 0, payableCents: priceCents, message: "折扣码已过期" };
  }
  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    return { couponCode: code, valid: false, discountCents: 0, payableCents: priceCents, message: "折扣码次数已用完" };
  }

  const discountCents = coupon.discountType === "percent"
    ? Math.floor(priceCents * coupon.discountValue / 100)
    : coupon.discountValue;
  const safeDiscount = Math.max(0, Math.min(priceCents, discountCents));
  return {
    couponCode: coupon.code,
    valid: true,
    discountCents: safeDiscount,
    payableCents: priceCents - safeDiscount,
    message: "折扣码可用"
  };
}

export async function consumeCoupon(db: DbType, couponCode: string) {
  const code = normalizeCode(couponCode);
  if (!code) return { success: false, changes: 0 };
  // 原子消耗：只在 active=1、未过期、usedCount < maxUses（或 maxUses=0 表示不限）时消耗，
  // 防止并发重复使用同一个优惠码，也防止过期优惠券被消耗。
  // SQLite 没有 SELECT FOR UPDATE，用条件 UPDATE 代替。
  const nowIso = new Date().toISOString();
  const result = await db
    .update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(and(
      eq(sql`lower(${coupons.code})`, code),
      eq(coupons.active, 1),
      or(
        sql`${coupons.expiresAt} IS NULL`,
        sql`${coupons.expiresAt} >= ${nowIso}`
      ),
      or(
        eq(coupons.maxUses, 0),                          // maxUses=0 不限制
        sql`${coupons.usedCount} < ${coupons.maxUses}`  // 仍有剩余次数
      )
    ))
    .returning({ code: coupons.code });
  // Drizzle libsql: update().returning() 返回匹配行数组；数组长度即影响行数
  return { success: result.length > 0, changes: result.length };
}