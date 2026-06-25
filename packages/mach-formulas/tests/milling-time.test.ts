/**
 * 文件7《铣削工时制定参照表》— 铣削工时八步法 单元测试
 * 验证所有公式计算结果与Excel一致
 */

import { describe, it, expect } from 'vitest';
import {
  calculateMillingBase,
  MillingBaseParams,
  checkCuttingDepth,
  MillingToolMaterial,
  MillingOperationType,
  calculateCuttingAmount,
  CutterKind,
  calculateBasicTime,
  MillingMethod,
  calculateStepAuxiliaryTime,
  MillingOperationStep,
  getStepVariableTime,
  calculateLoadingTime,
  MountingMethod,
  MountingComplexity,
  calculateMillingTotalTime,
  MillingTimeResult,
  getCorrectionCoefficients,
  applyCorrection,
  getWeightGrade,
  getThinWallCorrection,
} from '../src/formulas/milling-time';

describe('铣削工时八步法 - 完整流程', () => {

  // ═══════════════════════════════════════════════════
  // 第一步：铣削参数计算
  // ═══════════════════════════════════════════════════

  it('第一步：铣削参数计算', () => {
    const params: MillingBaseParams = {
      cuttingWidth: 7,
      cuttingDepth: 6,
      workpieceLength: 25,
      feedPerTooth: 0.05,
      cutterDiameter: 7,
      cuttingSpeed: 20,
      cutterTeeth: 4,
    };

    const result = calculateMillingBase(params);

    // f = af × Z = 0.05 × 4 = 0.20 mm/rev
    expect(result.feedPerRev).toBe(0.2);
    
    // n = 1000 × V / (π × d0) = 1000 × 20 / (π × 7) ≈ 909.46
    expect(result.cuttingSpeedRPM).toBeCloseTo(909.46, 1);
    
    // Vf = f × n = 0.20 × 909.46 ≈ 181.89
    expect(result.feedRate).toBeCloseTo(181.89, 1);
  });

  // ═══════════════════════════════════════════════════
  // 第二步：铣削深度检查
  // ═══════════════════════════════════════════════════

  it('第二步：铣削深度合理性检查', () => {
    // 高速钢粗加工：推荐5-7mm
    const check1 = checkCuttingDepth(6, MillingToolMaterial.HighSpeedSteel, MillingOperationType.Rough);
    expect(check1.reasonable).toBe(true);
    expect(check1.min).toBe(5);
    expect(check1.max).toBe(7);

    // 超出范围
    const check2 = checkCuttingDepth(20, MillingToolMaterial.HighSpeedSteel, MillingOperationType.Rough);
    expect(check2.reasonable).toBe(false);

    // 硬质合金精加工：推荐0.2-0.5mm
    const check3 = checkCuttingDepth(0.3, MillingToolMaterial.Carbide, MillingOperationType.Finish);
    expect(check3.reasonable).toBe(true);
  });

  // ═══════════════════════════════════════════════════
  // 第三步：切入量/超出量计算
  // ═══════════════════════════════════════════════════

  it('第三步：圆柱铣刀切入量', () => {
    const result = calculateCuttingAmount(
      CutterKind.Cylindrical,
      7,   // Ac
      6,   // Ap
      7,   // d0
    );

    // L1 = √(6 × (7-6)) = √6 ≈ 2.45
    expect(result.L1).toBeCloseTo(2.45, 1);
    // L2 = 2.5
    expect(result.L2).toBe(2.5);
  });

  it('第三步：端铣刀切入量', () => {
    const result = calculateCuttingAmount(
      CutterKind.EndMill,
      30,  // Ac
      6,   // Ap (unused for end mill)
      50,  // d0
    );

    // L1 = 0.5 × (50 - √(2500-900)) = 0.5 × (50-40) = 5
    expect(result.L1).toBe(5);
    expect(result.L2).toBe(2.5);
  });

  it('第三步：立铣刀切入量', () => {
    const result = calculateCuttingAmount(
      CutterKind.VerticalMill,
      20,  // Ac (unused)
      6,   // Ap (unused)
      20,  // d0
    );

    // L1 = d0/2 = 10
    expect(result.L1).toBe(10);
    expect(result.L2).toBe(2.5);
  });

  // ═══════════════════════════════════════════════════
  // 第四步：基本时间计算
  // ═══════════════════════════════════════════════════

  it('第四步：铣平面基本时间', () => {
    // 示例1：L0=25, L1=10, L2=2.5, Vf=25, i=5
    const time = calculateBasicTime(MillingMethod.Plane, {
      length: 25,
      L1: 10,
      L2: 2.5,
      feedRate: 25,
      passes: 5,
    });

    // T基 = (25+10+2.5)/25 × 5 = 37.5/25 × 5 = 7.50
    expect(time).toBe(7.5);
  });

  it('第四步：铣平面基本时间（另一个示例）', () => {
    // L0=60, L1=5.83, L2=2.5, Vf=84, i=2
    const time = calculateBasicTime(MillingMethod.Plane, {
      length: 60,
      L1: 5.83,
      L2: 2.5,
      feedRate: 84,
      passes: 2,
    });

    // T基 = (60+5.83+2.5)/84 × 2 = 68.33/84 × 2 ≈ 1.63
    expect(time).toBeCloseTo(1.63, 1);
  });

  it('第四步：铣齿轮基本时间', () => {
    // Ac=45, Z=20, L1=2.5, L2=2.5, Vf=40
    const time = calculateBasicTime(MillingMethod.Gear, {
      length: 45,
      L1: 2.5,
      L2: 2.5,
      feedRate: 40,
      gearTeeth: 20,
    });

    // T基 = (45+2.5+2.5)/40 × 20 = 50/40 × 20 = 25.00
    expect(time).toBe(25);
  });

  // ═══════════════════════════════════════════════════
  // 第五步：辅助时间计算
  // ═══════════════════════════════════════════════════

  it('第五步：铣平面辅助时间', () => {
    // L=25，属于10-30档
    const time = calculateStepAuxiliaryTime(MillingOperationStep.Plane, 25);

    // Tf1 = 0.15, Tf2 = 0.05
    // T工辅 = 0.15 + 0.05 = 0.20
    expect(time).toBe(0.2);
  });

  it('第五步：铣侧面辅助时间（不同长度）', () => {
    // L=25，10-30档
    const time1 = calculateStepAuxiliaryTime(MillingOperationStep.Side, 25);
    expect(time1).toBe(0.24); // Tf1=0.18, Tf2=0.06

    // L=150，101-200档
    const time2 = calculateStepAuxiliaryTime(MillingOperationStep.Side, 150);
    expect(time2).toBeCloseTo(0.40); // Tf1=0.18, Tf2=0.22
  });

  it('第五步：铣键槽辅助时间', () => {
    // L=45，31-60档
    const time = calculateStepAuxiliaryTime(MillingOperationStep.Keyway, 45);

    // Tf1 = 0.22, Tf2 = 0.14
    // T工辅 = 0.22 + 0.14 = 0.36
    expect(time).toBe(0.36);
  });

  it('第五步：工步变量时间查表', () => {
    expect(getStepVariableTime(MillingOperationStep.Plane, 15)).toBe(0.05);
    expect(getStepVariableTime(MillingOperationStep.Plane, 50)).toBe(0.08);
    expect(getStepVariableTime(MillingOperationStep.Plane, 80)).toBe(0.12);
    expect(getStepVariableTime(MillingOperationStep.Plane, 150)).toBe(0.18);
    expect(getStepVariableTime(MillingOperationStep.Plane, 300)).toBe(0.30);
    expect(getStepVariableTime(MillingOperationStep.Plane, 600)).toBe(0.50);
  });

  // ═══════════════════════════════════════════════════
  // 第六步：装卸时间计算
  // ═══════════════════════════════════════════════════

  it('第六步：装卸时间计算', () => {
    // 3kg工件，虎钳装夹，简单程度
    const time = calculateLoadingTime(3, MountingMethod.Vice, MountingComplexity.Simple);
    expect(time).toBe(0.84);

    // 3kg工件，虎钳装夹，复杂程度
    const timeComplex = calculateLoadingTime(3, MountingMethod.Vice, MountingComplexity.Complex);
    expect(timeComplex).toBe(1.26);
  });

  it('第六步：不同重量档装卸时间', () => {
    // 0.5kg，分度头，简单
    const time1 = calculateLoadingTime(0.5, MountingMethod.DividingHead, MountingComplexity.Simple);
    expect(time1).toBe(0.72);

    // 8kg，分度头，简单
    const time2 = calculateLoadingTime(8, MountingMethod.DividingHead, MountingComplexity.Simple);
    expect(time2).toBe(1.80);

    // 16kg，螺栓压板，复杂
    const time3 = calculateLoadingTime(16, MountingMethod.BoltPlate, MountingComplexity.Complex);
    expect(time3).toBe(4.23);
  });

  it('第六步：重量档判断', () => {
    expect(getWeightGrade(0.3)).toBe('0.5');
    expect(getWeightGrade(1)).toBe('1');
    expect(getWeightGrade(2)).toBe('3'); // 1-3档
    expect(getWeightGrade(3)).toBe('3');
    expect(getWeightGrade(5)).toBe('5');
    expect(getWeightGrade(8)).toBe('8');
    expect(getWeightGrade(16)).toBe('16');
  });

  // ═══════════════════════════════════════════════════
  // 第七步：总工时计算
  // ═══════════════════════════════════════════════════

  it('第七步：铣削总工时计算（标准示例）', () => {
    const result = calculateMillingTotalTime({
      basicTime: 25.50,           // T基
      auxiliaryTime: 3,           // T工辅
      loadingTime: 1.50,          // T装卸
      wideRelaxationRate: 0.09,   // K宽放=9%
      batchQuantity: 10,          // N=10
    });

    // T工步 = 25.50 + 3 = 28.50
    expect(result.operationTime).toBe(28.50);
    
    // T作业 = 28.50 + 1.50 = 30.00
    expect(result.operationWorkTime).toBe(30.00);
    
    // T单件 = 30 × 1.09 = 32.70
    expect(result.singlePieceTime).toBe(32.70);
    
    // T批量 = 32.70 × 10 + 60 = 387.00
    expect(result.batchTime).toBe(387.00);
  });

  it('第七步：不同批量大小', () => {
    const result = calculateMillingTotalTime({
      basicTime: 25.50,
      auxiliaryTime: 3,
      loadingTime: 1.50,
      batchQuantity: 100,
      setupComplexity: 'medium',
    });

    // T工步 = 28.50
    // T作业 = 30.00
    // T单件 = 30 × 1.09 = 32.70
    // T批量 = 32.70 × 100 + 60 = 3330.00
    expect(result.batchTime).toBe(3330.00);
  });

  it('第七步：准备结束时间', () => {
    const result1 = calculateMillingTotalTime({
      basicTime: 25.50,
      auxiliaryTime: 3,
      loadingTime: 1.50,
      batchQuantity: 10,
      setupComplexity: 'simple',
    });

    expect(result1.setupTime).toBe(30);

    const result2 = calculateMillingTotalTime({
      basicTime: 25.50,
      auxiliaryTime: 3,
      loadingTime: 1.50,
      batchQuantity: 10,
      setupComplexity: 'complex',
    });

    expect(result2.setupTime).toBe(90);
  });

  // ═══════════════════════════════════════════════════
  // 第八步：修正系数
  // ═══════════════════════════════════════════════════

  it('第八步：薄壁件修正系数', () => {
    // 比值<=5
    expect(getThinWallCorrection(3, 4)).toBe(1.0);
    
    // 比值5-10
    expect(getThinWallCorrection(7, 8)).toBe(1.2);
    
    // 比值10-20
    expect(getThinWallCorrection(15, 18)).toBe(1.5);
    
    // 比值20-30
    expect(getThinWallCorrection(25, 28)).toBe(1.8);
    
    // 比值>30
    expect(getThinWallCorrection(35, 40)).toBe(2.2);
  });

  it('第八步：材料修正系数', () => {
    const coeffs = getCorrectionCoefficients({
      material: 'stainless_steel',
      batchSize: 100,
    });

    expect(coeffs.K2).toBe(1.4);
    expect(coeffs.K3).toBe(1.0); // 中批
  });

  it('第八步：批量修正系数', () => {
    const small = getCorrectionCoefficients({ material: 'carbon_steel', batchSize: 30 });
    expect(small.K3).toBe(1.6);

    const medium = getCorrectionCoefficients({ material: 'carbon_steel', batchSize: 200 });
    expect(medium.K3).toBe(1.0);

    const large = getCorrectionCoefficients({ material: 'carbon_steel', batchSize: 1000 });
    expect(large.K3).toBe(0.8);
  });

  it('第八步：完整修正系数获取', () => {
    const result = getCorrectionCoefficients({
      isThinWall: true,
      thinWallLengthRatio: 8,
      thinWallDiameterRatio: 6,
      material: 'titanium_alloy',
      batchSize: 10,
    });

    // K1 = 1.2 (max(8,6)在5-10范围)
    expect(result.K1).toBe(1.2);
    // K2 = 2.2 (钛合金)
    expect(result.K2).toBe(2.2);
    // K3 = 1.6 (小批量)
    expect(result.K3).toBe(1.6);
  });

  it('第八步：应用修正系数', () => {
    // 基准时间100，K1=1.2, K2=1.4, K3=1.6
    const result = applyCorrection(100, 1.2, 1.4, 1.6);
    
    // 修正后 = 100 × 1.2 × 1.4 × 1.6 = 268.8
    expect(result).toBe(268.8);
  });

  // ═══════════════════════════════════════════════════
  // 完整流程集成测试
  // ═══════════════════════════════════════════════════

  it('完整流程：铣平面工时全流程计算', () => {
    // 第一步：基础参数
    const baseParams: MillingBaseParams = {
      cuttingWidth: 50,
      cuttingDepth: 5,
      workpieceLength: 100,
      feedPerTooth: 0.1,
      cutterDiameter: 80,
      cuttingSpeed: 150,
      cutterTeeth: 16,
    };

    const baseResult = calculateMillingBase(baseParams);
    
    // 第三步：切入量（端铣刀）
    const cuttingAmount = calculateCuttingAmount(
      CutterKind.EndMill,
      50,
      5,
      80,
    );

    // 第四步：基本时间（铣平面）
    const basicTime = calculateBasicTime(MillingMethod.Plane, {
      length: 100,
      L1: cuttingAmount.L1,
      L2: cuttingAmount.L2,
      feedRate: baseResult.feedRate,
      passes: 2,
    });

    // 第五步：辅助时间
    const auxiliaryTime = calculateStepAuxiliaryTime(MillingOperationStep.Plane, 100);

    // 第六步：装卸时间（使用3kg，确保在查表范围内）
    const loadingTime = calculateLoadingTime(3, MountingMethod.Vice, MountingComplexity.Simple);

    // 第七步：总工时
    const totalTime = calculateMillingTotalTime({
      basicTime,
      auxiliaryTime,
      loadingTime,
      batchQuantity: 50,
    });

    // 第八步：应用修正（不锈钢）
    const coeffs = getCorrectionCoefficients({
      material: 'stainless_steel',
      batchSize: 50,
    });

    const correctedTime = applyCorrection(totalTime.batchTime, coeffs.K1, coeffs.K2, coeffs.K3);

    // 验证所有步骤都产生了有意义的数值
    expect(basicTime).toBeGreaterThan(0);
    expect(auxiliaryTime).toBeGreaterThan(0);
    expect(loadingTime).toBeGreaterThan(0);
    expect(totalTime.singlePieceTime).toBeGreaterThan(0);
    expect(correctedTime).toBeGreaterThan(0);
  });

});
