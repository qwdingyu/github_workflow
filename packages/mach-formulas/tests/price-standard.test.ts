/**
 * 文件4《加工价格标准》单元测试
 * 验证所有机加工单价公式的正确性
 * 测试数据来自 /Users/dingyuwang/Downloads/9-教育/数控报价表/加工价格标准.xls
 */

import { describe, it, expect } from 'vitest';
import {
  calculateSlowWireCuttingFee,
  calculateSlowWireHoleFee,
  calculateFastWireFee,
  calculateEDSFee,
  calculateMachineTimeFee,
  getPlateThicknessMultiplier,
  getCopperWireMultiplier,
  calculateQuote,
  SlowWireMaterial,
  SlowWirePrecision,
  ProcessingMachineType,
  SLOW_WIRE_MIN_PRICE,
  MACHINE_HOURLY_RATES,
} from '../src/formulas/price-standard';

describe('慢走丝线割加工', () => {
  it('钢材一修一 1000mm² → 20元，但低于最低收费40元 → 取40元', () => {
    const fee = calculateSlowWireCuttingFee(1000, SlowWireMaterial.Steel, SlowWirePrecision.OneRepairOne);
    expect(fee).toBe(40); // max(40, 1000*0.020) = max(40, 20) = 40
  });

  it('钢材一修二 1500mm² → 37.5元，低于最低收费40元 → 取40元', () => {
    const fee = calculateSlowWireCuttingFee(1500, SlowWireMaterial.Steel, SlowWirePrecision.OneRepairTwo);
    expect(fee).toBe(40); // max(40, 1500*0.025) = max(40, 37.5) = 40
  });

  it('钢材一修二 3000mm² → 75元，高于最低收费 → 取75元', () => {
    const fee = calculateSlowWireCuttingFee(3000, SlowWireMaterial.Steel, SlowWirePrecision.OneRepairTwo);
    expect(fee).toBe(75); // max(40, 3000*0.025) = max(40, 75) = 75
  });

  it('铜电极一修三 5000mm² → 185元', () => {
    const fee = calculateSlowWireCuttingFee(5000, SlowWireMaterial.CopperElectrode, SlowWirePrecision.OneRepairThree);
    expect(fee).toBe(185); // max(40, 5000*0.037) = 185
  });

  it('钨钢一修一 2000mm² → 66元', () => {
    const fee = calculateSlowWireCuttingFee(2000, SlowWireMaterial.Tungsten, SlowWirePrecision.OneRepairOne);
    expect(fee).toBe(66); // max(40, 2000*0.033) = 66
  });

  it('极小面积 → 取最低收费', () => {
    const fee = calculateSlowWireCuttingFee(100, SlowWireMaterial.Steel, SlowWirePrecision.OneCut);
    expect(fee).toBe(40); // max(40, 100*0.017) = 40
  });

  it('最低收费常量验证', () => {
    expect(SLOW_WIRE_MIN_PRICE).toBe(40);
  });
});

describe('慢走丝割孔', () => {
  it('5个孔无斜度 → 60元（5×12）', () => {
    const fee = calculateSlowWireHoleFee(5, 0);
    expect(fee).toBe(60); // 5 * 12 * 1 = 60
  });

  it('15个孔无斜度 → 150元（15×10）', () => {
    const fee = calculateSlowWireHoleFee(15, 0);
    expect(fee).toBe(150); // 15 * 10 * 1 = 150
  });

  it('5个孔3°斜度 → 90元（5×12×1.5）', () => {
    const fee = calculateSlowWireHoleFee(5, 3);
    expect(fee).toBe(90); // 5 * 12 * 1.5 = 90
  });

  it('10个孔10°斜度 → 240元（10×12×2）', () => {
    const fee = calculateSlowWireHoleFee(10, 10);
    expect(fee).toBe(240); // 10 <= 10, 12元/孔, 10°在5-15°区间2倍 → 10 * 12 * 2 = 240
  });

  it('刚好10个孔 → 按12元/孔计价', () => {
    const fee = calculateSlowWireHoleFee(10, 0);
    expect(fee).toBe(120); // 10 * 12 = 120
  });

  it('刚好11个孔 → 按10元/孔计价', () => {
    const fee = calculateSlowWireHoleFee(11, 0);
    expect(fee).toBe(110); // 11 * 10 = 110
  });

  it('斜度边界：2°以下不倍率', () => {
    const fee = calculateSlowWireHoleFee(5, 2);
    expect(fee).toBe(60); // 2°不在2-5°区间内
  });

  it('斜度边界：5°按1.5倍', () => {
    const fee = calculateSlowWireHoleFee(5, 5);
    expect(fee).toBe(90); // 5°在2-5°区间内
  });

  it('斜度边界：15°按2倍', () => {
    const fee = calculateSlowWireHoleFee(5, 15);
    expect(fee).toBe(120); // 15°在5-15°区间内
  });

  it('斜度超过15° → 仍按2倍（无更高级）', () => {
    const fee = calculateSlowWireHoleFee(5, 20);
    expect(fee).toBe(120); // 20°超过15°，仍取2倍
  });
});

