/**
 * 管理后台路由
 *
 * 使用 createAdminAuth() 中间件保护所有管理端接口。
 * 提供商品 CRUD、卡密管理、订单管理等功能。
 */

import { Hono } from "hono";
import { z } from "zod";
import { ok, fail, safeJsonBody } from "@eforge/cf-core/http";
import { createAdminAuth } from "@eforge/cf-core/middleware";
import { getIpHash } from "@eforge/cf-core/security";
import { writeAdminAudit } from "@eforge/cf-core/audit";
import { generateUUID } from "@eforge/cf-core/crypto";
import type { AppEnv } from "../bindings";
import { products, cards, cardBatches, orders, orderEvents, coupons, voucherCodes, userBalances } from "../db/schema";
import { sql, eq, and, desc, like } from "drizzle-orm";

export const adminRoutes = new Hono<AppEnv>();

// ── 应用管理员认证中间件 ──
adminRoutes.use("*", createAdminAuth({ mode: "both" }));

// ═══════════════════════════════════════════════════════════════════════════════
// 商品管理
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/products
 * 获取所有商品（含库存统计）
 */
adminRoutes.get("/products", async (c) => {
  try {
    const db = c.get("db");
    const allProducts = await db.select().from(products).orderBy(desc(products.sortOrder));

    // 统计每个商品的库存
    const stockStats = await db
      .select({
        productId: cards.productId,
        available: sql<number>`sum(case when ${cards.status} = 'available' then 1 else 0 end)`,
        total: sql<number>`count(*)`,
      })
      .from(cards)
      .groupBy(cards.productId);

    const stockMap = new Map(stockStats.map((s) => [s.productId, s]));

    const result = allProducts.map((p) => ({
      ...p,
      stock: stockMap.get(p.id) || { available: 0, total: 0 },
    }));

    return ok(c, { products: result });
  } catch (err) {
    console.error("[admin:products:list] error:", err);
    return fail(c, "获取商品列表失败", 500);
  }
});

/**
 * POST /api/admin/products
 * 创建商品
 */
adminRoutes.post("/products", async (c) => {
  try {
    const body = await safeJsonBody(c);
    if (!body || typeof body !== "object") {
      return fail(c, "请求体格式错误", 400);
    }

    const schema = z.object({
      name: z.string().min(1).max(100),
      slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
      description: z.string().optional(),
      category: z.string().optional(),
      priceCents: z.number().int().min(0),
      originalPriceCents: z.number().int().min(0).optional(),
      imageUrl: z.string().optional(),
      enabled: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      instructions: z.string().optional(),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail(c, parsed.error.errors[0]?.message || "参数错误", 400);
    }

    const db = c.get("db");
    const id = generateUUID();
    const now = new Date().toISOString();

    await db.insert(products).values({
      id,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || "",
      category: parsed.data.category || "card",
      priceCents: parsed.data.priceCents,
      originalPriceCents: parsed.data.originalPriceCents || 0,
      imageUrl: parsed.data.imageUrl || "",
      enabled: parsed.data.enabled ? 1 : 0,
      sortOrder: parsed.data.sortOrder || 0,
      instructions: parsed.data.instructions || "",
      createdAt: now,
      updatedAt: now,
    });

    // 审计日志
    await writeAdminAudit({
      db: db as any,
      action: "product.create",
      targetType: "product",
      targetId: id,
      metadata: { name: parsed.data.name },
      ipHash: await getIpHash(c),
    });

    return ok(c, { id }, 201);
  } catch (err) {
    console.error("[admin:products:create] error:", err);
    return fail(c, "创建商品失败", 500);
  }
});

/**
 * PUT /api/admin/products/:id
 * 更新商品
 */
adminRoutes.put("/products/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await safeJsonBody(c);
    if (!body || typeof body !== "object") {
      return fail(c, "请求体格式错误", 400);
    }

    const db = c.get("db");
    const now = new Date().toISOString();

    const updateData: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(body)) {
      if (key === "enabled") {
        updateData[key] = value ? 1 : 0;
      } else {
        updateData[key] = value;
      }
    }

    await db.update(products).set(updateData).where(eq(products.id, id));

    await writeAdminAudit({
      db: db as any,
      action: "product.update",
      targetType: "product",
      targetId: id,
      metadata: body,
      ipHash: await getIpHash(c),
    });

    return ok(c, { updated: true });
  } catch (err) {
    console.error("[admin:products:update] error:", err);
    return fail(c, "更新商品失败", 500);
  }
});

/**
 * DELETE /api/admin/products/:id
 * 删除商品（仅当无关联卡密时）
 */
