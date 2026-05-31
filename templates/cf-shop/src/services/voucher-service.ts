/**
 * 充值码服务 — 预付费凭证的创建、兑付与余额管理。
 *
 * 充值码业务流程：
 * 1. 管理员生成批量充值码（voucher_codes），在第三方收款后交付给买家
 * 2. 买家在站点兑换充值码（兑换后余额存入 user_balances）
 * 3. 买家选购商品时，使用余额支付（绕过外部支付渠道）
 * 4. 余额支付成功后直接走 markPaidAndIssue 发卡
 *
 * 充值码 vs 优惠码（coupons）：
 * - 充值码：预付费凭证，先付款后兑换，存入余额再消费
 * - 优惠码：折扣凭证，下单时直接减免金额
 *
 * 关键设计：
 * - 兑付使用条件 UPDATE（WHERE status='active'），天然防并发重复兑付
 * - 余额增减使用 UPDATE ... WHERE balance_cents >= amount，原子扣减
 * - 所有金额以「分」(cents) 为单位，避免浮点精度问题
 */

import { eq, and, lt, sql } from "drizzle-orm";
import type { DbType } from "../db/client";
import { voucherCodes, userBalances } from "../db/schema";

// ── 兑换结果类型 ──

export type RedeemResult = {
  success: boolean;
  amountCents: number;
  message: string;
};

export type BalanceResult = {
  email: string;
  balanceCents: number;
  totalDepositedCents: number;
  totalSpentCents: number;
};

// ── 通用常量 ──

/** 充值码前缀（带破折号确保可读性） */
export const VOUCHER_CODE_PREFIX = "VCH";

/** 充值码字符集（排除易混淆字符 O/0/I/1） */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ═══════════════════════════════════════════════════════════════════════════════
// 充值码查询
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 查询单条充值码（按 code 精确匹配）。
 * 注意：code 字段使用大写存储，查询时自动转大写。
 */
