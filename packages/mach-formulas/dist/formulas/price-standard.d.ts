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
/**
 * 慢走丝线割加工材料类型枚举
 * 来源：文件4 Sheet2 A模块
 */
export declare enum SlowWireMaterial {
    Steel = "steel",// 一般钢材
    CopperElectrode = "copper_electrode",// 铜电极
    Tungsten = "tungsten"
}
/**
 * 慢走丝线割精度等级枚举
 * 来源：文件4 Sheet2 A模块
 * 分割一刀 = 一次切割，精度一般
 * 一修一 = 第一次粗割 + 第二次精修，精度中等
 * 一修二 = 第一次粗割 + 两次精修，精度高
 * 一修三 = 第一次粗割 + 三次精修，精度最高
 */
export declare enum SlowWirePrecision {
    OneCut = "one_cut",// 分割一刀
    OneRepairOne = "one_repair_one",// 一修一
    OneRepairTwo = "one_repair_two",// 一修二
    OneRepairThree = "one_repair_three"
}
/**
 * 慢走丝线割单价标准（元/mm²）
 * 来源：文件4 Sheet2 A模块
 *
 * 价格依据2025年2月国内模具加工市场价格
 */
export declare const SLOW_WIRE_UNIT_PRICES: Record<SlowWireMaterial, Record<SlowWirePrecision, number>>;
/**
 * 慢走丝线割单件最低收费（元）
 * 来源：文件4 Sheet2 A模块
 */
export declare const SLOW_WIRE_MIN_PRICE = 40;
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
export declare function calculateSlowWireCuttingFee(cuttingArea: number, material: SlowWireMaterial, precision: SlowWirePrecision): number;
/**
 * 慢走丝割孔单价（元/孔）
 * 来源：文件4 Sheet2 B模块
 */
export declare const SLOW_WIRE_HOLE_SMALL_PRICE = 12;
export declare const SLOW_WIRE_HOLE_LARGE_PRICE = 10;
/**
 * 斜孔倍率
 * 来源：文件4 Sheet2 B模块
 * 2°~5°斜孔：1.5倍
 * 5°~15°斜孔：2倍
 */
export declare const SLOW_WIRE_HOLE_ANGLE_MULTIPLIERS: Record<string, number>;
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
export declare function calculateSlowWireHoleFee(holeCount: number, holeAngle?: number): number;
/**
 * 快走丝加工单价
 * 来源：文件4 Sheet2 C模块
 */
export declare const FAST_WIRE_SMALL_HOLE_PRICE = 4.5;
export declare const FAST_WIRE_LINE_PRICE = 0.0045;
/**
 * 计算快走丝加工费用
 * @param smallHoleCount - 小孔数量（个）
 * @param lineArea - 线切割面积（mm²）
 * @returns 快走丝总费用（元）
 *
 * 公式：总费用 = 小孔费用 + 线长费用
 */
export declare function calculateFastWireFee(smallHoleCount?: number, lineArea?: number): number;
/**
 * 细孔放电加工单价（元/孔）
 * 来源：文件4 Sheet2 D模块
 */
export declare const EDS_THIN_HOLE_UNDER_50MM_PRICE = 2;
export declare const EDS_THIN_HOLE_OVER_50MM_PRICE = 3;
export declare const EDS_MIN_PRICE = 40;
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
export declare function calculateEDSFee(holeCount: number, materialThickness: number): number;
/**
 * 加工方式小时费率（元/小时）
 * 来源：文件4 Sheet2 E模块
 *
 * 价格依据2025年2月国内模具加工市场实际价格
 */
export declare enum ProcessingMachineType {
    Milling = "milling",// 铣床
    Grinder = "grinder",// 磨床
    EDM = "edm",// 电火花
    CNC = "cnc",// CNC加工
    Polishing = "polishing",// 抛光
    Assembly = "assembly",// 钳工装配
    Programming = "programming",// 编程
    MoldDesign = "mold_design",// 模具设计
    ProcessPlanning = "process_planning"
}
export declare const MACHINE_HOURLY_RATES: Record<ProcessingMachineType, number>;
/**
 * 模具管理费费率
 * 来源：文件4 Sheet2 E模块
 * 模具管理费 = 模具总费用 × 0.5%
 */
export declare const MOLD_MANAGEMENT_FEE_RATE = 0.005;
/**
 * 计算加工时间费用
 * @param machineType - 加工方式
 * @param hours - 加工工时（小时）
 * @returns 时间费用（元）
 */
export declare function calculateMachineTimeFee(machineType: ProcessingMachineType, hours: number): number;
/**
 * 模板厚度倍率
 * 来源：文件4 Sheet2 F模块备注
 *
 * 模板厚度影响加工难度，越厚倍率越高
 */
export declare const PLATE_THICKNESS_MULTIPLIERS: Record<string, number>;
/**
 * 根据模板厚度获取倍率
 * @param thickness - 模板厚度（mm）
 * @returns 厚度倍率
 */
export declare function getPlateThicknessMultiplier(thickness: number): number;
/**
 * 铜线加工倍率
 * 来源：文件4 Sheet2 F模块备注
 * 铜线越细加工越慢，倍率越高
 */
export declare const COPPER_WIRE_MULTIPLIERS: Record<string, number>;
/**
 * 根据铜线直径获取倍率
 * @param wireDiameter - 铜线直径（mm）
 * @returns 铜线倍率
 */
export declare function getCopperWireMultiplier(wireDiameter: number): number;
/**
 * 增值税税率
 * 来源：文件4 Sheet2 F模块备注
 */
export declare const VAT_RATE = 0.17;
/**
 * 报价汇总接口
 */
export interface QuoteSummary {
    slowWireFee: number;
    slowWireHoleFee: number;
    fastWireFee: number;
    edsFee: number;
    machineTimeFee: number;
    plateThicknessFee: number;
    copperWireFee: number;
    subtotal: number;
    tax: number;
    total: number;
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
export declare function calculateQuote(params: {
    slowWireArea?: number;
    slowWireMaterial?: SlowWireMaterial;
    slowWirePrecision?: SlowWirePrecision;
    slowWireHoleCount?: number;
    slowWireHoleAngle?: number;
    fastWireSmallHoles?: number;
    fastWireLineArea?: number;
    edsHoleCount?: number;
    edsMaterialThickness?: number;
    machineTimeFees?: Record<ProcessingMachineType, number>;
    plateThickness?: number;
    copperWireDiameter?: number;
}): QuoteSummary;
//# sourceMappingURL=price-standard.d.ts.map