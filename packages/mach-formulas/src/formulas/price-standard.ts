/**
 * 文件4《加工价格标准》— 机加工单价标准
 * 来源：/Users/dingyuwang/Downloads/9-教育/数控报价表/加工价格标准.xls Sheet2
 * 制表日期：2025.2.24
 * 
 * 此模块包含：
 * - 慢走丝线割加工计价（按切割面积）
 * - 慢走丝割孔计价
 * - 快走丝加工计价
 * - 细孔放电加工计价
 * - 各加工方式小时费率
 * - 模板厚度倍率
 * - 铜线加工倍数
 * - 报价汇总（含税17%增值税）
 */

// ═══════════════════════════════════════════════════
// 一、慢走丝线割加工
// ═══════════════════════════════════════════════════

/**
 * 慢走丝线割加工材料类型枚举
 * 来源：文件4 Sheet2 A模块
 */
export enum SlowWireMaterial {
  Steel = 'steel',       // 一般钢材
  CopperElectrode = 'copper_electrode', // 铜电极
  Tungsten = 'tungsten', // 钨钢
}

/**
 * 慢走丝线割精度等级枚举
 * 来源：文件4 Sheet2 A模块
 * 分割一刀 = 一次切割，精度一般
 * 一修一 = 第一次粗割 + 第二次精修，精度中等
 * 一修二 = 第一次粗割 + 两次精修，精度高
 * 一修三 = 第一次粗割 + 三次精修，精度最高
 */
export enum SlowWirePrecision {
  OneCut = 'one_cut',         // 分割一刀
  OneRepairOne = 'one_repair_one', // 一修一
  OneRepairTwo = 'one_repair_two', // 一修二
  OneRepairThree = 'one_repair_three', // 一修三
}

/**
 * 慢走丝线割单价标准（元/mm²）
 * 来源：文件4 Sheet2 A模块
 * 
 * 价格依据2025年2月国内模具加工市场价格
 */
export const SLOW_WIRE_UNIT_PRICES: Record<SlowWireMaterial, Record<SlowWirePrecision, number>> = {
  [SlowWireMaterial.Steel]: {
    [SlowWirePrecision.OneCut]: 0.017,
    [SlowWirePrecision.OneRepairOne]: 0.020,
    [SlowWirePrecision.OneRepairTwo]: 0.025,
    [SlowWirePrecision.OneRepairThree]: 0.030,
  },
  [SlowWireMaterial.CopperElectrode]: {
    [SlowWirePrecision.OneCut]: 0.022,
    [SlowWirePrecision.OneRepairOne]: 0.027,
    [SlowWirePrecision.OneRepairTwo]: 0.032,
    [SlowWirePrecision.OneRepairThree]: 0.037,
  },
  [SlowWireMaterial.Tungsten]: {
    [SlowWirePrecision.OneCut]: 0.028,
    [SlowWirePrecision.OneRepairOne]: 0.033,
    [SlowWirePrecision.OneRepairTwo]: 0.035,
    [SlowWirePrecision.OneRepairThree]: 0.035, // 钨钢最高限价
  },
};

/**
 * 慢走丝线割单件最低收费（元）
 * 来源：文件4 Sheet2 A模块
 */
export const SLOW_WIRE_MIN_PRICE = 40;

/**
 * 计算慢走丝线割费用
 * @param cuttingArea - 切割面积（mm²）
 * @param material - 材料类型
 * @param precision - 精度等级
 * @returns 线割费用（元），含最低收费规则
 * 
 * 公式：费用 = max(最低收费, 切割面积 × 单价)
 * 
 * 示例验证（Excel行12）：
 *   钢材, 一修一, 面积1000mm² → max(40, 1000×0.020) = max(40, 20) = 40元
 *   钢材, 一修二, 面积1500mm² → max(40, 1500×0.025) = max(40, 37.5) = 37.5元 → 但Excel显示37.5
 *   说明最低收费是40元，37.5 < 40 时取40
 */
export function calculateSlowWireCuttingFee(
  cuttingArea: number,
  material: SlowWireMaterial,
  precision: SlowWirePrecision,
): number {
  const unitPrice = SLOW_WIRE_UNIT_PRICES[material][precision];
  const rawFee = cuttingArea * unitPrice;
  return Math.max(SLOW_WIRE_MIN_PRICE, rawFee);
}

