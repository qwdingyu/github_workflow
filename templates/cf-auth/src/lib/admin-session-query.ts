/**
 * Admin 会话查询：解析「邮箱或 userId」输入（纯函数，供路由与单测）。
 */
import { normalizeEmail } from "./blocklist";

export type SessionQueryKind = "empty" | "email" | "userId";

export type ParsedSessionQuery =
  | { kind: "empty"; raw: string }
  | { kind: "email"; raw: string; email: string }
  | { kind: "userId"; raw: string; userId: string };

/** 粗判：含 @ 且规范化后仍含 @ 视为邮箱（与运维输入习惯一致） */
export function looksLikeEmail(input: string): boolean {
  const t = input.trim();
  if (!t.includes("@")) return false;
  const n = normalizeEmail(t);
  const at = n.indexOf("@");
  return at > 0 && at < n.length - 1;
}

/**
 * 解析会话查询框：空 / 邮箱 / 其余当 userId。
 * 不访问数据库；未知邮箱由路由层查库后返回空列表或明确 message。
 */
export function parseSessionQuery(input: string | null | undefined): ParsedSessionQuery {
  const raw = (input ?? "").trim();
  if (!raw) return { kind: "empty", raw: "" };
  if (looksLikeEmail(raw)) {
    return { kind: "email", raw, email: normalizeEmail(raw) };
  }
  return { kind: "userId", raw, userId: raw };
}
