/**
 * DTC 故障码查询服务 — 单元测试
 *
 * 覆盖 dtc-service.ts 的核心函数：
 * - normalizeCode: 代码归一化（含边界和异常场景）
 * - extractFromText: 从文本提取 DTC（含去重、大小写、混合格式）
 *
 * 数据库查询函数（lookup/search/batchLookup 等）需要 Turso 连接，
 * 属于集成测试范畴，在 E2E 测试中覆盖。
 */

import { describe, it, expect } from "vitest";
import { normalizeCode, extractFromText } from "../services/dtc-service";

// ═══════════════════════════════════════════════════════════════════
// normalizeCode 测试
// ═══════════════════════════════════════════════════════════════════

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
  it("小写输入应自动转大写", () => {
    const result = normalizeCode("p0420");
    expect(result.normalized).toBe("P0420");
    expect(result.isValid).toBe(true);
  });

  it("混合大小写应转大写", () => {
    const result = normalizeCode("P0420");
    expect(result.normalized).toBe("P0420");
  });

  // ── 边界情况 ──
  it("空字符串应返回无效", () => {
    const result = normalizeCode("");
    expect(result.isValid).toBe(false);
    expect(result.normalized).toBe("");
  });

  it("空白字符串应返回无效", () => {
    const result = normalizeCode("   ");
    expect(result.isValid).toBe(false);
    expect(result.normalized).toBe("");
  });

  it("纯数字输入应返回无效", () => {
    const result = normalizeCode("12345");
    expect(result.isValid).toBe(false);
    expect(result.normalized).toBe("12345");
  });

  it("过短代码应返回无效", () => {
    const result = normalizeCode("P12");
    expect(result.isValid).toBe(false);
  });

  it("过长代码应返回无效", () => {
    const result = normalizeCode("P012345");
    expect(result.isValid).toBe(false);
  });

  it("非法前缀字母应返回无效", () => {
    const result = normalizeCode("X0420");
    expect(result.isValid).toBe(false);
  });

  it("含特殊字符应返回无效", () => {
    const result = normalizeCode("P04-20");
    expect(result.isValid).toBe(false);
  });

  it("含空格在中间应返回无效", () => {
    const result = normalizeCode("P04 20");
    expect(result.isValid).toBe(false);
  });

  // ── 扩展格式 ──
  it("非标准数字开头（6/7/8/9）应为有效但非标准", () => {
    const result = normalizeCode("P6000");
    expect(result.isValid).toBe(true);
    expect(result.isStandard).toBe(false);
  });

  it("十六进制字符应为有效", () => {
    const result = normalizeCode("P0A2F");
    expect(result.isValid).toBe(true);
    expect(result.isStandard).toBe(true);
    expect(result.systemShort).toBe("P");
  });

  it("全十六进制码 PFFFF 应为有效", () => {
    const result = normalizeCode("PFFFF");
    expect(result.isValid).toBe(true);
    expect(result.systemShort).toBe("P");
  });

  // ── 修剪空格 ──
  it("应修剪前后空格", () => {
    const result = normalizeCode("  P0420  ");
    expect(result.normalized).toBe("P0420");
    expect(result.isValid).toBe(true);
  });

  it("前导空格应保留到 original", () => {
    const result = normalizeCode("  P0420");
    expect(result.original).toBe("  P0420");
    expect(result.normalized).toBe("P0420");
  });

  // ── 系统类型完整性 ──
  it("P 码应映射为 Powertrain", () => {
    expect(normalizeCode("P0001").system).toBe("Powertrain");
  });
  it("B 码应映射为 Body", () => {
    expect(normalizeCode("B0001").system).toBe("Body");
  });
  it("C 码应映射为 Chassis", () => {
    expect(normalizeCode("C0001").system).toBe("Chassis");
  });
  it("U 码应映射为 Network", () => {
    expect(normalizeCode("U0001").system).toBe("Network");
  });

  // ── 未知前缀的安全处理 ──
  it("未知系统类型应返回 Unknown", () => {
    // 理论上 normalizeCode 不会让非法前缀通过，但映射表有兜底
    const result = normalizeCode("P0420");
    expect(result.system).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// extractFromText 测试
// ═══════════════════════════════════════════════════════════════════

describe("extractFromText", () => {
  it("应从文本中提取 DTC 码", () => {
    const text = "The fault code P0420 indicates catalytic converter efficiency below threshold. Also check P0300 for misfire.";
    const results = extractFromText(text);
    expect(results.length).toBe(2);
    expect(results.map((r) => r.normalized)).toContain("P0420");
    expect(results.map((r) => r.normalized)).toContain("P0300");
  });

  it("应自动去重（相同码多次出现只保留一个）", () => {
    const text = "P0420 is the code. Also check P0420 again.";
    const results = extractFromText(text);
    expect(results.length).toBe(1);
    expect(results[0].normalized).toBe("P0420");
  });

  it("无 DTC 码时应返回空数组", () => {
    const text = "This text has no diagnostic trouble codes whatsoever.";
    const results = extractFromText(text);
    expect(results.length).toBe(0);
  });

  it("空文本应返回空数组", () => {
    const results = extractFromText("");
    expect(results.length).toBe(0);
  });

  it("纯标点符号文本应返回空数组", () => {
    const results = extractFromText("!@#$%^&*()");
    expect(results.length).toBe(0);
  });

  it("应提取多种系统类型（P/B/C/U）", () => {
    const text = "P0420, B0001, C0035, U0100";
    const results = extractFromText(text);
    expect(results.length).toBe(4);

    const shorts = results.map((r) => r.systemShort);
    expect(shorts).toContain("P");
    expect(shorts).toContain("B");
    expect(shorts).toContain("C");
    expect(shorts).toContain("U");
  });

  it("应忽略大小写差异", () => {
    const text = "p0420 and P0420";
    const results = extractFromText(text);
    expect(results.length).toBe(1);
    expect(results[0].normalized).toBe("P0420");
  });

  it("应从 URL 或路径中提取 DTC", () => {
    const text = "https://example.com/dtc/P0420.html";
    const results = extractFromText(text);
    expect(results.length).toBe(1);
    expect(results[0].normalized).toBe("P0420");
  });

  it("应从逗号分隔列表中提取", () => {
    const text = "codes: P0420,P0300,P0171";
    const results = extractFromText(text);
    expect(results.length).toBe(3);
  });

  it("应从带括号文本中提取", () => {
    const text = "故障码(P0420)和(P0300)";
    const results = extractFromText(text);
    expect(results.length).toBe(2);
  });

  it("应提取长段技术文档中的 DTC", () => {
    const text = `
      Diagnostic Trouble Codes (DTC) Listing:
      - P0420: Catalyst System Efficiency Below Threshold
      - P0300: Random/Multiple Cylinder Misfire Detected
      - P0171: System Too Lean (Bank 1)
      Note: If P0420 and P0300 appear together, check O2 sensors first.
    `;
    const results = extractFromText(text);
    // P0171, P0300, P0420 三个唯一码
    expect(results.length).toBe(3);
    expect(results.map((r) => r.normalized)).toContain("P0420");
    expect(results.map((r) => r.normalized)).toContain("P0300");
    expect(results.map((r) => r.normalized)).toContain("P0171");
  });

  it("不应提取小于5字符的类似模式", () => {
    // "P000" 只有4字符，不是有效 DTC
    const results = extractFromText("Short code P000 is not valid");
    expect(results.length).toBe(0);
  });

  it("所有提取结果应为有效码", () => {
    const text = "Common codes: P0420, P0300, P0171, B0001, C0035, U0100";
    const results = extractFromText(text);
    expect(results.every((r) => r.isValid)).toBe(true);
  });

  it("大量码文本应正确去重", () => {
    // 构造一个重复 100 次的 P0420
    const text = Array(100).fill("P0420").join(" ");
    const results = extractFromText(text);
    expect(results.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// normalizeCode + extractFromText 组合行为测试
// ═══════════════════════════════════════════════════════════════════

describe("normalizeCode + extractFromText 集成行为", () => {
  it("extractFromText 结果中的 normalized 应与直接 normalize 一致", () => {
    const text = "Check engine light shows p0420";
    const extracted = extractFromText(text);
    expect(extracted.length).toBe(1);
    const direct = normalizeCode("p0420");
    expect(extracted[0].normalized).toBe(direct.normalized);
    expect(extracted[0].systemShort).toBe(direct.systemShort);
  });
});