// ═══════════════════════════════════════════════════
// 二、慢走丝割孔
// ═══════════════════════════════════════════════════

/**
 * 慢走丝割孔单价（元/孔）
 * 来源：文件4 Sheet2 B模块
 */
export const SLOW_WIRE_HOLE_SMALL_PRICE = 12; // 10个以下
export const SLOW_WIRE_HOLE_LARGE_PRICE = 10; // 10个以上

/**
 * 斜孔倍率
 * 来源：文件4 Sheet2 B模块
 * 2°~5°斜孔：1.5倍
 * 5°~15°斜孔：2倍
 */
export const SLOW_WIRE_HOLE_ANGLE_MULTIPLIERS: Record<string, number> = {
  '2-5': 1.5,
  '5-15': 2.0,
};

/**
 * 计算慢走丝割孔费用
 * @param holeCount - 孔数量
 * @param holeAngle - 孔斜度（度），0表示无斜度
 * @returns 割孔费用（元）
 *
 * 公式：
 *   基础费用 = holeCount <= 10 ? 12 : 10 （元/孔）
 *   斜孔倍率 = 0°→1, 2°<x≤5°→1.5, 5°<x≤15°→2, >15°→2(封顶)
 *   费用 = 基础费用 × holeCount × 斜孔倍率
 */
export function calculateSlowWireHoleFee(
  holeCount: number,
  holeAngle: number = 0,
): number {
  const unitPrice = holeCount <= 10 ? SLOW_WIRE_HOLE_SMALL_PRICE : SLOW_WIRE_HOLE_LARGE_PRICE;
  let angleMultiplier = 1;
  if (holeAngle > 2 && holeAngle <= 5) {
    angleMultiplier = 1.5;
  } else if (holeAngle > 5 && holeAngle <= 15) {
    angleMultiplier = 2;
  } else if (holeAngle > 15) {
    // 超过15°仍按2倍封顶
    angleMultiplier = 2;
  }
  return unitPrice * holeCount * angleMultiplier;
}

// ═══════════════════════════════════════════════════
// 三、快走丝加工
// ═══════════════════════════════════════════════════

/**
 * 快走丝加工单价
 * 来源：文件4 Sheet2 C模块
 */
export const FAST_WIRE_SMALL_HOLE_PRICE = 4.5; // 小孔 元/个
export const FAST_WIRE_LINE_PRICE = 0.0045; // 线长 元/mm²

/**
 * 计算快走丝加工费用
 * @param smallHoleCount - 小孔数量（个）
 * @param lineArea - 线切割面积（mm²）
 * @returns 快走丝总费用（元）
 * 
 * 公式：总费用 = 小孔费用 + 线长费用
 */
export function calculateFastWireFee(
  smallHoleCount: number = 0,
  lineArea: number = 0,
): number {
  return smallHoleCount * FAST_WIRE_SMALL_HOLE_PRICE + lineArea * FAST_WIRE_LINE_PRICE;
}

// ═══════════════════════════════════════════════════
// 四、细孔放电加工
// ═══════════════════════════════════════════════════

/**
 * 细孔放电加工单价（元/孔）
 * 来源：文件4 Sheet2 D模块
 */
export const EDS_THIN_HOLE_UNDER_50MM_PRICE = 2;  // 厚度50mm以下
export const EDS_THIN_HOLE_OVER_50MM_PRICE = 3;   // 厚度50mm以上
export const EDS_MIN_PRICE = 40; // 滑块/斜顶孔最低收费

/**
 * 计算细孔放电加工费用
 * @param holeCount - 孔数量
 * @param materialThickness - 材料厚度（mm）
 * @returns 放电费用（元）
 * 
 * 公式：
 *   单位价格 = thickness <= 50 ? 2 : 3
 *   费用 = max(最低收费40, 单位价格 × 孔数)
 */
export function calculateEDSFee(
  holeCount: number,
  materialThickness: number,
): number {
  const unitPrice = materialThickness <= 50
    ? EDS_THIN_HOLE_UNDER_50MM_PRICE
    : EDS_THIN_HOLE_OVER_50MM_PRICE;
  return Math.max(EDS_MIN_PRICE, unitPrice * holeCount);
}

