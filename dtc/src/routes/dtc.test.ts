/**
 * API 路由单元测试
 *
 * 测试路由层的基础逻辑和边界条件。
 * 注意：完整的 API 集成测试需要 Turso 数据库连接（在 E2E 测试中覆盖）。
 */

import { describe, it, expect } from "vitest";

describe("DTC Routes — 路由基础逻辑", () => {
  it("路由模块应可正常导入", async () => {
    // 验证路由模块和依赖模块的导入不会抛异常
    const dtcModule = await import("../routes/dtc");
    expect(dtcModule.dtc).toBeDefined();
  });

  it("health 路由模块应可正常导入", async () => {
    const healthModule = await import("../routes/health");
    expect(healthModule.health).toBeDefined();
  });

  it("manufacturers 路由模块应可正常导入", async () => {
    const mfrModule = await import("../routes/manufacturers");
    expect(mfrModule.manufacturersRoute).toBeDefined();
  });

  it("bootstrap 入口应可正常导入", async () => {
    // 验证 index.ts 依赖的 bootstrap 函数可被引用
    // 注意：由于 Worker 环境下 bootstrap 需要 CF bindings，
    // 这里只验证模块结构完整性
    const indexModule = await import("../index");
    expect(indexModule.default).toBeDefined();
  });
});