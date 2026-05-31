/**
 * admin-service.ts — Admin 专用数据访问层
 *
 * 职责：
 *   1. 封装 admin.ts 中所有数据库查询
 *   2. 函数签名只接受 DbType + 纯参数，不依赖 Hono Context
 *   3. 不处理 HTTP 响应、不写审计日志（这些留在路由层）
 *
 * 全面使用 Drizzle ORM，不再依赖原始 SQL。
 * 仅在 ORM 不支持的场景（UNION ALL、UPDATE...RETURNING 原子操作）使用 db.run(sql)。
 */

import type { DbType } from "../db/client";
import {
  products,
  cards,
  cardBatches,
  orders,
  coupons,
  emailLogs,
  campaigns,
  referralCodes,
  referralEvents,
  requestLogs,
  adminAuditLogs,
  systemConfig,
} from "../db/schema";
import { eq, and, or, like, sql, asc, desc, count, ne, inArray, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { availableStockCount } from "../db/expressions";

// ── 类型定义 ──────────────────────────────────────

export type AdminSummary = {
  ordersToday: number;
  issuedToday: number;
  availableCards: number;
  pendingOrders: number;
};

export type OrderFilter = {
  status: string;
  productId: string;
  q: string;
  page: number;
  limit: number;
};

export type OrderListResult = {
  total: number;
  orders: Record<string, unknown>[];
};

export type ExportParams = {
  status: string;
  productId: string;
  q: string;
  cursor: string;
  limit: number;
};

export type CardFilter = {
  productId: string;
  batchId: string;
  status: string;
  page: number;
  limit: number;
};

export type CouponFilter = {
  productId: string;
  status: string;    // 'active', 'inactive', or '' (all)
  search: string;     // code 模糊搜索
  page: number;
  limit: number;
};

export type CreateProductInput = {
  id: string;
  title: string;
  description: string;
  salesCopy: string;
  coverUrl: string;
  tagsJson: string;
  priceCents: number;
  currency: string;
  issueMode: string;
  active: boolean;
  category: string;
  sortOrder: number;
};

export type UpdateProductInput = Partial<CreateProductInput>;

export type CreateCouponInput = {
  productId?: string;
  code: string;
  discountType: "fixed" | "percent";
  discountValue: number;
  maxUses: number;
  active: boolean;
  expiresAt?: string | null;
};

export type GenerateCouponInput = {
  productId: string;
  discountType: "fixed" | "percent";
  discountValue: number;
  maxUses: number;
  active: boolean;
  expiresAt?: string | null;
  prefix?: string;
  count?: number;
};

export type UpdateCouponInput = Partial<Omit<CreateCouponInput, "code">>;

export type ImportCardsInput = {
  productId: string;
  batchName: string;
  cards: { accountLabel: string; deliverySecret: string; deliveryNote?: string }[];
};

export type ImportCardsResult = {
  batchId: string;
  imported: number;
};

// ── 工具函数 ──────────────────────────────────────

export function createCouponCode(prefix = "") {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  const body = Array.from(arr, (v) => chars[v % chars.length]).join("");
  return prefix ? `${prefix}-${body}` : body;
}

// ── Drizzle 动态 WHERE 构建辅助 ──
// 用于可选过滤条件：空字符串表示不过滤

function buildOrderWhere(filter: OrderFilter) {
  const conditions = [eq(products.id, products.id)]; // 永真条件，确保 JOIN
  if (filter.status) conditions.push(eq(orders.status, filter.status));
  if (filter.productId) conditions.push(eq(orders.productId, filter.productId));
  if (filter.q) {
    conditions.push(
      or(
        like(orders.orderNo, `%${filter.q}%`),
        like(orders.buyerContact, `%${filter.q}%`),
        like(orders.buyerEmail, `%${filter.q}%`)
      )!
    );
  }
  return and(...conditions);
}

function buildCardWhere(filter: CardFilter) {
  const conditions = [];
  if (filter.productId) conditions.push(eq(cards.productId, filter.productId));
  if (filter.batchId) conditions.push(eq(cards.batchId, filter.batchId));
  if (filter.status) conditions.push(eq(cards.status, filter.status));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function buildCouponWhere(filter: CouponFilter) {
  const conditions = [];
  if (filter.productId) conditions.push(eq(coupons.productId, filter.productId));
  if (filter.status === "active") conditions.push(eq(coupons.active, 1));
  else if (filter.status === "inactive") conditions.push(eq(coupons.active, 0));
  if (filter.search) conditions.push(like(coupons.code, `%${filter.search}%`));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ── 订单/卡密 SELECT 列定义（复用） ──

const orderSelectFields = {
  id: orders.id,
  orderNo: sql<string>`COALESCE(${orders.orderNo}, ${orders.id})`,
  productId: orders.productId,
  productTitle: products.title,
  buyerContact: orders.buyerContact,
  buyerEmail: orders.buyerEmail,
  amountCents: orders.amountCents,
  discountCents: orders.discountCents,
  currency: orders.currency,
  status: orders.status,
  issueMode: orders.issueMode,
  paymentMethod: orders.paymentMethod,
  paymentRef: orders.paymentRef,
  issuedCardId: orders.issuedCardId,
  campaignCode: orders.campaignCode,
  referralCode: orders.referralCode,
  couponCode: orders.couponCode,
  createdAt: orders.createdAt,
  paidAt: orders.paidAt,
  issuedAt: orders.issuedAt,
};

// ── G1: 概览 ──────────────────────────────────────

export async function getAdminSummary(
  db: DbType,
): Promise<AdminSummary | null> {
  const [ordersTodayRow] = await db
    .select({ count: count() })
    .from(orders)
    .where(sql`date(${orders.createdAt}) = date('now')`);

  const [issuedTodayRow] = await db
    .select({ count: count() })
    .from(orders)
    .where(and(
      eq(orders.status, "issued"),
      sql`date(${orders.issuedAt}) = date('now')`
    ));

  const [availableCardsRow] = await db
    .select({ count: count() })
    .from(cards)
    .where(eq(cards.status, "available"));

  const [pendingOrdersRow] = await db
    .select({ count: count() })
    .from(orders)
    .where(or(eq(orders.status, "pending"), eq(orders.status, "paid")));

  return {
    ordersToday: ordersTodayRow?.count ?? 0,
    issuedToday: issuedTodayRow?.count ?? 0,
    availableCards: availableCardsRow?.count ?? 0,
    pendingOrders: pendingOrdersRow?.count ?? 0,
  };
}

// ── G2: 订单列表 ──────────────────────────────────

export async function getOrderList(
  db: DbType,
  filter: OrderFilter,
): Promise<OrderListResult> {
  const { page, limit } = filter;
  const offset = (page - 1) * limit;

  const where = buildOrderWhere(filter);

  // COUNT 查询
  const [countRow] = await db
    .select({ count: count() })
    .from(orders)
    .innerJoin(products, eq(products.id, orders.productId))
    .where(where);
  const total = countRow?.count ?? 0;

  // 数据查询
  const results = await db
    .select(orderSelectFields)
    .from(orders)
    .innerJoin(products, eq(products.id, orders.productId))
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);

  return { total, orders: results as unknown as Record<string, unknown>[] };
}

// ── G3: 订单导出 ──────────────────────────────────

export async function exportOrders(
  db: DbType,
  params: ExportParams,
): Promise<{ rows: Record<string, unknown>[]; nextCursor: string; hasMore: boolean }> {
  const { status, productId, q, cursor, limit } = params;

  // 构建动态 WHERE
  const conditions: (SQL<unknown> | undefined)[] = [];
  if (status) conditions.push(eq(orders.status, status));
  if (productId) conditions.push(eq(orders.productId, productId));
  if (q) {
    conditions.push(
      or(
        like(orders.orderNo, `%${q}%`),
        like(orders.buyerContact, `%${q}%`)
      )!
    );
  }
  if (cursor) {
    // cursor 格式: "createdAt::id"，解析后精确游标分页
    const parts = cursor.split("::");
    const cursorDate = parts[0];
    const cursorId = parts[1] || "";
    conditions.push(
      or(
        lt(orders.createdAt, cursorDate),
        and(
          eq(orders.createdAt, cursorDate),
          lt(orders.id, cursorId)
        )
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // 多取一条判断 hasMore
  const rows = await db
    .select(orderSelectFields)
    .from(orders)
    .innerJoin(products, eq(products.id, orders.productId))
    .where(where)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  const lastRow = resultRows[resultRows.length - 1];
  const nextCursor = hasMore && lastRow ? `${lastRow.createdAt || ""}::${lastRow.id || ""}` : "";

  return { rows: resultRows as unknown as Record<string, unknown>[], nextCursor, hasMore };
}

// ── G4: 订单详情 ──────────────────────────────────

export async function getOrderDetail(
  db: DbType,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({
      id: orders.id,
      orderNo: sql<string>`COALESCE(${orders.orderNo}, ${orders.id})`,
      productId: orders.productId,
      buyerContact: orders.buyerContact,
      buyerEmail: orders.buyerEmail,
      amountCents: orders.amountCents,
      discountCents: orders.discountCents,
      currency: orders.currency,
      status: orders.status,
      issueMode: orders.issueMode,
      paymentMethod: orders.paymentMethod,
      paymentRef: orders.paymentRef,
      issuedCardId: orders.issuedCardId,
      couponCode: orders.couponCode,
      campaignCode: orders.campaignCode,
      referralCode: orders.referralCode,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      issuedAt: orders.issuedAt,
      ipHash: orders.ipHash,
      userAgent: orders.userAgent,
      expiresAt: orders.expiresAt,
      productTitle: products.title,
      accountLabel: cards.accountLabel,
      deliverySecret: cards.deliverySecret,
      deliveryNote: cards.deliveryNote,
    })
    .from(orders)
    .innerJoin(products, eq(products.id, orders.productId))
    .leftJoin(cards, eq(cards.id, orders.issuedCardId))
    .where(eq(orders.id, id));

  return (rows[0] as Record<string, unknown>) || null;
}

// ── G5: 标记付款 ── 不抽取，只调 markPaidAndIssue ──

// ── G6: 导入卡密 ──────────────────────────────────

export async function importCards(
  db: DbType,
  input: ImportCardsInput,
): Promise<ImportCardsResult> {
  // 检查商品是否存在
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  if (!product) {
    throw new Error("商品不存在");
  }

  const batchId = crypto.randomUUID();

  // 先收集卡密数据（含 trim 清洗），计算有效数量
  const cardRows: { id: string; label: string; secret: string; note: string }[] = [];
  for (const card of input.cards) {
    const label = card.accountLabel.trim();
    const secret = card.deliverySecret.trim();
    const note = (card.deliveryNote || "").trim();
    if (!label || !secret) continue; // 跳过空标签/空密码的脏数据
    cardRows.push({ id: crypto.randomUUID(), label, secret, note });
  }

  if (cardRows.length === 0) {
    throw new Error("没有有效的卡密数据，请检查账号和密码是否填写完整");
  }

  // 批次记录
  await db.insert(cardBatches).values({
    id: batchId,
    productId: input.productId,
    name: input.batchName,
    totalCount: cardRows.length,
    createdAt: new Date().toISOString(),
  });

  // 批量插入卡密
  if (cardRows.length > 0) {
    await db.insert(cards).values(
      cardRows.map((row) => ({
        id: row.id,
        productId: input.productId,
        batchId,
        accountLabel: row.label,
        deliverySecret: row.secret,
        deliveryNote: row.note,
        status: "available" as const,
        createdAt: new Date().toISOString(),
      }))
    );
  }

  return { batchId, imported: cardRows.length };
}

// ── G7: 卡密列表 ──────────────────────────────────

export async function getCardList(
  db: DbType,
  filter: CardFilter,
): Promise<{ total: number; results: Record<string, unknown>[] }> {
  const { page, limit } = filter;
  const offset = (page - 1) * limit;
  const where = buildCardWhere(filter);

  // COUNT 查询
  const [countRow] = await db
    .select({ count: count() })
    .from(cards)
    .where(where);
  const total = countRow?.count ?? 0;

  // 数据查询
  const results = await db
    .select({
      id: cards.id,
      productId: cards.productId,
      batchId: cards.batchId,
      accountLabel: cards.accountLabel,
      deliverySecret: cards.deliverySecret,
      deliveryNote: cards.deliveryNote,
      status: cards.status,
      issuedOrderId: cards.issuedOrderId,
      createdAt: cards.createdAt,
      batchName: cardBatches.name,
    })
    .from(cards)
    .leftJoin(cardBatches, eq(cardBatches.id, cards.batchId))
    .where(where)
    .orderBy(desc(cards.createdAt))
    .limit(limit)
    .offset(offset);

  return { total, results: results as unknown as Record<string, unknown>[] };
}

// ── G8: 卡密操作（启用/禁用）───────────────────────

/** 合法卡密状态转换表：key=当前状态，value=允许转换到的状态列表 */
const VALID_CARD_TRANSITIONS: Record<string, string[]> = {
  available: ["locked", "disabled"],
  locked: ["available", "issued", "disabled"],
  issued: ["disabled"],
  disabled: ["available"],
};

export async function updateCardStatus(
  db: DbType,
  id: string,
  status: string,
): Promise<{ id: string; status: string } | null> {
  // 先读取当前状态
  const [card] = await db
    .select({ id: cards.id, status: cards.status })
    .from(cards)
    .where(eq(cards.id, id))
    .limit(1);
  if (!card) return null;

  // 校验状态转换合法性，防止误把已发卡密改回 available 造成重复发卡
  const allowed = VALID_CARD_TRANSITIONS[card.status];
  if (!allowed || !allowed.includes(status)) {
    throw new Error(`不允许从 ${card.status} 转换到 ${status}`);
  }

  // 原子更新：WHERE 中包含当前状态，防止并发修改导致非法转换
  const result = await db
    .update(cards)
    .set({ status })
    .where(and(eq(cards.id, id), eq(cards.status, card.status)));

  if (result.rowsAffected === 0) {
    throw new Error("卡密状态已被其他操作修改，请刷新重试");
  }

  return { id, status };
}

export async function batchDisableCards(
  db: DbType,
  ids: string[],
  status: string,
): Promise<{ updated: number }> {
  // 校验目标状态合法性，防止批量操作误把已发卡密改回 available 造成重复发卡
  if (!Object.keys(VALID_CARD_TRANSITIONS).some((k) => VALID_CARD_TRANSITIONS[k].includes(status))) {
    throw new Error(`非法目标状态: ${status}`);
  }
  // 兜底：WHERE 条件排除 issued 卡密，即使路由层校验遗漏也不允许变更已发卡密状态
  const result = await db
    .update(cards)
    .set({ status })
    .where(and(inArray(cards.id, ids), ne(cards.status, "issued")));
  return { updated: result.rowsAffected ?? ids.length };
}

// ── G9: 批次列表 ──────────────────────────────────

export async function getBatchList(
  db: DbType,
  productId: string,
): Promise<Record<string, unknown>[]> {
  const where = productId ? eq(cardBatches.productId, productId) : undefined;

  const results = await db
    .select({
      id: cardBatches.id,
      productId: cardBatches.productId,
      productTitle: products.title,
      name: cardBatches.name,
      totalCount: cardBatches.totalCount,
      createdAt: cardBatches.createdAt,
      availableCount: sql<number>`(SELECT COUNT(*) FROM cards WHERE batch_id = ${cardBatches.id} AND status = 'available')`,
      issuedCount: sql<number>`(SELECT COUNT(*) FROM cards WHERE batch_id = ${cardBatches.id} AND status = 'issued')`,
      disabledCount: sql<number>`(SELECT COUNT(*) FROM cards WHERE batch_id = ${cardBatches.id} AND status = 'disabled')`,
    })
    .from(cardBatches)
    .leftJoin(products, eq(products.id, cardBatches.productId))
    .where(where)
    .orderBy(desc(cardBatches.createdAt));

  return results as unknown as Record<string, unknown>[];
}

// ── G10: 折扣码列表 ──────────────────────────────

export async function getCouponList(
  db: DbType,
  filter: CouponFilter,
): Promise<{ total: number; results: Record<string, unknown>[] }> {
  const { page, limit } = filter;
  const offset = (page - 1) * limit;
  const where = buildCouponWhere(filter);

  // COUNT 查询
  const [countRow] = await db
    .select({ count: count() })
    .from(coupons)
    .where(where);
  const total = countRow?.count ?? 0;

  // 数据查询
  const rows = await db
    .select({
      code: coupons.code,
      productId: coupons.productId,
      productTitle: products.title,
      discountType: coupons.discountType,
      discountValue: coupons.discountValue,
      maxUses: coupons.maxUses,
      usedCount: coupons.usedCount,
      active: sql<number>`CASE WHEN ${coupons.active} = 1 THEN 1 ELSE 0 END`,
      expiresAt: coupons.expiresAt,
      createdAt: coupons.createdAt,
    })
    .from(coupons)
    .leftJoin(products, eq(products.id, coupons.productId))
    .where(where)
    .orderBy(desc(coupons.createdAt))
    .limit(limit)
    .offset(offset);

  // 将 active 字段从 0/1 转为 boolean，方便前端直接使用
  const results = rows.map((r) => ({
    ...r,
    active: r.active === 1,
  })) as unknown as Record<string, unknown>[];

  return { total, results: results as unknown as Record<string, unknown>[] };
}

// ── G11: 商品列表（管理端含下架）────────────────────

export async function getAdminProducts(
  db: DbType,
): Promise<Record<string, unknown>[]> {
  const results = await db
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      description: products.description,
      priceCents: products.priceCents,
      currency: products.currency,
      issueMode: products.issueMode,
      active: products.active,
      sortOrder: products.sortOrder,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      salesCopy: products.salesCopy,
      coverUrl: products.coverUrl,
      tagsJson: products.tagsJson,
      category: products.category,
      stock: availableStockCount,
    })
    .from(products)
    .leftJoin(cards, eq(cards.productId, products.id))
    .groupBy(products.id)
    .orderBy(products.sortOrder, products.createdAt);

  return results.map((r) => ({
    ...r,
    active: r.active === 1,
  })) as unknown as Record<string, unknown>[];
}

export async function checkProductExists(
  db: DbType,
  id: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  return !!existing;
}

export async function createProduct(
  db: DbType,
  input: CreateProductInput,
): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: input.id,
    slug: input.id,
    title: input.title,
    description: input.description,
    salesCopy: input.salesCopy,
    coverUrl: input.coverUrl,
    tagsJson: input.tagsJson,
    priceCents: input.priceCents,
    currency: input.currency,
    fulfillmentMode: "card",
    issueMode: input.issueMode,
    active: input.active ? 1 : 0,
    category: input.category || "",
    sortOrder: input.sortOrder,
    createdAt: now,
    updatedAt: now,
  });
}

