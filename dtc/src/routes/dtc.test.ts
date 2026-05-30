/**
 * API 路由单元测试
 *
 * 测试路由层的基础逻辑和边界条件。
 * 注意：完整的 API 集成测试需要 Turso 数据库连接（在 E2E 冒烟测试中覆盖）。
 */

import { describe, it, expect } from "vitest";

describe("DTC Routes — 路由基础逻辑", () => {
  // 模块导入测试设置 15s 超时（cf-core 缓存模块在非 Workers 环境下加载慢）
  it("路由模块应可正常导入", async () => {
    const dtcModule = await import("../routes/dtc");
    expect(dtcModule.dtc).toBeDefined();
  }, 15000);

  it("health 路由模块应可正常导入", async () => {
    const healthModule = await import("../routes/health");
    expect(healthModule.health).toBeDefined();
  });

  it("manufacturers 路由模块应可正常导入", async () => {
    const mfrModule = await import("../routes/manufacturers");
    expect(mfrModule.manufacturersRoute).toBeDefined();
  });

  it("bootstrap 入口应可正常导入", async () => {
    const indexModule = await import("../index");
    expect(indexModule.default).toBeDefined();
  }, 15000);
});