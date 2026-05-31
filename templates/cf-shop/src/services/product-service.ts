/**
 * 商品服务 — 商品列表查询和详情查询。
 *
 * 使用 Drizzle ORM 进行查询，库存通过 LEFT JOIN cards 表实时统计。
 * 仅返回 active=1 的已上架商品给前端用户。
 */

import { eq, or } from "drizzle-orm";
import type { DbType } from "../db/client";
import type { IssueMode } from "../bindings";
import { cards, products } from "../db/schema";
import { availableStockCount } from "../db/expressions";

/** 商品行数据（含库存统计） */
export type ProductRow = {
  id: string;
  slug: string | null;
  title: string;
  description: string;
  salesCopy: string;
  coverUrl: string;
  tagsJson: string;
  priceCents: number;
  currency: string;
  issueMode: IssueMode;
  active: number;
  stock: number;
  category: string;
};

function parseTags(tagsJson: string) {
  try {
    const value = JSON.parse(tagsJson || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function toPublicProduct(row: ProductRow) {
  return {
    id: row.id,
    slug: row.slug || row.id,
    title: row.title,
    description: row.description,
    salesCopy: row.salesCopy,
    coverUrl: row.coverUrl,
    priceCents: row.priceCents,
    currency: row.currency,
    issueMode: row.issueMode,
    stock: Number(row.stock || 0),
    tags: parseTags(row.tagsJson),
    active: row.active === 1,
    category: row.category || ""
  };
}

export async function listProducts(db: DbType) {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      description: products.description,
      salesCopy: products.salesCopy,
      coverUrl: products.coverUrl,
      tagsJson: products.tagsJson,
      priceCents: products.priceCents,
      currency: products.currency,
      issueMode: products.issueMode,
      active: products.active,
      category: products.category,
      stock: availableStockCount,
    })
    .from(products)
    .leftJoin(cards, eq(cards.productId, products.id))
    .where(eq(products.active, 1))
    .groupBy(products.id)
    .orderBy(products.sortOrder, products.createdAt);

  return rows.map((row) => toPublicProduct({ ...row, stock: Number(row.stock || 0), issueMode: row.issueMode as IssueMode }));
}

export async function getProduct(db: DbType, idOrSlug: string) {
  const [row] = await db
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      description: products.description,
      salesCopy: products.salesCopy,
      coverUrl: products.coverUrl,
      tagsJson: products.tagsJson,
      priceCents: products.priceCents,
      currency: products.currency,
      issueMode: products.issueMode,
      active: products.active,
      category: products.category,
      stock: availableStockCount,
    })
    .from(products)
    .leftJoin(cards, eq(cards.productId, products.id))
    .where(or(eq(products.id, idOrSlug), eq(products.slug, idOrSlug)))
    .groupBy(products.id)
    .limit(1);

  return row ? toPublicProduct({ ...row, stock: Number(row.stock || 0), issueMode: row.issueMode as IssueMode }) : null;
}