describe('快走丝加工', () => {
  it('仅小孔5个 → 22.5元', () => {
    const fee = calculateFastWireFee(5, 0);
    expect(fee).toBe(22.5); // 5 * 4.5 = 22.5
  });

  it('仅线长1000mm² → 4.5元', () => {
    const fee = calculateFastWireFee(0, 1000);
    expect(fee).toBe(4.5); // 1000 * 0.0045 = 4.5
  });

  it('小孔3个+线长500mm² → 15.75元', () => {
    const fee = calculateFastWireFee(3, 500);
    expect(fee).toBe(15.75); // 3*4.5 + 500*0.0045 = 13.5 + 2.25 = 15.75
  });

  it('无小孔无线长 → 0元', () => {
    const fee = calculateFastWireFee(0, 0);
    expect(fee).toBe(0);
  });
});

describe('细孔放电加工', () => {
  it('3个孔厚度30mm → 6元，但低于最低40元 → 取40元', () => {
    const fee = calculateEDSFee(3, 30);
    expect(fee).toBe(40); // max(40, 3*2) = 40
  });

  it('10个孔厚度30mm → 20元，低于最低40元 → 取40元', () => {
    const fee = calculateEDSFee(10, 30);
    expect(fee).toBe(40); // max(40, 10*2) = 40
  });

  it('30个孔厚度30mm → 60元，高于最低40元 → 取60元', () => {
    const fee = calculateEDSFee(30, 30);
    expect(fee).toBe(60); // max(40, 30*2) = 60
  });

  it('5个孔厚度80mm → 15元，低于最低40元 → 取40元', () => {
    const fee = calculateEDSFee(5, 80);
    expect(fee).toBe(40); // max(40, 5*3) = 40
  });

  it('20个孔厚度80mm → 60元，高于最低40元 → 取60元', () => {
    const fee = calculateEDSFee(20, 80);
    expect(fee).toBe(60); // max(40, 20*3) = 60
  });
});

describe('各加工方式小时费率', () => {
  it('铣床2小时 → 70元', () => {
    expect(calculateMachineTimeFee(ProcessingMachineType.Milling, 2)).toBe(70);
  });

  it('CNC加工3.5小时 → 210元', () => {
    expect(calculateMachineTimeFee(ProcessingMachineType.CNC, 3.5)).toBe(210);
  });

  it('电火花1小时 → 18元', () => {
    expect(calculateMachineTimeFee(ProcessingMachineType.EDM, 1)).toBe(18);
  });

  it('编程5小时 → 225元', () => {
    expect(calculateMachineTimeFee(ProcessingMachineType.Programming, 5)).toBe(225);
  });

  it('所有费率验证', () => {
    expect(MACHINE_HOURLY_RATES[ProcessingMachineType.Milling]).toBe(35);
    expect(MACHINE_HOURLY_RATES[ProcessingMachineType.Grinder]).toBe(35);
    expect(MACHINE_HOURLY_RATES[ProcessingMachineType.EDM]).toBe(18);
    expect(MACHINE_HOURLY_RATES[ProcessingMachineType.CNC]).toBe(60);
    expect(MACHINE_HOURLY_RATES[ProcessingMachineType.Polishing]).toBe(30);
    expect(MACHINE_HOURLY_RATES[ProcessingMachineType.Assembly]).toBe(35);
    expect(MACHINE_HOURLY_RATES[ProcessingMachineType.Programming]).toBe(45);
    expect(MACHINE_HOURLY_RATES[ProcessingMachineType.MoldDesign]).toBe(45);
    expect(MACHINE_HOURLY_RATES[ProcessingMachineType.ProcessPlanning]).toBe(45);
  });
});

describe('模板厚度倍率', () => {
  it('50mm → 1.0倍', () => {
    expect(getPlateThicknessMultiplier(50)).toBe(1.0);
  });

  it('80mm → 1.0倍', () => {
    expect(getPlateThicknessMultiplier(80)).toBe(1.0);
  });

  it('90mm → 1.2倍', () => {
    expect(getPlateThicknessMultiplier(90)).toBe(1.2);
  });

  it('100mm → 1.2倍', () => {
    expect(getPlateThicknessMultiplier(100)).toBe(1.2);
  });

  it('120mm → 1.4倍', () => {
    expect(getPlateThicknessMultiplier(120)).toBe(1.4);
  });

  it('130mm → 1.4倍', () => {
    expect(getPlateThicknessMultiplier(130)).toBe(1.4);
  });

  it('150mm → 1.8倍', () => {
    expect(getPlateThicknessMultiplier(150)).toBe(1.8);
  });

  it('160mm → 1.8倍', () => {
    expect(getPlateThicknessMultiplier(160)).toBe(1.8);
  });

  it('200mm → 2.0倍', () => {
    expect(getPlateThicknessMultiplier(200)).toBe(2.0);
  });
});

