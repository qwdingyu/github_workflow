/**
 * LIKE 查询消毒：用户输入中的 % _ \ 会改变 SQL LIKE 语义。
 * SQLite 默认无 ESCAPE 字符，仅转义不够——必须配合 `ESCAPE '\'`。
 * 对齐 cf-lottery `admin-lottery-helpers.escapeLike` + 显式 ESCAPE。
 */
import { sql, type SQL, type AnyColumn } from "drizzle-orm";

export function escapeLikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** 构造含前后模糊的 pattern；空串返回 null（表示不加 where） */
export function likeContains(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return `%${escapeLikePattern(t)}%`;
}

/**
 * 列 LIKE 模糊匹配（含 ESCAPE）。
 * pattern 须已由 likeContains 生成；调用方负责 null 判断。
 */
export function columnLikeContains(column: AnyColumn, pattern: string): SQL {
  // SQLite：ESCAPE '\' 使 \ 成为转义符，% _ 仅字面匹配
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}
