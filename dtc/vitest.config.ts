import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@eforge/cf-core": "/Users/dingyuwang/0-X/github_workflow/packages/cf-core/src",
      "@eforge/cf-core/db": "/Users/dingyuwang/0-X/github_workflow/packages/cf-core/src/db",
      "@eforge/cf-core/http": "/Users/dingyuwang/0-X/github_workflow/packages/cf-core/src/http",
      "@eforge/cf-core/security": "/Users/dingyuwang/0-X/github_workflow/packages/cf-core/src/security",
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});