describe('铜线加工倍率', () => {
  it('0.25mm铜线 → 1.5倍', () => {
    expect(getCopperWireMultiplier(0.25)).toBe(1.5);
  });

  it('0.15mm铜线 → 2倍', () => {
    expect(getCopperWireMultiplier(0.15)).toBe(2.0);
  });

  it('0.10mm铜线 → 2.5倍', () => {
    expect(getCopperWireMultiplier(0.10)).toBe(2.5);
  });

  it('0.08mm铜线 → 2.5倍', () => {
    expect(getCopperWireMultiplier(0.08)).toBe(2.5);
  });

  it('0.30mm铜线 → 1.5倍（最粗也是1.5倍）', () => {
    expect(getCopperWireMultiplier(0.30)).toBe(1.5);
  });
});

describe('综合报价计算', () => {
  it('简单报价：线割3000mm²钢材一修二 → 75元+税', () => {
    const quote = calculateQuote({
      slowWireArea: 3000,
      slowWireMaterial: SlowWireMaterial.Steel,
      slowWirePrecision: SlowWirePrecision.OneRepairTwo,
    });
    expect(quote.slowWireFee).toBe(75);
    expect(quote.subtotal).toBe(75);
    expect(quote.tax).toBeCloseTo(12.75, 1);
    expect(quote.total).toBeCloseTo(87.75, 1);
  });

  it('复杂报价：多工序组合', () => {
    const quote = calculateQuote({
      slowWireArea: 5000,
      slowWireMaterial: SlowWireMaterial.Steel,
      slowWirePrecision: SlowWirePrecision.OneRepairThree,
      slowWireHoleCount: 10,
      fastWireSmallHoles: 5,
      edsHoleCount: 30,
      edsMaterialThickness: 30,
      machineTimeFees: {
        [ProcessingMachineType.CNC]: 2,
        [ProcessingMachineType.Milling]: 3,
        [ProcessingMachineType.Programming]: 1,
      },
    });

    // 线割：5000*0.030 = 150
    expect(quote.slowWireFee).toBe(150);
    // 割孔：10<=10, 10*12*1 = 120（无斜度）
    expect(quote.slowWireHoleFee).toBe(120);
    // 快走丝：5*4.5 = 22.5
    expect(quote.fastWireFee).toBe(22.5);
    // 放电：30*2 = 60
    expect(quote.edsFee).toBe(60);
    // CNC: 2*60=120, 铣床: 3*35=105, 编程: 1*45=45
    expect(quote.machineTimeFee).toBe(270);
    // 税前 = 150+120+22.5+60+270 = 622.5
    expect(quote.subtotal).toBe(622.5);
    // 税金 = 622.5 * 0.17 = 105.825
    expect(quote.tax).toBeCloseTo(105.83, 1);
    // 总价 = 622.5 + 105.825 = 728.325
    expect(quote.total).toBeCloseTo(728.33, 1);
  });

  it('含模板厚度附加', () => {
    const quote = calculateQuote({
      slowWireArea: 5000,
      plateThickness: 120, // 1.4倍
      slowWireMaterial: SlowWireMaterial.Steel,
      slowWirePrecision: SlowWirePrecision.OneRepairTwo,
    });
    // 线割 = 5000*0.025 = 125
    // 割孔+放电 = 0
    // 厚度附加 = (125+0+0) * (1.4-1) = 50
    expect(quote.plateThicknessFee).toBeCloseTo(50, 1);
    expect(quote.subtotal).toBeCloseTo(175, 1);
  });

  it('含铜线附加', () => {
    const quote = calculateQuote({
      slowWireArea: 5000,
      copperWireDiameter: 0.15, // 2倍
      slowWireMaterial: SlowWireMaterial.Steel,
      slowWirePrecision: SlowWirePrecision.OneRepairTwo,
    });
    // 线割 = 5000*0.025 = 125
    // 铜线附加 = 125 * (2-1) = 125
    expect(quote.copperWireFee).toBe(125);
    expect(quote.subtotal).toBeCloseTo(250, 1);
  });

  it('空报价 → 全0', () => {
    const quote = calculateQuote({});
    expect(quote.slowWireFee).toBe(0);
    expect(quote.subtotal).toBe(0);
    expect(quote.tax).toBe(0);
    expect(quote.total).toBe(0);
  });
});