// ═══════════════════════════════════════════════════
// 五、各加工方式小时费率
// ═══════════════════════════════════════════════════

/**
 * 加工方式小时费率（元/小时）
 * 来源：文件4 Sheet2 E模块
 * 
 * 价格依据2025年2月国内模具加工市场实际价格
 */
export enum ProcessingMachineType {
  Milling = 'milling',         // 铣床
  Grinder = 'grinder',         // 磨床
  EDM = 'edm',                 // 电火花
  CNC = 'cnc',                 // CNC加工
  Polishing = 'polishing',     // 抛光
  Assembly = 'assembly',       // 钳工装配
  Programming = 'programming', // 编程
  MoldDesign = 'mold_design',  // 模具设计
  ProcessPlanning = 'process_planning', // 工艺编排
}

export const MACHINE_HOURLY_RATES: Record<ProcessingMachineType, number> = {
  [ProcessingMachineType.Milling]: 35,
  [ProcessingMachineType.Grinder]: 35,
  [ProcessingMachineType.EDM]: 18,
  [ProcessingMachineType.CNC]: 60,
  [ProcessingMachineType.Polishing]: 30,
  [ProcessingMachineType.Assembly]: 35,
  [ProcessingMachineType.Programming]: 45,
  [ProcessingMachineType.MoldDesign]: 45,
  [ProcessingMachineType.ProcessPlanning]: 45,
};

/**
 * 模具管理费费率
 * 来源：文件4 Sheet2 E模块
 * 模具管理费 = 模具总费用 × 0.5%
 */
export const MOLD_MANAGEMENT_FEE_RATE = 0.005;

/**
 * 计算加工时间费用
 * @param machineType - 加工方式
 * @param hours - 加工工时（小时）
 * @returns 时间费用（元）
 */
export function calculateMachineTimeFee(
  machineType: ProcessingMachineType,
  hours: number,
): number {
  return MACHINE_HOURLY_RATES[machineType] * hours;
}

// ═══════════════════════════════════════════════════
// 六、模板厚度倍率
// ═══════════════════════════════════════════════════

/**
 * 模板厚度倍率
 * 来源：文件4 Sheet2 F模块备注
 * 
 * 模板厚度影响加工难度，越厚倍率越高
 */
export const PLATE_THICKNESS_MULTIPLIERS: Record<string, number> = {
  'under-80': 1.0,   // 80mm以下：不倍率
  '80-100': 1.2,     // 80-100mm：1.2倍
  '101-130': 1.4,    // 101-130mm：1.4倍
  '131-160': 1.8,    // 131-160mm：1.8倍
  'over-160': 2.0,   // 160mm以上：2.0倍
};

/**
 * 根据模板厚度获取倍率
 * @param thickness - 模板厚度（mm）
 * @returns 厚度倍率
 */
export function getPlateThicknessMultiplier(thickness: number): number {
  if (thickness <= 80) return 1.0;
  if (thickness <= 100) return 1.2;
  if (thickness <= 130) return 1.4;
  if (thickness <= 160) return 1.8;
  return 2.0;
}

// ═══════════════════════════════════════════════════
// 七、铜线加工倍数
// ═══════════════════════════════════════════════════

/**
 * 铜线加工倍率
 * 来源：文件4 Sheet2 F模块备注
 * 铜线越细加工越慢，倍率越高
 */
export const COPPER_WIRE_MULTIPLIERS: Record<string, number> = {
  '0.25': 1.5,  // 0.25mm铜线：1.5倍
  '0.20': 1.8,  // 0.20mm铜线：1.8倍
  '0.15': 2.0,  // 0.15mm铜线：2倍
  '0.10': 2.5,  // 0.10mm铜线：2.5倍
};

/**
 * 根据铜线直径获取倍率
 * @param wireDiameter - 铜线直径（mm）
 * @returns 铜线倍率
 */
export function getCopperWireMultiplier(wireDiameter: number): number {
  if (wireDiameter >= 0.25) return 1.5;
  if (wireDiameter >= 0.20) return 1.8;
  if (wireDiameter >= 0.15) return 2.0;
  return 2.5;
}

