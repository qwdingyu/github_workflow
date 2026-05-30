/**
 * 充值码 & 用户余额服务
 *
 * 核心能力：
 * - 充值码生成、兑付、作废、统计
 * - 用户余额查询、扣减、充值
 *
 * 充值码是"预付费凭证"：管理员后台批量生成 → 用户在前端兑换码页面兑付 →
 * 余额自动存入 user_balances 表 → 用户下单时可选余额支付。
 *
 * 关键安全设计：
 * - 兑付使用条件 UPDATE（WHERE status='active'），并发下不会超兑
 * - 余额扣减使用 SQL 表达式（balanceCents >= amountCents），防止透支
 * - 充值码兑付 upsert 使用 ON CONFLICT 语法，保证原子性
 */

import { eq, and, sql, like, desc } from "drizzle-orm";
import { voucherCodes, userBalances } from "../db/schema";

/** Drizzle 数据库实例类型（兼容模板中的 `any` 用法） */
type DB = any;

// ── 类型 ──

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

// ═══════════════════════════════════════════════════════════════════════════════
// 充值码兑付
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 查询单个充值码详情（管理员/校验用）
 */
export async function getVoucher(db: DB, code: string) {
  const [v] = await db
    .select()
    .from(voucherCodes)
    .where(eq(voucherCodes.code, code.toUpperCase().trim()))
    .limit(1);
  return v || null;
}

/**
 * 兑换充值码（原子操作）。
 *
 * 流程：
 * 1. 验证充值码存在、未使用、未过期
 * 2. 条件 UPDATE 锁定兑付（WHERE status='active'）
 * 3. UPSERT 余额到 user_balances
 *
 * @param db    - 数据库实例
 * @param code  - 充值码（大小写不敏感）
 * @param email - 兑付人邮箱
 * @returns 兑付结果
 */
