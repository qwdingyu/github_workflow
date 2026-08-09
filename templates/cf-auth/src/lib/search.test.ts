/**
 * LIKE 消毒与 ESCAPE 语义单测。
 */
import { describe, expect, it } from "vitest";
import { escapeLikePattern, likeContains } from "./search";

describe("search / likeContains", () => {
  it("空与空白 → null", () => {
    expect(likeContains("")).toBeNull();
    expect(likeContains("   ")).toBeNull();
  });

  it("普通词前后加 %", () => {
    expect(likeContains("abc")).toBe("%abc%");
    expect(likeContains("  abc  ")).toBe("%abc%");
  });

  it("转义 % _ \\", () => {
    expect(escapeLikePattern("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(likeContains("%")).toBe("%\\%%");
    expect(likeContains("_x_")).toBe("%\\_x\\_%");
  });
});
