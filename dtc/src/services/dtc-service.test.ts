/**
 * DTC 故障码查询服务 — 单元测试
 *
 * 测试 dtc-service.ts 的核心业务逻辑：
 * - normalizeCode: 代码归一化
 * - extractFromText: 从文本提取 DTC
 *  注：数据库查询函数（lookup/search/batch 等）需要 Turso 连接，
 *  在 miniflare 环境下通过 mock 测试。
 */

import { describe, it, expect } from "vitest";
import { normalizeCode, extractFromText } from "../services/dtc-service";

describe("normalizeCode", () => {
  // ── 标准格式 ──
  it("应正确归一化标准 P 码", () => {
    const result = normalizeCode("P0420");
    expect(result.normalized).toBe("P0420");
    expect(result.isValid).toBe(true);
    expect(result.systemShort).toBe("P");
    expect(result.system).toBe("Powertrain");
    expect(result.isStandard).toBe(true);
  });

  it("应正确归一化 B 码", () => {
    const result = normalizeCode("B0001");
    expect(result.normalized).toBe("B0001");
    expect(result.isValid).toBe(true);
    expect(result.systemShort).toBe("B");
    expect(result.system).toBe("Body");
  });

  it("应正确归一化 C 码", () => {
    const result = normalizeCode("C0035");
    expect(result.normalized).toBe("C0035");
    expect(result.isValid).toBe(true);
    expect(result.systemShort).toBe("C");
    expect(result.system).toBe("Chassis");
  });

  it("应正确归一化 U 码", () => {
    const result = normalizeCode("U0100");
    expect(result.normalized).toBe("U0100");
    expect(result.isValid).toBe(true);
    expect(result.systemShort).toBe("U");
    expect(result.system).toBe("Network");
  });

  // ── 大小写 ──
  it("应自动转大写", () => {
    const result = normalizeCode("p0420");
    expect(result.normalized).toBe("P0420");
    expect(result.isValid).toBe(true);
  });

  // ── 边界情况 ──
  it("应处理空白输入", () => {
    const result = normalizeCode("");
    expect(result.isValid).toBe(false);
    expect(result.normalized).toBe("");
  });

  it("应处理无效输入", () => {
    const result = normalizeCode("12345");
    expect(result.isValid).toBe(false);
    expect(result.normalized).toBe("12345");
  });

  it("应处理过短代码", () => {
    const result = normalizeCode("P12");
    expect(result.isValid).toBe(false);
  });

  it("应处理过长代码", () => {
    const result = normalizeCode("P012345");
    expect(result.isValid).toBe(false);
  });

  // ── 扩展格式 ──
  it("应接受非标准数字（6/7/8/9开头）为有效但非标准", () => {
    const result = normalizeCode("P6000");
    expect(result.isValid).toBe(true);
    expect(result.isStandard).toBe(false);
  });

  // ── 修剪空格 ──
  it("应修剪前后空格", () => {
    const result = normalizeCode("  P0420  ");
    expect(result.normalized).toBe("P0420");
    expect(result.isValid).toBe(true);
  });

  // ── 保留原始输入 ──
  it("应保留原始输入", () => {
    const result = normalizeCode("  p0420  ");
    expect(result.original).toBe("  p0420  ");
  });
});

describe("extractFromText", () => {
  it("应从文本中提取 DTC 码", () => {
    const text = "The fault code P0420 indicates catalytic converter efficiency below threshold. Also check P0300 for misfire.";
    const results = extractFromText(text);
    expect(results.length).toBe(2);
    expect(results.map((r) => r.normalized)).toContain("P0420");
    expect(results.map((r) => r.normalized)).toContain("P0300");
  });

  it("应自动去重", () => {
    const text = "P0420 is the code. Also check P0420 again.";
    const results = extractFromText(text);
    expect(results.length).toBe(1);
  });

  it("无 DTC 码时应返回空数组", () => {
    const text = "This text has no diagnostic trouble codes.";
    const results = extractFromText(text);
    expect(results.length).toBe(0);
  });

  it("空文本应返回空数组", () => {
    const results = extractFromText("");
    expect(results.length).toBe(0);
  });

  it("应提取多种系统类型", () => {
    const text = "P0420, B0001, C0035, U0100";
    const results = extractFromText(text);
    expect(results.length).toBe(4);

    const shorts = results.map((r) => r.systemShort);
    expect(shorts).toContain("P");
    expect(shorts).toContain("B");
    expect(shorts).toContain("C");
    expect(shorts).toContain("U");
  });

  it("应忽略大小写", () => {
    const text = "p0420 and P0420";
    const results = extractFromText(text);
    expect(results.length).toBe(1);
    expect(results[0].normalized).toBe("P0420");
  });
});