// ── G13: 更新商品 ──────────────────────────────────

export async function updateProduct(
  db: DbType,
  id: string,
  input: UpdateProductInput,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  // Drizzle ORM: 只 set 非undefined的字段
  const setValues: Record<string, unknown> = { updatedAt };
  if (input.title !== undefined) setValues["title"] = input.title;
  if (input.description !== undefined) setValues["description"] = input.description;
  if (input.salesCopy !== undefined) setValues["salesCopy"] = input.salesCopy;
  if (input.coverUrl !== undefined) setValues["coverUrl"] = input.coverUrl;
  if (input.tagsJson !== undefined) setValues["tagsJson"] = input.tagsJson;
  if (input.priceCents !== undefined) setValues["priceCents"] = input.priceCents;
  if (input.currency !== undefined) setValues["currency"] = input.currency;
  if (input.issueMode !== undefined) setValues["issueMode"] = input.issueMode;
  if (input.active !== undefined) setValues["active"] = input.active ? 1 : 0;
  if (input.category !== undefined) setValues["category"] = input.category;
  if (input.sortOrder !== undefined) setValues["sortOrder"] = input.sortOrder;

  await db.update(products).set(setValues).where(eq(products.id, id));
}

// ── G14: 创建折扣码 ────────────────────────────────

