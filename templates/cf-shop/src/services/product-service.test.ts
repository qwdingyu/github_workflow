import { describe, it, expect } from "vitest";
import { toPublicProduct } from "./product-service";
import type { ProductRow } from "./product-service";

// Note: listProducts and getProduct depend on Drizzle ORM and D1,
// so we only test the pure functions (toPublicProduct, parseTags) here.

// parseTags is not exported, but toPublicProduct uses it internally.
// We test it through toPublicProduct.

describe("toPublicProduct", () => {
  const baseRow: ProductRow = {
    id: "prod-1",
    slug: "my-product",
    title: "Test Product",
    description: "A test product",
    salesCopy: "Buy now!",
    coverUrl: "https://example.com/cover.jpg",
    tagsJson: '["tag1","tag2"]',
    priceCents: 5000,
    currency: "CNY",
    issueMode: "manual",
    active: 1,
    stock: 10,
    category: "software",
  };

  it("maps all fields correctly", () => {
    const result = toPublicProduct(baseRow);
    expect(result.id).toBe("prod-1");
    expect(result.slug).toBe("my-product");
    expect(result.title).toBe("Test Product");
    expect(result.priceCents).toBe(5000);
    expect(result.currency).toBe("CNY");
    expect(result.issueMode).toBe("manual");
    expect(result.stock).toBe(10);
    expect(result.active).toBe(true);
    expect(result.category).toBe("software");
  });

  it("uses id as slug when slug is null", () => {
    const row = { ...baseRow, slug: null };
    const result = toPublicProduct(row);
    expect(result.slug).toBe("prod-1");
  });

  it("parses tagsJson correctly", () => {
    const result = toPublicProduct(baseRow);
    expect(result.tags).toEqual(["tag1", "tag2"]);
  });

  it("handles empty tagsJson", () => {
    const row = { ...baseRow, tagsJson: "[]" };
    const result = toPublicProduct(row);
    expect(result.tags).toEqual([]);
  });

  it("handles invalid tagsJson gracefully", () => {
    const row = { ...baseRow, tagsJson: "not-json" };
    const result = toPublicProduct(row);
    expect(result.tags).toEqual([]);
  });

  it("filters non-string tags", () => {
    const row = { ...baseRow, tagsJson: '[1, "valid", null, {"key":"val"}, "also-valid"]' };
    const result = toPublicProduct(row);
    expect(result.tags).toEqual(["valid", "also-valid"]);
  });

  it("converts active=0 to false", () => {
    const row = { ...baseRow, active: 0 };
    const result = toPublicProduct(row);
    expect(result.active).toBe(false);
  });

  it("converts stock to number", () => {
    const row = { ...baseRow, stock: "5" as unknown as number };
    const result = toPublicProduct(row);
    expect(result.stock).toBe(5);
  });

  it("handles zero stock", () => {
    const row = { ...baseRow, stock: 0 };
    const result = toPublicProduct(row);
    expect(result.stock).toBe(0);
  });

  it("defaults empty category", () => {
    const row = { ...baseRow, category: "" };
    const result = toPublicProduct(row);
    expect(result.category).toBe("");
  });
});
