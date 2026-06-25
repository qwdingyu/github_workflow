/**
 * 文件5《加工工时工价估算》单元测试
 * 验证所有工时计算公式的正确性
 * 测试数据来自 /Users/dingyuwang/Downloads/9-教育/数控报价表/加工工时工价估算.xls
 */

import { describe, it, expect } from 'vitest';
import {
  calculateProcessTime,
  calculateProcessFee,
  calculateToolChangeTime,
  calculateMaterialCost,
  calculateQuoteTotal,
  calculateAnnualAvailableHours,
  EQUIPMENT_RATES,
  ToolType,
  ProcessType,
  WORK_DAYS_PER_YEAR,
  HOURS_PER_DAY,
  OEE_RATE,
} from '../src/formulas/process-time';

/** ProcessInput 别名，用于测试中的类型注解 */
type ProcessInput = Parameters<typeof calculateProcessTime>[0];

describe('换刀时间计算', () => {
  it('2个刀具, 1个工件 → 16秒', () => {
    const time = calculateToolChangeTime(2, 1);
    expect(time).toBe(16); // 2 * 8 * 2 / 1 = 16
  });

  it('4个刀具, 1个工件 → 32秒', () => {
    const time = calculateToolChangeTime(4, 1);
    expect(time).toBe(32); // 2 * 8 * 4 / 1 = 64
  });

  it('2个刀具, 10个工件 → 1.6秒/件', () => {
    const time = calculateToolChangeTime(2, 10);
    expect(time).toBe(1.6); // 8 * 2 / 10 = 1.6
  });
});

describe('工序时间计算', () => {
  it('立铣刀示例：转速2000, 每转进给0.15, 长度100, 走刀5次 → 100秒切削', () => {
    const info: ProcessInput = {
      sequence: 1,
      processType: ProcessType.Milling,
      toolType: ToolType.EndMill,
      speed: 2000,
      feedPerRev: 0.15,
      cuttingLength: 100,
      passes: 5,
      toolCount: 1,
      workpieceCount: 1,
      loadingUnloading: 'simple',
    };
    // 进给速度 = 2000 × 0.15 = 300 mm/min
    // 切削时间 = 100 / 300 × 5 × 60 = 100秒
    const time = calculateProcessTime(info);
    expect(time).toBeCloseTo(100 + 8 + 80, 1); // 切削100 + 换刀16 + 上下料80
  });

  it('钻头示例：转速500, 每转进给0.1, 长度50 → 600秒', () => {
    const info: ProcessInput = {
      sequence: 1,
      processType: ProcessType.Drilling,
      toolType: ToolType.Drill,
      speed: 500,
      feedPerRev: 0.1,
      cuttingLength: 50,
      passes: 1,
      toolCount: 1,
      workpieceCount: 1,
      loadingUnloading: 'medium',
    };
    // 进给速度 = 500 × 0.1 = 50 mm/min
    // 切削时间 = 50 / 50 × 1 × 60 = 60秒
    const time = calculateProcessTime(info);
    expect(time).toBeCloseTo(60 + 8 + 120, 1); // 切削60 + 换刀8 + 上下料120
  });

  it('进给速度为0 → 返回0', () => {
    const info: ProcessInput = {
      sequence: 1,
      processType: ProcessType.Milling,
      toolType: ToolType.EndMill,
      speed: 0,
      feedPerRev: 0,
      cuttingLength: 100,
      passes: 1,
      toolCount: 1,
      workpieceCount: 1,
      loadingUnloading: 'simple',
    };
    expect(calculateProcessTime(info)).toBe(0);
  });
});

describe('设备费率', () => {
  it('立铣刀费率 0.025元/秒', () => {
    expect(EQUIPMENT_RATES[ToolType.EndMill]).toBe(0.025);
  });

  it('钻头费率 0.02元/秒', () => {
    expect(EQUIPMENT_RATES[ToolType.Drill]).toBe(0.02);
  });

  it('枪钻费率 0.04元/秒', () => {
    expect(EQUIPMENT_RATES[ToolType.GunDrill]).toBe(0.04);
  });
});

describe('材料费计算', () => {
  it('材料100元, 加工费500元 → 100+500×5% = 125元', () => {
    const cost = calculateMaterialCost(100, 500);
    expect(cost).toBe(125);
  });

  it('材料0元, 加工费0元 → 0元', () => {
    const cost = calculateMaterialCost(0, 0);
    expect(cost).toBe(0);
  });
});

describe('年度产能计算', () => {
  it('300天×20.5小时×85% = 5227.5小时', () => {
    const hours = calculateAnnualAvailableHours();
    expect(hours).toBeCloseTo(5227.5, 1); // 300 * 20.5 * 0.85 = 5227.5
  });

  it('常量验证', () => {
    expect(WORK_DAYS_PER_YEAR).toBe(300);
    expect(HOURS_PER_DAY).toBe(20.5);
    expect(OEE_RATE).toBe(0.85);
  });
});

describe('完整报价计算', () => {
  it('单工序报价', () => {
    const processes: ProcessInput[] = [{
      sequence: 1,
      processType: ProcessType.Milling,
      toolType: ToolType.EndMill,
      speed: 2000,
      feedPerRev: 0.15,
      cuttingLength: 100,
      passes: 1,
      toolCount: 1,
      workpieceCount: 1,
      loadingUnloading: 'simple',
    }];
    const total = calculateQuoteTotal(processes, 50);
    expect(total.processes.length).toBe(1);
    expect(total.materialCost).toBeGreaterThan(50);
    expect(total.grandTotal).toBeGreaterThan(0);
  });
});