adminRoutes.delete("/products/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const db = c.get("db");

    // 检查是否有关联卡密
    const cardCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(eq(cards.productId, id))
      .then((rows) => rows[0]?.count ?? 0);

    if (cardCount > 0) {
      return fail(c, "该商品下还有卡密，无法删除", 400);
    }

    await db.delete(products).where(eq(products.id, id));

    await writeAdminAudit({
      db: db as any,
      action: "product.delete",
      targetType: "product",
      targetId: id,
      metadata: {},
      ipHash: await getIpHash(c),
    });

    return ok(c, { deleted: true });
  } catch (err) {
    console.error("[admin:products:delete] error:", err);
    return fail(c, "删除商品失败", 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 卡密管理
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/cards/import
 * 批量导入卡密
 */
adminRoutes.post("/cards/import", async (c) => {
  try {
    const body = await safeJsonBody(c);
    if (!body || typeof body !== "object") {
      return fail(c, "请求体格式错误", 400);
    }

    const schema = z.object({
      productId: z.string().min(1),
      cards: z.array(z.string().min(1)).min(1).max(10000),
      batchName: z.string().optional(),
      costCents: z.number().int().min(0).optional(),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail(c, parsed.error.errors[0]?.message || "参数错误", 400);
    }

    const db = c.get("db");
    const now = new Date().toISOString();

    // 创建批次
    const batchId = generateUUID();
    await db.insert(cardBatches).values({
      id: batchId,
      productId: parsed.data.productId,
      name: parsed.data.batchName || `导入 ${parsed.data.cards.length} 张`,
      costCents: parsed.data.costCents || 0,
      createdAt: now,
    });

    // 批量插入卡密
    const cardRows = parsed.data.cards.map((cardData) => ({
      id: generateUUID(),
      productId: parsed.data.productId,
      batchId,
      cardData,
      status: "available",
      createdAt: now,
    }));

    // 分批插入（每批 100 条）
    const batchSize = 100;
    for (let i = 0; i < cardRows.length; i += batchSize) {
      await db.insert(cards).values(cardRows.slice(i, i + batchSize));
    }

    await writeAdminAudit({
      db: db as any,
      action: "cards.import",
      targetType: "batch",
      targetId: batchId,
      metadata: { count: parsed.data.cards.length, productId: parsed.data.productId },
      ipHash: await getIpHash(c),
    });

    return ok(c, { imported: parsed.data.cards.length, batchId }, 201);
  } catch (err) {
    console.error("[admin:cards:import] error:", err);
    return fail(c, "导入卡密失败", 500);
  }
});

/**
 * GET /api/admin/cards
 * 查询卡密列表（支持筛选）
 */
adminRoutes.get("/cards", async (c) => {
  try {
    const db = c.get("db");
    const productId = c.req.query("productId");
    const status = c.req.query("status");
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("pageSize") || "50")));

    let query = db.select().from(cards);

    if (productId) {
      query = query.where(eq(cards.productId, productId)) as typeof query;
    }
    if (status) {
      query = query.where(eq(cards.status, status)) as typeof query;
    }

    const allCards = await query.orderBy(desc(cards.createdAt)).limit(pageSize).offset((page - 1) * pageSize);

    return ok(c, { cards: allCards, page, pageSize });
  } catch (err) {
    console.error("[admin:cards:list] error:", err);
    return fail(c, "获取卡密列表失败", 500);
  }
});

/**
 * DELETE /api/admin/cards/:id
 * 删除卡密（仅 available 状态可删）
 */
adminRoutes.delete("/cards/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const db = c.get("db");

    const card = await db.select().from(cards).where(eq(cards.id, id)).limit(1);
    if (!card.length) {
      return fail(c, "卡密不存在", 404);
    }
    if (card[0].status !== "available") {
      return fail(c, "只能删除 available 状态的卡密", 400);
    }

    await db.delete(cards).where(eq(cards.id, id));

    await writeAdminAudit({
      db: db as any,
      action: "card.delete",
      targetType: "card",
      targetId: id,
      metadata: {},
      ipHash: await getIpHash(c),
    });

    return ok(c, { deleted: true });
  } catch (err) {
    console.error("[admin:cards:delete] error:", err);
    return fail(c, "删除卡密失败", 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 订单管理
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/orders
 * 获取订单列表（支持筛选）
 */
adminRoutes.get("/orders", async (c) => {
  try {
    const db = c.get("db");
    const status = c.req.query("status");
    const orderNo = c.req.query("orderNo");
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("pageSize") || "50")));

    let query = db.select().from(orders);

    if (status) {
      query = query.where(eq(orders.status, status)) as typeof query;
    }
    if (orderNo) {
      query = query.where(like(orders.orderNo, `%${orderNo}%`)) as typeof query;
    }

    const allOrders = await query.orderBy(desc(orders.createdAt)).limit(pageSize).offset((page - 1) * pageSize);

    return ok(c, { orders: allOrders, page, pageSize });
  } catch (err) {
    console.error("[admin:orders:list] error:", err);
    return fail(c, "获取订单列表失败", 500);
  }
});