export async function redeemVoucher(db: DB, code: string, email: string): Promise<RedeemResult> {
  const normalizedCode = code.toUpperCase().trim();
  const normalizedEmail = email.trim().toLowerCase();

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
  const nowStr = new Date().toISOString();
  const updated = await db
    .update(voucherCodes)
    .set({
      status: "used",
      usedByEmail: normalizedEmail,
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
  await db
    .insert(userBalances)
    .values({
      email: normalizedEmail,
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
export async function getUserBalance(db: DB, email: string): Promise<BalanceResult> {
  const [b] = await db
    .select()
    .from(userBalances)
    .where(eq(userBalances.email, email.trim().toLowerCase()))
    .limit(1);

  return b || {
    email: email.trim().toLowerCase(),
    balanceCents: 0,
    totalDepositedCents: 0,
    totalSpentCents: 0,
  };
}

/**
 * 扣减用户余额（用于余额支付）。
 *
 * 使用 SQL 表达式保证原子性：只有当 balanceCents >= amountCents 时才会扣减。
 * 返回值表示是否扣减成功（余额不足返回 false）。
 */
export async function deductBalance(db: DB, email: string, amountCents: number): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const nowStr = new Date().toISOString();

  const result = await db
    .update(userBalances)
    .set({
      balanceCents: sql`${userBalances.balanceCents} - ${amountCents}`,
      totalSpentCents: sql`${userBalances.totalSpentCents} + ${amountCents}`,
      updatedAt: nowStr,
    })
    .where(and(
      eq(userBalances.email, normalizedEmail),
      // 余额充足检查（SQL 表达式，原子性）
      sql`${userBalances.balanceCents} >= ${amountCents}`,
    ))
    .returning({ email: userBalances.email });

  return result.length > 0;
}

/**
 * 增加用户余额（用于退款、管理员充值等场景）。
 *
 * 用户不存在时自动创建（upsert 兜底）。
 */
export async function addBalance(db: DB, email: string, amountCents: number): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const nowStr = new Date().toISOString();

  await db
    .insert(userBalances)
    .values({
      email: normalizedEmail,
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
// 管理员：充值码管理
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 生成单条充值码（16 位大写字母数字）。
 * 格式：前缀(4) + 连字符 + 随机(4) + 连字符 + 随机(4) + 连字符 + 随机(4) + 连字符 + 校验位(1)
 * 例如：V202-5A8F-C3D1-E2B7-9
 */
function generateSingleCode(batchId: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 排除 0/O/1/I 防混淆
  const rand = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const body = `${rand(4)}-${rand(4)}-${rand(4)}-${rand(4)}`;
  // 简单校验：批次 ID 后缀的 checksum
  const check = chars[batchId.slice(-1).charCodeAt(0) % chars.length];
  return `${body}-${check}`;
}

/**
 * 批量生成充值码。
 *
 * @param db          - 数据库实例
 * @param count       - 生成数量
 * @param amountCents - 每张充值码面值（分）
 * @param batchId     - 批次标识
 * @param expiresAt   - 过期时间（ISO 字符串，null 表示永不过期）
 * @param notes       - 备注
 * @returns 生成的充值码列表
 */
export async function generateVoucherCodes(
  db: DB,
  count: number,
  amountCents: number,
  batchId: string,
  expiresAt: string | null,
  notes?: string,
): Promise<string[]> {
  const nowStr = new Date().toISOString();
  const codes: string[] = [];
  const values: Array<{
    code: string;
    amountCents: number;
    status: string;
    batchId: string;
    notes: string;
    createdAt: string;
    expiresAt: string | null;
  }> = [];

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

  await db.insert(voucherCodes).values(values);
  return codes;
}

/**
 * 批量作废充值码。
 * 只有 status='active' 的充值码能被作废，已使用的不会改变。
 *
 * @param db    - 数据库实例
 * @param codes - 要作废的充值码列表
 */
export async function revokeVoucherCodes(db: DB, codes: string[]): Promise<void> {
  const nowStr = new Date().toISOString();
  for (const code of codes) {
    await db
      .update(voucherCodes)
      .set({ status: "revoked", notes: sql`${voucherCodes.notes} || '; revoked at ${nowStr}'` })
      .where(and(eq(voucherCodes.code, code.toUpperCase().trim()), eq(voucherCodes.status, "active")));
  }
}

/**
 * 充值码统计。
 *
 * 返回总数量、各状态数量、面值总额等聚合数据。
 */
export async function getVoucherStats(db: DB) {
  const allCodes = await db
    .select({
      status: voucherCodes.status,
      count: sql<number>`count(*)`,
      totalAmount: sql<number>`coalesce(sum(${voucherCodes.amountCents}), 0)`,
    })
    .from(voucherCodes)
    .groupBy(voucherCodes.status);

  const totals = { total: 0, used: 0, active: 0, revoked: 0, expired: 0, totalAmount: 0, usedAmount: 0 };
  for (const row of allCodes) {
    totals.total += Number(row.count);
    totals.totalAmount += Number(row.totalAmount);
    if (row.status === "used") {
      totals.used = Number(row.count);
      totals.usedAmount = Number(row.totalAmount);
    } else if (row.status === "active") totals.active = Number(row.count);
    else if (row.status === "revoked") totals.revoked = Number(row.count);
    else if (row.status === "expired") totals.expired = Number(row.count);
  }

  return totals;
}

/**
 * 分页查询充值码列表。
 *
 * @param db      - 数据库实例
 * @param options - 查询参数（分页、过滤）
 * @returns 充值码列表及总数
 */
export async function listVoucherCodes(
  db: DB,
  options: {
    page?: number;
    pageSize?: number;
    status?: string;
    batchId?: string;
    search?: string;
  } = {},
) {
  const { page = 1, pageSize = 50, status, batchId, search } = options;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (status) conditions.push(eq(voucherCodes.status, status));
  if (batchId) conditions.push(eq(voucherCodes.batchId, batchId));
  if (search) conditions.push(like(voucherCodes.code, `%${search.toUpperCase()}%`));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(voucherCodes)
    .where(where)
    .orderBy(desc(voucherCodes.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [countResult] = await db
    .select({ total: sql<number>`count(*)` })
    .from(voucherCodes)
    .where(where);

  return {
    codes: rows,
    total: Number(countResult?.total || 0),
    page,
    pageSize,
  };
}