export async function upsertCoupon(
  db: DbType,
  input: CreateCouponInput,
): Promise<void> {
  // Drizzle ORM onConflictDoUpdate：INSERT ... ON CONFLICT(code) DO UPDATE
  await db
    .insert(coupons)
    .values({
      code: input.code.toLowerCase(),
      productId: input.productId || "",
      discountType: input.discountType,
      discountValue: input.discountValue,
      maxUses: input.maxUses,
      active: input.active ? 1 : 0,
      expiresAt: input.expiresAt || null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: coupons.code,
      set: {
        productId: input.productId || "",
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxUses: input.maxUses,
        active: input.active ? 1 : 0,
        expiresAt: input.expiresAt || null,
      },
    });
}

// ── G15: 生成折扣码 ────────────────────────────────

export async function generateCoupon(
  db: DbType,
  input: GenerateCouponInput,
): Promise<string[]> {
  const total = input.count ?? 1;
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const codes: string[] = [];
    const values = [];
    const now = new Date().toISOString();
    for (let i = 0; i < total; i++) {
      const code = createCouponCode(input.prefix || input.productId).toLowerCase();
      codes.push(code);
      values.push({
        code,
        productId: input.productId,
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxUses: input.maxUses,
        active: input.active ? 1 : 0,
        expiresAt: input.expiresAt || null,
        createdAt: now,
      });
    }
    try {
      await db.insert(coupons).values(values);
      return codes;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed") && attempt < maxRetries) continue;
      throw err;
    }
  }

  throw new Error(`生成折扣码冲突，已重试 ${maxRetries} 次仍失败，请稍后重试`);
}