/**
 * GET /api/admin/orders/:id
 * 获取订单详情（含事件日志）
 */
adminRoutes.get("/orders/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const db = c.get("db");

    const orderRows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!orderRows.length) {
      return fail(c, "订单不存在", 404);
    }

    const events = await db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, id))
      .orderBy(desc(orderEvents.createdAt));

    return ok(c, { order: orderRows[0], events });
  } catch (err) {
    console.error("[admin:orders:detail] error:", err);
    return fail(c, "获取订单详情失败", 500);
  }
});

/**
 * POST /api/admin/orders/:id/confirm
 * 手动确认订单（手动支付方式）
 */
adminRoutes.post("/orders/:id/confirm", async (c) => {
  try {
    const id = c.req.param("id");
    const db = c.get("db");
    const now = new Date().toISOString();

    const orderRows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!orderRows.length) {
      return fail(c, "订单不存在", 404);
    }

    const order = orderRows[0];
    if (order.status !== "pending") {
      return fail(c, "只能确认 pending 状态的订单", 400);
    }

    // 更新订单状态
    await db.update(orders).set({ status: "paid", paidCents: order.amountCents, updatedAt: now }).where(eq(orders.id, id));

    // 记录事件
    await db.insert(orderEvents).values({
      id: generateUUID(),
      orderId: id,
      eventType: "paid",
      metadataJson: JSON.stringify({ confirmedBy: "admin" }),
      createdAt: now,
    });

    await writeAdminAudit({
      db: db as any,
      action: "order.confirm",
      targetType: "order",
      targetId: id,
      metadata: { orderNo: order.orderNo },
      ipHash: await getIpHash(c),
    });

    return ok(c, { confirmed: true });
  } catch (err) {
    console.error("[admin:orders:confirm] error:", err);
    return fail(c, "确认订单失败", 500);
  }
});

/**
 * POST /api/admin/orders/:id/cancel
 * 取消订单（释放卡密）
 */