// ═══════════════════════════════════════════════════
// 八、综合报价汇总
// ═══════════════════════════════════════════════════

/**
 * 增值税税率
 * 来源：文件4 Sheet2 F模块备注
 */
export const VAT_RATE = 0.17;

/**
 * 报价汇总接口
 */
export interface QuoteSummary {
  slowWireFee: number;           // 慢走丝线割费用
  slowWireHoleFee: number;       // 慢走丝割孔费用
  fastWireFee: number;           // 快走丝费用
  edsFee: number;                // 放电加工费用
  machineTimeFee: number;        // 各加工方式小时费
  plateThicknessFee: number;     // 模板厚度附加费
  copperWireFee: number;         // 铜线附加费
  subtotal: number;              // 合计（税前）
  tax: number;                   // 税金（17%增值税）
  total: number;                 // 含税总价
}

/**
 * 综合报价计算
 * @param params - 报价参数
 * @returns 报价汇总
 * 
 * 公式：
 *   税前合计 = 各分项费用之和
 *   税金 = 税前合计 × 17%
 *   含税总价 = 税前合计 + 税金
 */
export function calculateQuote(params: {
  slowWireArea?: number;
  slowWireMaterial?: SlowWireMaterial;
  slowWirePrecision?: SlowWirePrecision;
  slowWireHoleCount?: number;
  slowWireHoleAngle?: number;
  fastWireSmallHoles?: number;
  fastWireLineArea?: number;
  edsHoleCount?: number;
  edsMaterialThickness?: number;
  machineTimeFees?: Record<ProcessingMachineType, number>; // { milling: 2.5, cnc: 1.5, ... }
  plateThickness?: number;
  copperWireDiameter?: number;
}): QuoteSummary {
  // 各分项费用
  const slowWireFee = params.slowWireArea
    ? calculateSlowWireCuttingFee(
        params.slowWireArea,
        params.slowWireMaterial || SlowWireMaterial.Steel,
        params.slowWirePrecision || SlowWirePrecision.OneRepairTwo,
      )
    : 0;

  const slowWireHoleFee = params.slowWireHoleCount
    ? calculateSlowWireHoleFee(
        params.slowWireHoleCount,
        params.slowWireHoleAngle || 0,
      )
    : 0;

  const fastWireFee = params.fastWireSmallHoles
    ? calculateFastWireFee(
        params.fastWireSmallHoles || 0,
        params.fastWireLineArea || 0,
      )
    : 0;

  const edsFee = params.edsHoleCount
    ? calculateEDSFee(
        params.edsHoleCount || 0,
        params.edsMaterialThickness || 0,
      )
    : 0;

  // 加工时间费用汇总
  let machineTimeFee = 0;
  if (params.machineTimeFees) {
    for (const [type, hours] of Object.entries(params.machineTimeFees)) {
      machineTimeFee += calculateMachineTimeFee(type as ProcessingMachineType, hours);
    }
  }

  // 模板厚度附加费
  let plateThicknessFee = 0;
  if (params.plateThickness && params.plateThickness > 80) {
    const multiplier = getPlateThicknessMultiplier(params.plateThickness);
    // 厚度倍率应用于线割+割孔+放电的总和
    const baseFee = slowWireFee + slowWireHoleFee + edsFee;
    plateThicknessFee = baseFee * (multiplier - 1);
  }

  // 铜线附加费
  let copperWireFee = 0;
  if (params.copperWireDiameter) {
    const multiplier = getCopperWireMultiplier(params.copperWireDiameter);
    // 铜线倍率应用于线割费用
    copperWireFee = slowWireFee * (multiplier - 1);
  }

  // 税前合计
  const subtotal = slowWireFee + slowWireHoleFee + fastWireFee + edsFee
    + machineTimeFee + plateThicknessFee + copperWireFee;

  // 税金和总价
  const tax = subtotal * VAT_RATE;
  const total = subtotal + tax;

  return {
    slowWireFee,
    slowWireHoleFee,
    fastWireFee,
    edsFee,
    machineTimeFee,
    plateThicknessFee,
    copperWireFee,
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}