// ── G16: 更新折扣码 ────────────────────────────────

export async function updateCoupon(
  db: DbType,
  code: string,
  input: UpdateCouponInput,
): Promise<void> {
  const setValues: Record<string, unknown> = {};
  if (input.discountType !== undefined) setValues["discountType"] = input.discountType;
  if (input.discountValue !== undefined) setValues["discountValue"] = input.discountValue;
  if (input.maxUses !== undefined) setValues["maxUses"] = input.maxUses;
  if (input.active !== undefined) setValues["active"] = input.active ? 1 : 0;
  if (input.expiresAt !== undefined) setValues["expiresAt"] = input.expiresAt;

  await db
    .update(coupons)
    .set(setValues)
    .where(eq(coupons.code, code));
}

// ── G17: 日志列表（合并 request_logs + admin_audit_logs）─

export async function getMergedLogs(
  db: DbType,
  page: number,
  limit: number,
): Promise<{ total: number; logs: Record<string, unknown>[] }> {
  const offset = (page - 1) * limit;

  // COUNT: 两表总数
  const [reqCount] = await db.select({ count: count() }).from(requestLogs);
  const [auditCount] = await db.select({ count: count() }).from(adminAuditLogs);
  const total = (reqCount?.count ?? 0) + (auditCount?.count ?? 0);

  // UNION ALL 合并请求日志和管理员审计日志（Drizzle 不支持 UNION ALL，使用 sql）
  const result = await db.run(sql`
    SELECT * FROM (
      SELECT
        'request' AS type,
        method,
        path,
        action,
        status_code AS statusCode,
        created_at AS createdAt
      FROM request_logs
      UNION ALL
      SELECT
        'admin' AS type,
        NULL AS method,
        NULL AS path,
        action,
        NULL AS statusCode,
        created_at AS createdAt
      FROM admin_audit_logs
    )
    ORDER BY createdAt DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return { total, logs: result.rows as unknown as Record<string, unknown>[] };
}

// ── G18: 读取系统配置 ──────────────────────────────

export async function getSystemConfig(
  db: DbType,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: systemConfig.key, value: systemConfig.value })
    .from(systemConfig);

  // 敏感键屏蔽：防止管理员误将密钥存入 system_config 后通过管理前端泄露
  const sensitivePrefixes = ["_key", "_secret", "_token"];
  const config: Record<string, string> = {};
  for (const row of rows) {
    const isSensitive = sensitivePrefixes.some((p) => row.key.endsWith(p));
    config[row.key] = isSensitive ? "••••••••" : row.value;
  }
  return config;
}

// ── G19: 更新系统配置 ──────────────────────────────

export async function upsertSystemConfig(
  db: DbType,
  key: string,
  value: string,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db
    .insert(systemConfig)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value, updatedAt },
    });
}

// ── G20: 删除系统配置 ──────────────────────────────

export async function deleteSystemConfig(
  db: DbType,
  key: string,
): Promise<void> {
  await db.delete(systemConfig).where(eq(systemConfig.key, key));
}

// ── G21: 库存预警 ──────────────────────────────

export type LowStockProduct = {
  id: string;
  title: string;
  category: string;
  stock: number;
};

/**
 * 查询库存低于阈值的商品列表。
 * threshold 从 system_config 读取，默认 5。
 * 如果 inventory_warning_enabled = 'false'，返回空数组。
 */
export async function getLowStockProducts(
  db: DbType,
  threshold?: number,
): Promise<LowStockProduct[]> {
  // 读取预警开关
  const [enabledRow] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, "inventory_warning_enabled"))
    .limit(1);
  if (enabledRow?.value === "false") {
    return [];
  }

  // 读取阈值
  const th = threshold ?? 5;
  const [configThreshold] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, "inventory_warning_threshold"))
    .limit(1);
  const parsed = parseInt(configThreshold?.value ?? "", 10);
  const effectiveThreshold = Number.isFinite(parsed) && parsed > 0 ? parsed : th;

  // 查询库存低于阈值的商品（使用 Drizzle ORM + sql 子查询）
  // 库存计算逻辑与 listProducts / getAdminProducts 一致：available + 过期locked
  const results = await db
    .select({
      id: products.id,
      title: products.title,
      category: products.category,
      stock: availableStockCount,
    })
    .from(products)
    .leftJoin(cards, eq(cards.productId, products.id))
    .groupBy(products.id)
    .having(sql`stock < ${effectiveThreshold}`)
    .orderBy(asc(sql`stock`), asc(products.title));

  return results as LowStockProduct[];
}

// ── G22: 取消订单 ──────────────────────────────────

export async function cancelOrder(
  db: DbType,
  id: string,
): Promise<{ id: string; releasedCardId: string | null }> {
  // 只允许取消 pending / paid 状态的订单
  const [order] = await db
    .select({ id: orders.id, status: orders.status, issuedCardId: orders.issuedCardId })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  if (!order) throw new Error("订单不存在");
  if (order.status !== "pending" && order.status !== "paid") {
    throw new Error(`状态为 ${order.status} 的订单不可取消`);
  }

  // 原子更新订单状态
  const result = await db
    .update(orders)
    .set({ status: "canceled" })
    .where(and(eq(orders.id, id), eq(orders.status, order.status)));
  if (result.rowsAffected === 0) {
    throw new Error("订单状态已变更，请刷新重试");
  }

  // 释放已锁定但未发出的卡密（status=locked → available）
  let releasedCardId: string | null = null;
  if (order.issuedCardId) {
    // 只有 locked 状态的卡密才释放（已发出的不释放）
    const releaseResult = await db
      .update(cards)
      .set({ status: "available", lockedOrderId: null, lockExpiresAt: null })
      .where(and(eq(cards.id, order.issuedCardId), eq(cards.status, "locked")));
    if (releaseResult.rowsAffected > 0) {
      releasedCardId = order.issuedCardId;
    }
  }

  return { id, releasedCardId };
}

// ── G23: 邮件日志列表 ──────────────────────────────

export type EmailLogFilter = {
  status: string;   // 'sent', 'failed', 'pending', '' (all)
  search: string;
  page: number;
  limit: number;
};

function buildEmailLogWhere(filter: EmailLogFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(eq(emailLogs.status, filter.status));
  if (filter.search) conditions.push(like(emailLogs.toEmail, `%${filter.search}%`));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function getEmailLogList(
  db: DbType,
  filter: EmailLogFilter,
): Promise<{ total: number; results: Record<string, unknown>[] }> {
  const { page, limit } = filter;
  const offset = (page - 1) * limit;
  const where = buildEmailLogWhere(filter);

  const [countRow] = await db.select({ count: count() }).from(emailLogs).where(where);
  const total = countRow?.count ?? 0;

  const results = await db
    .select({
      id: emailLogs.id,
      orderId: emailLogs.orderId,
      toEmail: emailLogs.toEmail,
      template: emailLogs.template,
      status: emailLogs.status,
      provider: emailLogs.provider,
      errorMessage: emailLogs.errorMessage,
      createdAt: emailLogs.createdAt,
      sentAt: emailLogs.sentAt,
    })
    .from(emailLogs)
    .where(where)
    .orderBy(desc(emailLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return { total, results: results as unknown as Record<string, unknown>[] };
}

// ── G24: 营销活动管理 ──────────────────────────────

export async function getCampaignList(
  db: DbType,
): Promise<Record<string, unknown>[]> {
  const results = await db
    .select({
      code: campaigns.code,
      name: campaigns.name,
      active: sql<number>`CASE WHEN ${campaigns.active} = 1 THEN 1 ELSE 0 END`,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
      metadataJson: campaigns.metadataJson,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt));

  return results.map((r) => ({
    ...r,
    active: r.active === 1,
  })) as unknown as Record<string, unknown>[];
}

export type CreateCampaignInput = {
  code: string;
  name: string;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  metadataJson?: string;
};

export async function createCampaign(
  db: DbType,
  input: CreateCampaignInput,
): Promise<void> {
  await db.insert(campaigns).values({
    code: input.code,
    name: input.name,
    active: input.active ? 1 : 0,
    startsAt: input.startsAt || null,
    endsAt: input.endsAt || null,
    metadataJson: input.metadataJson || "{}",
    createdAt: new Date().toISOString(),
  });
}

export async function updateCampaign(
  db: DbType,
  code: string,
  input: Partial<CreateCampaignInput>,
): Promise<void> {
  const setValues: Record<string, unknown> = {};
  if (input.name !== undefined) setValues["name"] = input.name;
  if (input.active !== undefined) setValues["active"] = input.active ? 1 : 0;
  if (input.startsAt !== undefined) setValues["startsAt"] = input.startsAt;
  if (input.endsAt !== undefined) setValues["endsAt"] = input.endsAt;
  if (input.metadataJson !== undefined) setValues["metadataJson"] = input.metadataJson;
  await db.update(campaigns).set(setValues).where(eq(campaigns.code, code));
}

export async function deleteCampaign(
  db: DbType,
  code: string,
): Promise<void> {
  await db.delete(campaigns).where(eq(campaigns.code, code));
}

// ── G25: 推荐码管理 ──────────────────────────────

export async function getReferralCodeList(
  db: DbType,
): Promise<Record<string, unknown>[]> {
  const results = await db
    .select({
      code: referralCodes.code,
      ownerContact: referralCodes.ownerContact,
      rewardType: referralCodes.rewardType,
      rewardValue: referralCodes.rewardValue,
      active: sql<number>`CASE WHEN ${referralCodes.active} = 1 THEN 1 ELSE 0 END`,
      createdAt: referralCodes.createdAt,
      useCount: sql<number>`(SELECT COUNT(*) FROM referral_events WHERE referral_code = ${referralCodes.code})`,
    })
    .from(referralCodes)
    .orderBy(desc(referralCodes.createdAt));

  return results.map((r) => ({
    ...r,
    active: r.active === 1,
  })) as unknown as Record<string, unknown>[];
}

export type CreateReferralCodeInput = {
  code: string;
  ownerContact: string;
  rewardType: string;
  rewardValue: number;
  active: boolean;
};

export async function createReferralCode(
  db: DbType,
  input: CreateReferralCodeInput,
): Promise<void> {
  await db.insert(referralCodes).values({
    code: input.code,
    ownerContact: input.ownerContact,
    rewardType: input.rewardType || "none",
    rewardValue: input.rewardValue || 0,
    active: input.active ? 1 : 0,
    createdAt: new Date().toISOString(),
  });
}

export async function updateReferralCode(
  db: DbType,
  code: string,
  input: Partial<CreateReferralCodeInput>,
): Promise<void> {
  const setValues: Record<string, unknown> = {};
  if (input.ownerContact !== undefined) setValues["ownerContact"] = input.ownerContact;
  if (input.rewardType !== undefined) setValues["rewardType"] = input.rewardType;
  if (input.rewardValue !== undefined) setValues["rewardValue"] = input.rewardValue;
  if (input.active !== undefined) setValues["active"] = input.active ? 1 : 0;
  await db.update(referralCodes).set(setValues).where(eq(referralCodes.code, code));
}

export async function deleteReferralCode(
  db: DbType,
  code: string,
): Promise<void> {
  await db.delete(referralCodes).where(eq(referralCodes.code, code));
}

// ── G26: 编辑卡密 ──────────────────────────────────

export async function updateCard(
  db: DbType,
  id: string,
  input: { accountLabel?: string; deliverySecret?: string; deliveryNote?: string },
): Promise<{ id: string } | null> {
  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.id, id))
    .limit(1);
  if (!card) return null;

  const setValues: Record<string, unknown> = {};
  if (input.accountLabel !== undefined) setValues["accountLabel"] = input.accountLabel.trim();
  if (input.deliverySecret !== undefined) setValues["deliverySecret"] = input.deliverySecret.trim();
  if (input.deliveryNote !== undefined) setValues["deliveryNote"] = input.deliveryNote.trim();

  if (Object.keys(setValues).length > 0) {
    await db.update(cards).set(setValues).where(eq(cards.id, id));
  }
  return { id };
}

// ── G27: 删除商品 ──────────────────────────────────

export async function deleteProduct(
  db: DbType,
  id: string,
): Promise<{ deleted: boolean; reason?: string }> {
  // 检查是否有关联订单
  const [orderRow] = await db
    .select({ count: count() })
    .from(orders)
    .where(eq(orders.productId, id));
  if ((orderRow?.count ?? 0) > 0) {
    return { deleted: false, reason: `该商品有 ${orderRow?.count} 个关联订单，不可删除` };
  }

  // 检查是否有关联卡密
  const [cardRow] = await db
    .select({ count: count() })
    .from(cards)
    .where(eq(cards.productId, id));
  if ((cardRow?.count ?? 0) > 0) {
    return { deleted: false, reason: `该商品有 ${cardRow?.count} 张关联卡密，请先处理卡密` };
  }

  await db.delete(products).where(eq(products.id, id));
  return { deleted: true };
}

// ── G28: 删除折扣码 ──────────────────────────────────

export async function deleteCoupon(
  db: DbType,
  code: string,
): Promise<void> {
  await db.delete(coupons).where(eq(coupons.code, code));
}