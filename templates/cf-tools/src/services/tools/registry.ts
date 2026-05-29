/**
 * 工具驱动注册表（工厂模式）
 *
 * 所有工具驱动在此注册。运行时通过 slug 查找驱动执行。
 *
 * 添加新工具的步骤：
 * 1. 在 src/services/tools/ 下创建新文件，实现 ToolDriver 接口
 * 2. 在此文件中 import 并调用 toolRegistry.register()
 * 3. 在 src/config.ts 的 registeredTools 中添加元数据
 * 4. 在 migrations/ 中添加种子数据（可选，也可通过管理后台添加）
 */

import type { ToolDriver } from "./types";
import { exampleTool } from "./example-tool";

// ── 注册表实现 ───────────────────────────────────────────────────────────────

class ToolRegistry {
  /** 已注册的工具驱动映射：slug → ToolDriver */
  private drivers = new Map<string, ToolDriver>();

  /**
   * 注册工具驱动
   *
   * @param driver - 工具驱动实例
   * @throws 如果 slug 重复则抛出错误（开发阶段快速发现问题）
   */
  register(driver: ToolDriver): void {
    if (this.drivers.has(driver.name)) {
      throw new Error(`[ToolRegistry] 工具 "${driver.name}" 已注册，slug 不允许重复`);
    }
    this.drivers.set(driver.name, driver);
    console.log(`[ToolRegistry] 已注册工具: ${driver.name}`);
  }

  /**
   * 获取工具驱动
   *
   * @param slug - 工具标识
   * @returns 工具驱动实例，不存在则返回 undefined
   */
  get(slug: string): ToolDriver | undefined {
    return this.drivers.get(slug);
  }

  /**
   * 检查工具是否已注册
   */
  has(slug: string): boolean {
    return this.drivers.has(slug);
  }

  /**
   * 获取所有已注册的工具 slug 列表
   */
  list(): string[] {
    return Array.from(this.drivers.keys());
  }

  /**
   * 获取已注册的工具数量
   */
  get size(): number {
    return this.drivers.size;
  }
}

// ── 创建并注册所有工具 ───────────────────────────────────────────────────────

export const toolRegistry = new ToolRegistry();

// 注册示例工具（文本哈希生成器）
toolRegistry.register(exampleTool);

// ── 在此注册更多工具 ──
// import { jsonFormatter } from "./json-formatter";
// toolRegistry.register(jsonFormatter);
//
// import { urlEncoder } from "./url-encoder";
// toolRegistry.register(urlEncoder);
