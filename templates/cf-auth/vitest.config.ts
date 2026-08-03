import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
    include: ["src/**/*.test.ts"],
  },
});
