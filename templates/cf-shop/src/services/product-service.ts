/**
 * 商品查询服务
 *
 * 提供商品列表（含库存统计）和商品详情查询逻辑。
 */

import { sql, eq } from "drizzle-orm";
import { products, cards } from "../db/schema";
import { LOW_STOCK_THRESHOLD } from "../config";

/** Drizzle 数据库实例类型（通用） */
type DB = Parameters<typeof products.$inferSelect extends never ? never : () => void>[0] extends never
  ? any
  : any;

/**
 * 获取所有上架商品（含库存统计）
 *
 * @param db - Drizzle 数据库实例
 * @returns 商品列表，每个商品包含 availableStock 和 totalStock
 */
export async function getAllProducts(db: any) {
  // 查询上架商品
  const productList = await db
    .select()
    .from(products)
    .where(eq(products.enabled, 1))
    .orderBy(sql`${products.sortOrder} DESC, ${products.createdAt} DESC`);

  // 统计每个商品的库存
  const stockStats = await db
    .select({
      productId: cards.productId,
      available: sql<number>`sum(case when ${cards.status} = 'available' then 1 else 0 end)`,
      total: sql<number>`count(*)`,
    })
    .from(cards)
    .groupBy(cards.productId);

  // 合并库存统计
  const stockMap = new Map(stockStats.map((s: any) => [s.productId, s]));

  return productList.map((p: any) => {
    const stock = stockMap.get(p.id) || { available: 0, total: 0 };
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      category: p.category,
      priceCents: p.priceCents,
      originalPriceCents: p.originalPriceCents,
      imageUrl: p.imageUrl,
      instructions: p.instructions,
      availableStock: stock.available,
      totalStock: stock.total,
      isLowStock: stock.available <= LOW_STOCK_THRESHOLD && stock.available > 0,
      isOutOfStock: stock.available === 0,
    };
  });
}

/**
 * 通过 slug 获取商品详情
 *
 * @param db - Drizzle 数据库实例
 * @param slug - 商品别名
 * @returns 商品详情（含库存），不存在返回 null
 */
export async function getProductBySlug(db: any, slug: string) {
  const productList = await db
    .select()
    .from(products)
    .where(sql`${products.slug} = ${slug} AND ${products.enabled} = 1`)
    .limit(1);

  if (!productList.length) {
    return null;
  }

  const p = productList[0];

  // 查询库存
  const stock = await db
    .select({
      available: sql<number>`sum(case when ${cards.status} = 'available' then 1 else 0 end)`,
      total: sql<number>`count(*)`,
    })
    .from(cards)
    .where(eq(cards.productId, p.id))
    .then((rows: any[]) => rows[0] || { available: 0, total: 0 });

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    category: p.category,
    priceCents: p.priceCents,
    originalPriceCents: p.originalPriceCents,
    imageUrl: p.imageUrl,
    instructions: p.instructions,
    availableStock: stock.available,
    totalStock: stock.total,
    isLowStock: stock.available <= LOW_STOCK_THRESHOLD && stock.available > 0,
    isOutOfStock: stock.available === 0,
  };
}