adminRoutes.post("/orders/:id/cancel", async (c) => {
  try {
    const id = c.req.param("id");
    const db = c.get("db");
    const now = new Date().toISOString();

    const orderRows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!orderRows.length) {
      return fail(c, "订单不存在", 404);
    }

    // 更新订单状态
    await db.update(orders).set({ status: "cancelled", updatedAt: now }).where(eq(orders.id, id));

    // 释放锁定的卡密
    await db
      .update(cards)
      .set({ status: "available", lockedByOrderId: null })
      .where(eq(cards.lockedByOrderId, id));

    // 记录事件
    await db.insert(orderEvents).values({
      id: generateUUID(),
      orderId: id,
      eventType: "cancelled",
      metadataJson: JSON.stringify({ cancelledBy: "admin" }),
      createdAt: now,
    });

    await writeAdminAudit({
      db: db as any,
      action: "order.cancel",
      targetType: "order",
      targetId: id,
      metadata: { orderNo: orderRows[0].orderNo },
      ipHash: await getIpHash(c),
    });

    return ok(c, { cancelled: true });
  } catch (err) {
    console.error("[admin:orders:cancel] error:", err);
    return fail(c, "取消订单失败", 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 优惠码管理
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/coupons
 * 获取优惠码列表
 */
adminRoutes.get("/coupons", async (c) => {
  try {
    const db = c.get("db");
    const allCoupons = await db.select().from(coupons).orderBy(desc(coupons.createdAt));
    return ok(c, { coupons: allCoupons });
  } catch (err) {
    console.error("[admin:coupons:list] error:", err);
    return fail(c, "获取优惠码列表失败", 500);
  }
});

/**
 * POST /api/admin/coupons
 * 创建优惠码
 */
adminRoutes.post("/coupons", async (c) => {
  try {
    const body = await safeJsonBody(c);
    if (!body || typeof body !== "object") {
      return fail(c, "请求体格式错误", 400);
    }

    const schema = z.object({
      code: z.string().min(1).max(50),
      discountType: z.enum(["percent", "fixed"]),
      discountValue: z.number().int().min(1),
      minOrderCents: z.number().int().min(0).optional(),
      maxUsage: z.number().int().min(0).optional(),
      expiresAt: z.string().optional(),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail(c, parsed.error.errors[0]?.message || "参数错误", 400);
    }

    const db = c.get("db");
    const id = generateUUID();
    const now = new Date().toISOString();

    await db.insert(coupons).values({
      id,
      code: parsed.data.code.toUpperCase(),
      discountType: parsed.data.discountType,
      discountValue: parsed.data.discountValue,
      minOrderCents: parsed.data.minOrderCents || 0,
      maxUsage: parsed.data.maxUsage || 0,
      expiresAt: parsed.data.expiresAt || null,
      createdAt: now,
    });

    return ok(c, { id }, 201);
  } catch (err) {
    console.error("[admin:coupons:create] error:", err);
    return fail(c, "创建优惠码失败", 500);
  }
});

/**
 * DELETE /api/admin/coupons/:id
 * 删除优惠码
 */
adminRoutes.delete("/coupons/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const db = c.get("db");
    await db.delete(coupons).where(eq(coupons.id, id));
    return ok(c, { deleted: true });
  } catch (err) {
    console.error("[admin:coupons:delete] error:", err);
    return fail(c, "删除优惠码失败", 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 充值码管理
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/vouchers/generate
 * 批量生成充值码
 */
adminRoutes.post("/vouchers/generate", async (c) => {
  try {
    const body = await safeJsonBody(c);
    if (!body || typeof body !== "object") {
      return fail(c, "请求体格式错误", 400);
    }

    const schema = z.object({
      count: z.number().int().min(1).max(10000, "单次最多生成 10000 张"),
      amountCents: z.number().int().min(1, "面值至少 1 分"),
      batchId: z.string().min(1).max(100),
      expiresAt: z.string().optional(),
      notes: z.string().optional(),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail(c, parsed.error.errors[0]?.message || "参数错误", 400);
    }

    const db = c.get("db");
    const { generateVoucherCodes } = await import("../services/voucher-service");
    const codes = await generateVoucherCodes(
      db,
      parsed.data.count,
      parsed.data.amountCents,
      parsed.data.batchId,
      parsed.data.expiresAt || null,
      parsed.data.notes,
    );

    await writeAdminAudit({
      db: db as any,
      action: "voucher.generate",
      targetType: "voucher",
      metadata: { count: parsed.data.count, batchId: parsed.data.batchId },
      ipHash: await getIpHash(c),
    });

    return ok(c, { codes, count: codes.length }, 201);
  } catch (err) {
    console.error("[admin:vouchers:generate] error:", err);
    return fail(c, "生成充值码失败", 500);
  }
});

/**
 * GET /api/admin/vouchers/list
 * 充值码列表（分页）
 */
adminRoutes.get("/vouchers/list", async (c) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const pageSize = parseInt(c.req.query("pageSize") || "50");
    const status = c.req.query("status") || undefined;
    const batchId = c.req.query("batchId") || undefined;
    const search = c.req.query("search") || undefined;

    const db = c.get("db");
    const { listVoucherCodes } = await import("../services/voucher-service");
    const result = await listVoucherCodes(db, { page, pageSize, status, batchId, search });

    return ok(c, result);
  } catch (err) {
    console.error("[admin:vouchers:list] error:", err);
    return fail(c, "查询充值码列表失败", 500);
  }
});

/**
 * GET /api/admin/vouchers/stats
 * 充值码统计
 */
adminRoutes.get("/vouchers/stats", async (c) => {
  try {
    const db = c.get("db");
    const { getVoucherStats } = await import("../services/voucher-service");
    const stats = await getVoucherStats(db);
    return ok(c, stats);
  } catch (err) {
    console.error("[admin:vouchers:stats] error:", err);
    return fail(c, "查询充值码统计失败", 500);
  }
});

/**
 * POST /api/admin/vouchers/revoke
 * 批量作废充值码
 */
adminRoutes.post("/vouchers/revoke", async (c) => {
  try {
    const body = await safeJsonBody(c);
    if (!body || typeof body !== "object") {
      return fail(c, "请求体格式错误", 400);
    }

    const schema = z.object({
      codes: z.array(z.string().min(1)).min(1, "至少需要 1 个充值码").max(500, "单次最多作废 500 个"),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail(c, parsed.error.errors[0]?.message || "参数错误", 400);
    }

    const db = c.get("db");
    const { revokeVoucherCodes } = await import("../services/voucher-service");
    await revokeVoucherCodes(db, parsed.data.codes);

    await writeAdminAudit({
      db: db as any,
      action: "voucher.revoke",
      targetType: "voucher",
      metadata: { count: parsed.data.codes.length },
      ipHash: await getIpHash(c),
    });

    return ok(c, { revoked: parsed.data.codes.length });
  } catch (err) {
    console.error("[admin:vouchers:revoke] error:", err);
    return fail(c, "作废充值码失败", 500);
  }
});
