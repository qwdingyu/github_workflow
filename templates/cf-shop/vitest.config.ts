import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "html-raw-loader-mock",
      resolveId(id) {
        if (id.includes("templates/*.html?raw")) {
          return "\0html-templates-mock";
        }
        return null;
      },
      load(id) {
        if (id === "\0html-templates-mock") {
          return `export default ${JSON.stringify({ "./order_issued.html": "<p>{{order_no}}</p><p>{{product_title}}</p><p>{{account_label}}</p><p>{{delivery_secret}}</p>", "./order_pending.html": "ORDER PENDING HTML", "./order_paid.html": "ORDER PAID HTML", "./order_expired.html": "ORDER EXPIRED HTML" })};`;
        }
        return null;
      },
    },
  ],
  test: {
    environment: "miniflare",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.ts",
        "src/db/schema.ts",
        "src/db/client.ts",
        "src/db/database.ts",
        "src/bindings.ts",
        "src/index.ts",
        "src/routes/**/*.ts",
        // Template files are pure string exports; no logic to test.
        "src/services/templates/**/*.ts",
        // product-service has unit tests for pure functions (toPublicProduct);
        // DB-dependent functions (listProducts, getProduct) need integration tests.
        "src/services/product-service.ts",
        // Test utilities are not production code.
        "src/test-utils/**/*.ts",
      ],
      thresholds: {
        functions: 80,
        branches: 50,
        lines: 70,
      },
    },
  },
});