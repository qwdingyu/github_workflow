/**
 * 文件9《CNC电脑车加工参数》— 8种车削方式 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  calculateExternalTurning,
  calculateInternalTurning,
  calculateTaperTurning,
  calculateThreadTurning,
  calculateGroove,
  calculateDrilling,
  calculateBoring,
  calculateFormTurning,
  calculateTotalTurningTime,
} from '../src/formulas/turning-formulas';

describe('8种车削方式工时计算', () => {

  // ═══════════════════════════════════════════════════
  // 1. 车外圆
  // ═══════════════════════════════════════════════════

  it('车外圆工时计算', () => {
    const time = calculateExternalTurning({
      diameter: 200,
      length: 30,
      cuttingSpeed: 60,
      feedPerRev: 0.2,
      cuttingDepth: 3,
      allowance: 2,
      numPasses: 2,
    });

    // L总 = 30 + 2 = 32
    // N = 1000 × 60 / (π × 200) ≈ 95.49
    // T = 32 / (95.49 × 0.2) × 2 ≈ 3.35
    expect(time).toBeCloseTo(3.35, 1);
  });

  it('车外圆单道加工', () => {
    const time = calculateExternalTurning({
      diameter: 50,
      length: 20,
      cuttingSpeed: 80,
      feedPerRev: 0.15,
      numPasses: 1,
    });

    // L总 = 22
    // N = 1000 × 80 / (π × 50) ≈ 509.30
    // T = 22 / (509.30 × 0.15) ≈ 0.29
    expect(time).toBeCloseTo(0.29, 1);
  });

  // ═══════════════════════════════════════════════════
  // 2. 车内孔
  // ═══════════════════════════════════════════════════

  it('车内孔（盲孔）', () => {
    const time = calculateInternalTurning({
      diameter: 50,
      length: 40,
      cuttingSpeed: 45,
      feedPerRev: 0.15,
      blindDepth: true,
      numPasses: 3,
    });

    // 安全距离=10
    // L总 = 40 + 10 = 50
    // N = 1000 × 45 / (π × 50) ≈ 286.48
    // T = 50 / (286.48 × 0.15) × 3 ≈ 3.50
    expect(time).toBeCloseTo(3.50, 1);
  });

  it('车内孔（通孔）', () => {
    const time = calculateInternalTurning({
      diameter: 30,
      length: 25,
      cuttingSpeed: 50,
      feedPerRev: 0.1,
      blindDepth: false,
      numPasses: 2,
    });

    // 安全距离=3
    // L总 = 25 + 3 = 28
    // N = 1000 × 50 / (π × 30) ≈ 530.52
    // T = 28 / (530.52 × 0.1) × 2 ≈ 1.06
    expect(time).toBeCloseTo(1.06, 1);
  });

  // ═══════════════════════════════════════════════════
  // 3. 车锥度
  // ═══════════════════════════════════════════════════

  it('车锥度工时计算', () => {
    const time = calculateTaperTurning({
      largeDiameter: 100,
      smallDiameter: 80,
      taperLength: 50,
      cuttingSpeed: 60,
      feedPerRev: 0.2,
      numPasses: 2,
    });

    // D平均 = 90
    // N = 1000 × 60 / (π × 90) ≈ 212.21
    // T = 50 / (212.21 × 0.2) × 2 ≈ 2.36
    expect(time).toBeCloseTo(2.36, 1);
  });

  // ═══════════════════════════════════════════════════
  // 4. 车螺纹
  // ═══════════════════════════════════════════════════

  it('车螺纹工时计算', () => {
    const time = calculateThreadTurning({
      nominalDiameter: 20,
      pitch: 2.5,
      length: 30,
      cuttingSpeed: 20,
      numPasses: 6,
    });

    // Dh = 20 - 0.13 × 2.5 = 19.675
    // N螺纹 = 20 / 0.8 = 25 rpm
    // T = 30 / 25 × 6 = 7.20
    expect(time).toBeCloseTo(7.20, 1);
  });

  // ═══════════════════════════════════════════════════
  // 5. 切槽
  // ═══════════════════════════════════════════════════

  it('切槽工时计算', () => {
    const time = calculateGroove({
      diameter: 80,
      grooveWidth: 5,
      cuttingSpeed: 30,
      feedPerRev: 0.05,
      numPasses: 1,
    });

    // N = 1000 × 30 / (π × 80) ≈ 119.37
    // T = 5 / (119.37 × 0.05) × 1 ≈ 0.84
    expect(time).toBeCloseTo(0.84, 1);
  });

  // ═══════════════════════════════════════════════════
  // 6. 钻孔
  // ═══════════════════════════════════════════════════

  it('钻孔工时计算', () => {
    const time = calculateDrilling({
      diameter: 10,
      length: 25,
      cuttingSpeed: 30,
      feedPerRev: 0.15,
      numPasses: 1,
    });

    // N = 1000 × 30 / (π × 10) ≈ 954.93
    // T = 25 / (954.93 × 0.15) ≈ 0.17
    expect(time).toBeCloseTo(0.17, 1);
  });

  // ═══════════════════════════════════════════════════
  // 7. 镗孔
  // ═══════════════════════════════════════════════════

  it('镗孔工时计算', () => {
    const time = calculateBoring({
      diameter: 50,
      length: 40,
      cuttingSpeed: 50,
      feedPerRev: 0.1,
      numPasses: 3,
    });

    // L总 = 40 + 3 = 43
    // N = 1000 × 50 / (π × 50) ≈ 318.31
    // T = 43 / (318.31 × 0.1) × 3 ≈ 4.05
    expect(time).toBeCloseTo(4.05, 1);
  });

  // ═══════════════════════════════════════════════════
  // 8. 车成形面
  // ═══════════════════════════════════════════════════

  it('车成形面工时计算', () => {
    const time = calculateFormTurning({
      diameter: 100,
      length: 50,
      cuttingSpeed: 40,
      feedPerRev: 0.1,
      numPasses: 3,
      correctionFactor: 1.3,
    });

    // L总 = 50 + 2 = 52
    // N = 1000 × 40 / (π × 100) ≈ 127.32
    // T = 52 / (127.32 × 0.1) × 3 × 1.3 ≈ 15.93
    expect(time).toBeCloseTo(15.93, 1);
  });

  // ═══════════════════════════════════════════════════
  // 总工时汇总
  // ═══════════════════════════════════════════════════

  it('总工时汇总', () => {
    const result = calculateTotalTurningTime({
      externalTurning: 3.35,
      internalTurning: 3.50,
      taperTurning: 2.36,
      threadTurning: 7.20,
      groove: 0.84,
      drilling: 0.17,
      boring: 4.05,
      formTurning: 16.17,
    });

    expect(result.totalTime).toBeCloseTo(37.64, 1);
    expect(result.externalTurning).toBe(3.35);
  });

  it('多种参数组合验证', () => {
    // 验证不同参数下的计算一致性
    const time1 = calculateExternalTurning({
      diameter: 100,
      length: 50,
      cuttingSpeed: 60,
      feedPerRev: 0.2,
      numPasses: 1,
    });

    const time2 = calculateExternalTurning({
      diameter: 100,
      length: 50,
      cuttingSpeed: 60,
      feedPerRev: 0.2,
      numPasses: 2,
    });

    // 道数翻倍，时间也翻倍
    expect(time2).toBeCloseTo(time1 * 2, 1);
  });

});
