/**
 * 文件10《加工件費用計算表》— 综合报价+乘数体系 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  calculateProcessingFee,
  ProcessingTime,
  calculateMaterialWeight,
  BlankShape,
  calculateMaterialFee,
  calculateCompositeFactor,
  calculateComprehensiveQuote,
  MACHINE_RATE,
  MachineType,
} from '../src/formulas/comprehensive-quote';

describe('综合报价+乘数体系', () => {

  // ═══════════════════════════════════════════════════
  // 1. 加工费计算
  // ═══════════════════════════════════════════════════

  it('加工费计算', () => {
    const times: ProcessingTime = {
      cncTurning: 2,
      cncMilling: 3,
      wireCutSlow: 1,
      wireCutFast: 0,
      edm: 0.5,
      grinding: 1,
      conventional: 0,
    };

    const fee = calculateProcessingFee(times);

    // = 2×35 + 3×35 + 1×30 + 0 + 0.5×28 + 1×25 + 0
    // = 70 + 105 + 30 + 14 + 25 = 244
    expect(fee).toBe(244);
  });

  it('仅CNC车削', () => {
    const times: ProcessingTime = {
      cncTurning: 5,
      cncMilling: 0,
      wireCutSlow: 0,
      wireCutFast: 0,
      edm: 0,
      grinding: 0,
      conventional: 0,
    };

    const fee = calculateProcessingFee(times);
    // 5 × 35 = 175
    expect(fee).toBe(175);
  });

  // ═══════════════════════════════════════════════════
  // 2. 材料费计算
  // ═══════════════════════════════════════════════════

  it('方料重量计算', () => {
    const weight = calculateMaterialWeight(BlankShape.Square, {
      length: 100,
      width: 50,
      height: 30,
      material: 'steel',
    });

    // V = 100 × 50 × 30 = 150000 mm³
    // W = 150000 × 7.85 / 1e6 = 1.1775 kg
    expect(weight).toBeCloseTo(1.178, 2);
  });

  it('圆棒重量计算', () => {
    const weight = calculateMaterialWeight(BlankShape.Round, {
      length: 100,
      outerDiameter: 50,
      material: 'steel',
    });

    // V = π × 25² × 100 = 196349.54 mm³
    // W = 196349.54 × 7.85 / 1e6 ≈ 1.541 kg
    expect(weight).toBeCloseTo(1.541, 2);
  });

  it('圆管重量计算', () => {
    const weight = calculateMaterialWeight(BlankShape.Tube, {
      length: 100,
      outerDiameter: 50,
      innerDiameter: 30,
      material: 'aluminum',
    });

    // V = π × (25²-15²) × 100 = π × 400 × 100 = 125663.71 mm³
    // W = 125663.71 × 2.7 / 1e6 ≈ 0.339 kg
    expect(weight).toBeCloseTo(0.339, 2);
  });

  it('不同材料单价', () => {
    const weight = 1; // 1kg

    const steelFee = calculateMaterialFee(weight, 'steel');
    expect(steelFee).toBe(5);

    const titaniumFee = calculateMaterialFee(weight, 'titanium');
    expect(titaniumFee).toBe(180);

    const tungstenFee = calculateMaterialFee(weight, 'tungsten_carbide');
    expect(tungstenFee).toBe(280);
  });

  // ═══════════════════════════════════════════════════
  // 3. 乘数体系
  // ═══════════════════════════════════════════════════

  it('综合乘数计算', () => {
    // 中等复杂 × 中等精度 × 中等表面 × 小批量
    const factor = calculateCompositeFactor('medium', 'medium', 'medium', 20);

    // K1=1.2, K2=1.15, K3=1.1, K4=1.5
    // 乘数 = 1.2 × 1.15 × 1.1 × 1.5 = 2.277
    expect(factor).toBeCloseTo(2.277, 2);
  });

  it('不同复杂程度', () => {
    const simple = calculateCompositeFactor('simple', 'general', 'general', 1000);
    expect(simple).toBeCloseTo(1.0 * 1.0 * 1.0 * 1.0, 2); // K4=1.0（大批量）

    const ultra = calculateCompositeFactor('ultra_complex', 'ultra_high', 'mirror', 1);
    expect(ultra).toBeCloseTo(2.0 * 1.6 * 1.8 * 2.0, 2);
  });

  it('批量系数判断', () => {
    const single = calculateCompositeFactor('simple', 'general', 'general', 1);
    expect(single).toBe(2.0); // 单件K4=2.0

    const small = calculateCompositeFactor('simple', 'general', 'general', 50);
    expect(small).toBe(1.5); // K4=1.5

    const medium = calculateCompositeFactor('simple', 'general', 'general', 500);
    expect(medium).toBe(1.2); // K4=1.2

    const large = calculateCompositeFactor('simple', 'general', 'general', 10000);
    expect(large).toBe(1.0); // K4=1.0

    const mass = calculateCompositeFactor('simple', 'general', 'general', 50000);
    expect(mass).toBeCloseTo(0.85, 2); // K4=0.85
  });

  // ═══════════════════════════════════════════════════
  // 4. 综合报价
  // ═══════════════════════════════════════════════════

  it('综合报价计算（标准示例）', () => {
    const result = calculateComprehensiveQuote({
      processingFee: 500,
      materialFee: 200,
      complexity: 'medium',
      precision: 'high',
      surface: 'fine',
      batchSize: 100,
      profitMargin: 0.20,
      taxRate: 0.13,
    });

    // K1=1.2, K2=1.35, K3=1.25, K4=1.2
    // 综合乘数 = 1.2 × 1.35 × 1.25 × 1.2 = 2.43
    expect(result.compositeFactor).toBeCloseTo(2.43, 1);

    // 小计 = 500 + 200 = 700
    expect(result.subTotal).toBe(700);

    // 调整后 = 700 × 2.43 = 1701.00
    expect(result.adjustedFee).toBeCloseTo(1701.00, 1);

    // 最终 = 1701 × 1.33 = 2262.33
    expect(result.finalQuote).toBeCloseTo(2262.33, 1);
  });

  it('综合报价（简单情况）', () => {
    const result = calculateComprehensiveQuote({
      processingFee: 100,
      materialFee: 50,
      complexity: 'simple',
      precision: 'general',
      surface: 'general',
      batchSize: 1000,
    });

    // 乘数 = 1.0 × 1.0 × 1.0 × 1.0 = 1.0
    expect(result.compositeFactor).toBe(1.0);

    // 小计 = 150
    expect(result.subTotal).toBe(150);

    // 调整后 = 150 × 1.0 = 150
    expect(result.adjustedFee).toBe(150);

    // 最终 = 150 × 1.33 = 199.50
    expect(result.finalQuote).toBe(199.5);
  });

  it('综合报价（超复杂情况）', () => {
    const result = calculateComprehensiveQuote({
      processingFee: 2000,
      materialFee: 500,
      complexity: 'ultra_complex',
      precision: 'ultra_high',
      surface: 'mirror',
      batchSize: 1,
      profitMargin: 0.25,
      taxRate: 0.13,
    });

    // K1=2.0, K2=1.6, K3=1.8, K4=2.0
    // 乘数 = 2.0 × 1.6 × 1.8 × 2.0 = 11.52
    expect(result.compositeFactor).toBeCloseTo(11.52, 1);

    // 小计 = 2500
    expect(result.subTotal).toBe(2500);

    // 调整后 = 2500 × 11.52 = 28800
    expect(result.adjustedFee).toBeCloseTo(28800, 1);

    // 最终 = 28800 × 1.38 = 39744
    expect(result.finalQuote).toBeCloseTo(39744, 1);
  });

  // ═══════════════════════════════════════════════════
  // 5. 设备费率验证
  // ═══════════════════════════════════════════════════

  it('设备费率表验证', () => {
    expect(MACHINE_RATE[MachineType.CNC_TURN]).toBe(35);
    expect(MACHINE_RATE[MachineType.CNC_MILL]).toBe(35);
    expect(MACHINE_RATE[MachineType.WIRE_CUT_SLOW]).toBe(30);
    expect(MACHINE_RATE[MachineType.WIRE_CUT_FAST]).toBe(15);
    expect(MACHINE_RATE[MachineType.EDM]).toBe(28);
    expect(MACHINE_RATE[MachineType.GRINDING]).toBe(25);
    expect(MACHINE_RATE[MachineType.CONVENTIONAL_TURN]).toBe(18);
    expect(MACHINE_RATE[MachineType.CONVENTIONAL_MILL]).toBe(18);
  });

  // ═══════════════════════════════════════════════════
  // 集成测试
  // ═══════════════════════════════════════════════════

  it('完整报价流程', () => {
    // 1. 计算材料费
    const weight = calculateMaterialWeight(BlankShape.Round, {
      length: 100,
      outerDiameter: 40,
      material: 'stainless_steel',
    });

    const materialFee = calculateMaterialFee(weight, 'stainless_steel');

    // 2. 计算加工费
    const times: ProcessingTime = {
      cncTurning: 2,
      cncMilling: 1.5,
      wireCutSlow: 0,
      wireCutFast: 0,
      edm: 0.5,
      grinding: 1,
      conventional: 0,
    };

    const processingFee = calculateProcessingFee(times);

    // 3. 综合报价
    const quote = calculateComprehensiveQuote({
      processingFee,
      materialFee,
      complexity: 'complex',
      precision: 'high',
      surface: 'ultra_fine',
      batchSize: 50,
    });

    // 验证所有数值有意义
    expect(quote.processingFee).toBeGreaterThan(0);
    expect(quote.materialFee).toBeGreaterThan(0);
    expect(quote.compositeFactor).toBeGreaterThan(1);
    expect(quote.finalQuote).toBeGreaterThan(quote.subTotal);
  });

});