export async function getVoucher(db: DbType, code: string) {
  const [v] = await db
    .select()
    .from(voucherCodes)
    .where(eq(voucherCodes.code, code.toUpperCase()))
    .limit(1);
  return v || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 充值码兑付（原子操作）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 原子兑付充值码。
 *
 * 使用条件 UPDATE（WHERE status='active'）保证：同一充值码只能被兑付一次，
 * 并发请求下仅一个成功。之后将余额存入或追加到 user_balances 表。
 *
 * @param db   - Drizzle ORM 实例
 * @param code - 充值码（大小写不敏感，自动转大写）
 * @param email - 兑付人邮箱
 * @returns { success, amountCents, message }
 */
export async function redeemVoucher(db: DbType, code: string, email: string): Promise<RedeemResult> {
  const normalizedCode = code.toUpperCase().trim();

  // 查充值码有效性
  const [v] = await db
    .select({
      code: voucherCodes.code,
      amountCents: voucherCodes.amountCents,
      status: voucherCodes.status,
      expiresAt: voucherCodes.expiresAt,
    })
    .from(voucherCodes)
    .where(eq(voucherCodes.code, normalizedCode))
    .limit(1);

  if (!v) {
    return { success: false, amountCents: 0, message: "充值码不存在" };
  }
  if (v.status !== "active") {
    return { success: false, amountCents: 0, message: "充值码已使用或已失效" };
  }
  if (v.expiresAt && new Date(v.expiresAt).getTime() < Date.now()) {
    return { success: false, amountCents: 0, message: "充值码已过期" };
  }

  // 原子兑付：条件 UPDATE，只在 status='active' 时执行
  // 使用原生 SQL 确保原子性（Drizzle 的条件 UPDATE 在 SQLite 下是原子的）
  const nowStr = new Date().toISOString();
  const updated = await db
    .update(voucherCodes)
    .set({
      status: "used",
      usedByEmail: email.trim().toLowerCase(),
      usedAt: nowStr,
    })
    .where(and(
      eq(voucherCodes.code, normalizedCode),
      eq(voucherCodes.status, "active"),
    ))
    .returning({ amountCents: voucherCodes.amountCents });

  if (updated.length === 0) {
    return { success: false, amountCents: 0, message: "充值码已被他人使用" };
  }

  const amountCents = updated[0].amountCents;

  // 存入用户余额（upsert：有则追加，无则创建）
  // 使用原生 SQL 的 ON CONFLICT 语法实现原子 upsert
  await db
    .insert(userBalances)
    .values({
      email: email.trim().toLowerCase(),
      balanceCents: amountCents,
      totalDepositedCents: amountCents,
      totalSpentCents: 0,
      updatedAt: nowStr,
    })
    .onConflictDoUpdate({
      target: userBalances.email,
      set: {
        balanceCents: sql`${userBalances.balanceCents} + ${amountCents}`,
        totalDepositedCents: sql`${userBalances.totalDepositedCents} + ${amountCents}`,
        updatedAt: nowStr,
      },
    });

  return { success: true, amountCents, message: `充值成功，已存入 ${(amountCents / 100).toFixed(2)} 元` };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 用户余额查询 & 管理
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 查询用户余额。
 * 无记录时返回默认零值结构，确保前端始终能拿到 { email, balanceCents, ... }。
 */
export async function getUserBalance(db: DbType, email: string): Promise<BalanceResult> {
  const [b] = await db
    .select()
    .from(userBalances)
    .where(eq(userBalances.email, email.trim().toLowerCase()))
    .limit(1);

  if (!b) {
    return { email: email.trim().toLowerCase(), balanceCents: 0, totalDepositedCents: 0, totalSpentCents: 0 };
  }
  return b;
}

/**
 * 原子扣减用户余额。
 *
 * 使用条件 UPDATE（WHERE email=? AND balance_cents >= ?）保证：
 * - 余额不足时 UPDATE 影响 0 行，不会扣成负数
 * - 并发下仅一个请求能成功扣减
 *
 * @returns 扣减是否成功
 */
export async function deductBalance(db: DbType, email: string, amountCents: number): Promise<boolean> {
  const nowStr = new Date().toISOString();
  const result = await db
    .update(userBalances)
    .set({
      balanceCents: sql`${userBalances.balanceCents} - ${amountCents}`,
      totalSpentCents: sql`${userBalances.totalSpentCents} + ${amountCents}`,
      updatedAt: nowStr,
    })
    .where(and(
      eq(userBalances.email, email.trim().toLowerCase()),
      sql`${userBalances.balanceCents} >= ${amountCents}`,
    ))
    .returning({ email: userBalances.email });

  return result.length > 0;
}

/**
 * 管理员手工为指定邮箱增加余额（退款/补偿/赠送场景）。
 * upsert 模式：用户不存在则创建，已存在则追加。
 */
export async function addBalance(db: DbType, email: string, amountCents: number, note?: string) {
  const nowStr = new Date().toISOString();
  await db
    .insert(userBalances)
    .values({
      email: email.trim().toLowerCase(),
      balanceCents: amountCents,
      totalDepositedCents: amountCents,
      totalSpentCents: 0,
      updatedAt: nowStr,
    })
    .onConflictDoUpdate({
      target: userBalances.email,
      set: {
        balanceCents: sql`${userBalances.balanceCents} + ${amountCents}`,
        totalDepositedCents: sql`${userBalances.totalDepositedCents} + ${amountCents}`,
        updatedAt: nowStr,
      },
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 充值码批量生成（管理员功能）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 生成单个充值码（8 位随机字母数字，排除易混淆字符）。
 * 格式：VCH-A1B2C3D4
 */
function generateSingleCode(batchId: string): string {
  const chars = new Array(8);
  for (let i = 0; i < 8; i++) {
    chars[i] = CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return `VCH-${chars.join("")}`;
}

/**
 * 批量生成充值码。
 *
 * @param db         - Drizzle ORM 实例
 * @param count      - 生成数量
 * @param amountCents - 每张充值码面值（分）
 * @param batchId    - 批次号（用于管理分组，如"202606-001"）
 * @param expiresAt  - 过期时间（ISO 格式），null 表示永不过期
 * @param notes      - 备注信息（如"客户王总-微信付款"）
 * @returns 生成的充值码列表
 */
export async function generateVoucherCodes(
  db: DbType,
  count: number,
  amountCents: number,
  batchId: string,
  expiresAt: string | null,
  notes?: string,
): Promise<string[]> {
  const nowStr = new Date().toISOString();
  const codes: string[] = [];
  const values: Array<{ code: string; amountCents: number; status: string; batchId: string; notes: string; createdAt: string; expiresAt: string | null }> = [];

  // 批量生成，确保无重复（生成时检查已存在，概率极低但保险）
  for (let i = 0; i < count; i++) {
    let code: string;
    let attempts = 0;
    do {
      code = generateSingleCode(batchId);
      attempts++;
      if (attempts > 20) {
        throw new Error("充值码生成碰撞次数过多，请重试");
      }
    } while (codes.includes(code));

    codes.push(code);
    values.push({
      code,
      amountCents,
      status: "active",
      batchId,
      notes: notes || "",
      createdAt: nowStr,
      expiresAt,
    });
  }

  // Drizzle libsql 的批量 insert 语法
  // 注意：libsql 支持一次 insert 多行，使用 db.insert().values([...])
  await db.insert(voucherCodes).values(values);

  return codes;
}

/**
 * 管理员批量作废充值码（revoked）。
 * 使用 IN 子句批量更新。
 */
export async function revokeVoucherCodes(db: DbType, codes: string[]) {
  if (codes.length === 0) return 0;
  const nowStr = new Date().toISOString();
  const result = await db
    .update(voucherCodes)
    .set({ status: "revoked" })
    .where(and(
      eq(voucherCodes.status, "active"),
      // 使用 sql.inArray 替代逐条更新
      sql`${voucherCodes.code} IN (${sql.join(codes.map(c => sql`${c.toUpperCase()}`), sql`, `)})`,
    ))
    .returning({ code: voucherCodes.code });
  return result.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 管理统计
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 充值码统计（管理员 Dashboard 用）。
 */
export async function getVoucherStats(db: DbType) {
  const rows = await db
    .select({
      status: voucherCodes.status,
      count: sql`COUNT(*)`.as<number>(),
      totalAmount: sql`COALESCE(SUM(${voucherCodes.amountCents}), 0)`.as<number>(),
    })
    .from(voucherCodes)
    .groupBy(voucherCodes.status);

  const stats = { active: 0, used: 0, expired: 0, revoked: 0, totalAmount: 0, usedAmount: 0 };
  for (const row of rows) {
    if (row.status === "active") {
      stats.active = row.count;
      stats.totalAmount += Number(row.totalAmount);
    } else if (row.status === "used") {
      stats.used = row.count;
      stats.usedAmount = Number(row.totalAmount);
    } else if (row.status === "expired") {
      stats.expired = row.count;
    } else if (row.status === "revoked") {
      stats.revoked = row.count;
    }
  }
  return stats;
}

/**
 * 查询充值码列表（支持分页、状态过滤）。
 */
export async function listVoucherCodes(
  db: DbType,
  options: { status?: string; batchId?: string; limit?: number; offset?: number },
) {
  const { status, batchId, limit = 50, offset = 0 } = options;
  const conditions = [];

  if (status) conditions.push(eq(voucherCodes.status, status));
  if (batchId) conditions.push(eq(voucherCodes.batchId, batchId));

  const rows = await db
    .select()
    .from(voucherCodes)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${voucherCodes.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  return rows;
}
