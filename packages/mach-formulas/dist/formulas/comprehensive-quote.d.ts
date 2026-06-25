/**
 * 文件10《加工件費用計算表》— 综合估价+乘数体系
 * 来源：/Users/dingyuwang/Downloads/9-教育/数控报价表/加工件費用計算表.xlsx
 *
 * 此文件是台湾风格的加工件报价表，使用**乘数体系**进行综合报价。
 * 与大陆风格不同，台湾风格倾向于用"基础费×乘数"的方式。
 *
 * 报价公式：
 *   综合报价 = (加工费 + 材料费) × K1 × K2 × K3 × K4 × (1 + 利润率 + 税率)
 *   K1 = 复杂程度系数
 *   K2 = 精度等级系数
 *   K3 = 表面粗糙度系数
 *   K4 = 批量系数
 */
/**
 * 加工设备类型
 * 台湾风格分类：CNC车/铣/线割/放电/磨床/手动车铣等
 */
export declare enum MachineType {
    CNC_TURN = "cnc_turn",// CNC车削中心
    CNC_MILL = "cnc_mill",// CNC铣削中心
    WIRE_CUT_SLOW = "wire_cut_slow",// 慢走丝线割
    WIRE_CUT_FAST = "wire_cut_fast",// 快走丝线割
    EDM = "edm",// 放电加工
    GRINDING = "grinding",// 磨床
    CONVENTIONAL_TURN = "conventional_turn",// 手动车床
    CONVENTIONAL_MILL = "conventional_mill"
}
/**
 * 设备费率（元/小时）
 * 来源：文件10 Sheet1 第5-10行
 */
export declare const MACHINE_RATE: Record<MachineType, number>;
/**
 * 加工工时（小时）
 */
export interface ProcessingTime {
    cncTurning: number;
    cncMilling: number;
    wireCutSlow: number;
    wireCutFast: number;
    edm: number;
    grinding: number;
    conventional: number;
}
/**
 * 计算加工费
 * @param times - 各工序加工时间
 * @returns 总加工费（元）
 */
export declare function calculateProcessingFee(times: ProcessingTime): number;
/**
 * 常见金属材料密度（g/cm³）
 */
export declare const MATERIAL_DENSITY: Record<string, number>;
/**
 * 常见金属材料单价（元/kg）
 */
export declare const MATERIAL_UNIT_PRICE: Record<string, number>;
/**
 * 毛坯形状
 */
export declare enum BlankShape {
    Square = "square",// 方料
    Round = "round",// 圆棒
    Tube = "tube"
}
/**
 * 计算材料重量
 * @param shape - 毛坯形状
 * @param params - 尺寸参数
 * @returns 材料重量（kg）
 *
 * 公式：
 *   方料：V = L × W × H，W = V × 密度
 *   圆棒：V = π × (D/2)² × L，W = V × 密度
 *   圆管：V = π × (D²-d²)/4 × L，W = V × 密度
 */
export declare function calculateMaterialWeight(shape: BlankShape, params: {
    length: number;
    width?: number;
    height?: number;
    outerDiameter?: number;
    innerDiameter?: number;
    material: string;
}): number;
/**
 * 计算材料费
 * @param weight - 材料重量（kg）
 * @param material - 材料类型
 * @returns 材料费（元）
 */
export declare function calculateMaterialFee(weight: number, material: string): number;
/**
 * 复杂程度系数 K1
 * 来源：文件10 Sheet1 第15-20行
 */
export declare const COMPLEXITY_FACTOR: Record<string, number>;
/**
 * 精度等级系数 K2
 * 来源：文件10 Sheet1 第22-25行
 */
export declare const PRECISION_FACTOR: Record<string, number>;
/**
 * 表面粗糙度系数 K3
 * 来源：文件10 Sheet1 第27-30行
 */
export declare const SURFACE_FACTOR: Record<string, number>;
/**
 * 批量系数 K4
 * 来源：文件10 Sheet1 第32-35行
 */
export declare const BATCH_FACTOR: Record<string, number>;
/**
 * 计算综合乘数
 * @param complexity - 复杂程度
 * @param precision - 精度等级
 * @param surface - 表面粗糙度
 * @param batchSize - 批量
 * @returns 综合乘数
 *
 * 公式：综合乘数 = K1 × K2 × K3 × K4
 */
export declare function calculateCompositeFactor(complexity: string, precision: string, surface: string, batchSize: number): number;
/**
 * 台湾风格综合报价结果
 */
export interface ComprehensiveQuoteResult {
    processingFee: number;
    materialFee: number;
    subTotal: number;
    compositeFactor: number;
    adjustedFee: number;
    profitMargin: number;
    taxRate: number;
    finalQuote: number;
}
/**
 * 综合报价计算
 * @param params - 报价参数
 * @returns 报价结果
 *
 * 公式链（台湾风格）：
 *   小计 = 加工费 + 材料费
 *   调整后费用 = 小计 × K1 × K2 × K3 × K4
 *   最终报价 = 调整后费用 × (1 + 利润率 + 税率)
 *
 * 示例验证：
 *   加工费=500，材料费=200，综合乘数=1.5，利润率20%，税率13%
 *   小计 = 500 + 200 = 700
 *   调整后 = 700 × 1.5 = 1050
 *   最终 = 1050 × (1 + 0.20 + 0.13) = 1050 × 1.33 = 1396.50
 */
export declare function calculateComprehensiveQuote(params: {
    processingFee: number;
    materialFee: number;
    complexity: string;
    precision: string;
    surface: string;
    batchSize: number;
    profitMargin?: number;
    taxRate?: number;
}): ComprehensiveQuoteResult;
/**
 * 设备费率详细信息
 */
export interface MachineRateDetail {
    type: MachineType;
    rate: number;
    description: string;
    commonParts: string;
}
/**
 * 完整的设备费率表
 */
export declare const MACHINE_RATE_TABLE: MachineRateDetail[];
//# sourceMappingURL=comprehensive-quote.d.ts.map