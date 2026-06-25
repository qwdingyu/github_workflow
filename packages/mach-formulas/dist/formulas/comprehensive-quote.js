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
import { PI } from './math-utils';
// ═══════════════════════════════════════════════════
// 1. 加工费计算
// ═══════════════════════════════════════════════════
/**
 * 加工设备类型
 * 台湾风格分类：CNC车/铣/线割/放电/磨床/手动车铣等
 */
export var MachineType;
(function (MachineType) {
    MachineType["CNC_TURN"] = "cnc_turn";
    MachineType["CNC_MILL"] = "cnc_mill";
    MachineType["WIRE_CUT_SLOW"] = "wire_cut_slow";
    MachineType["WIRE_CUT_FAST"] = "wire_cut_fast";
    MachineType["EDM"] = "edm";
    MachineType["GRINDING"] = "grinding";
    MachineType["CONVENTIONAL_TURN"] = "conventional_turn";
    MachineType["CONVENTIONAL_MILL"] = "conventional_mill";
})(MachineType || (MachineType = {}));
/**
 * 设备费率（元/小时）
 * 来源：文件10 Sheet1 第5-10行
 */
export const MACHINE_RATE = {
    [MachineType.CNC_TURN]: 35,
    [MachineType.CNC_MILL]: 35,
    [MachineType.WIRE_CUT_SLOW]: 30,
    [MachineType.WIRE_CUT_FAST]: 15,
    [MachineType.EDM]: 28,
    [MachineType.GRINDING]: 25,
    [MachineType.CONVENTIONAL_TURN]: 18,
    [MachineType.CONVENTIONAL_MILL]: 18,
};
/**
 * 计算加工费
 * @param times - 各工序加工时间
 * @returns 总加工费（元）
 */
export function calculateProcessingFee(times) {
    const fee = times.cncTurning * MACHINE_RATE[MachineType.CNC_TURN] +
        times.cncMilling * MACHINE_RATE[MachineType.CNC_MILL] +
        times.wireCutSlow * MACHINE_RATE[MachineType.WIRE_CUT_SLOW] +
        times.wireCutFast * MACHINE_RATE[MachineType.WIRE_CUT_FAST] +
        times.edm * MACHINE_RATE[MachineType.EDM] +
        times.grinding * MACHINE_RATE[MachineType.GRINDING] +
        times.conventional * MACHINE_RATE[MachineType.CONVENTIONAL_TURN];
    return Math.round(fee * 100) / 100;
}
// ═══════════════════════════════════════════════════
// 2. 材料费计算
// ═══════════════════════════════════════════════════
/**
 * 常见金属材料密度（g/cm³）
 */
export const MATERIAL_DENSITY = {
    steel: 7.85, // 碳钢
    stainless_steel: 7.9, // 不锈钢
    aluminum: 2.7, // 铝合金
    copper: 8.9, // 紫铜
    brass: 8.5, // 黄铜
    titanium: 4.5, // 钛合金
    tungsten_carbide: 14.9, // 钨钢
};
/**
 * 常见金属材料单价（元/kg）
 */
export const MATERIAL_UNIT_PRICE = {
    steel: 5,
    stainless_steel: 15,
    aluminum: 18,
    copper: 65,
    brass: 45,
    titanium: 180,
    tungsten_carbide: 280,
};
/**
 * 毛坯形状
 */
export var BlankShape;
(function (BlankShape) {
    BlankShape["Square"] = "square";
    BlankShape["Round"] = "round";
    BlankShape["Tube"] = "tube";
})(BlankShape || (BlankShape = {}));
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
export function calculateMaterialWeight(shape, params) {
    let volume; // mm³
    switch (shape) {
        case BlankShape.Square:
            volume = params.length * (params.width || 0) * (params.height || 0);
            break;
        case BlankShape.Round:
            const radius = (params.outerDiameter || 0) / 2;
            volume = PI * radius * radius * params.length;
            break;
        case BlankShape.Tube:
            const R = (params.outerDiameter || 0) / 2;
            const r = (params.innerDiameter || 0) / 2;
            volume = PI * (R * R - r * r) * params.length;
            break;
        default:
            volume = 0;
    }
    const density = MATERIAL_DENSITY[params.material] || 7.85;
    // 体积(mm³) → 重量(g) = 体积 × 密度 / 1000 → kg
    const weight = volume * density / 1e6;
    return Math.round(weight * 1000) / 1000;
}
/**
 * 计算材料费
 * @param weight - 材料重量（kg）
 * @param material - 材料类型
 * @returns 材料费（元）
 */
export function calculateMaterialFee(weight, material) {
    const unitPrice = MATERIAL_UNIT_PRICE[material] || 5;
    return Math.round(weight * unitPrice * 100) / 100;
}
// ═══════════════════════════════════════════════════
// 3. 乘数体系
// ═══════════════════════════════════════════════════
/**
 * 复杂程度系数 K1
 * 来源：文件10 Sheet1 第15-20行
 */
export const COMPLEXITY_FACTOR = {
    simple: 1.0, // 简单：单一工序，无复杂形状
    medium: 1.2, // 中等：多工序，一般形状
    complex: 1.5, // 复杂：多工序+复杂曲面
    ultra_complex: 2.0, // 超复杂：精密模具/特殊结构
};
/**
 * 精度等级系数 K2
 * 来源：文件10 Sheet1 第22-25行
 */
export const PRECISION_FACTOR = {
    general: 1.0, // 一般精度：IT12-IT13
    medium: 1.15, // 中等精度：IT11-IT12
    high: 1.35, // 高精度：IT9-IT10
    ultra_high: 1.6, // 超高精度：IT6-IT8
};
/**
 * 表面粗糙度系数 K3
 * 来源：文件10 Sheet1 第27-30行
 */
export const SURFACE_FACTOR = {
    general: 1.0, // Ra 12.5-25
    medium: 1.1, // Ra 6.3-12.5
    fine: 1.25, // Ra 3.2-6.3
    ultra_fine: 1.5, // Ra 0.8-3.2
    mirror: 1.8, // Ra < 0.8
};
/**
 * 批量系数 K4
 * 来源：文件10 Sheet1 第32-35行
 */
export const BATCH_FACTOR = {
    single: 2.0, // 单件
    small: 1.5, // 小批量：1-50
    medium: 1.2, // 中批量：51-500
    large: 1.0, // 大批量：501+
    mass: 0.85, // 大量生产：>10000
};
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
export function calculateCompositeFactor(complexity, precision, surface, batchSize) {
    const K1 = COMPLEXITY_FACTOR[complexity] || 1.0;
    const K2 = PRECISION_FACTOR[precision] || 1.0;
    const K3 = SURFACE_FACTOR[surface] || 1.0;
    let K4;
    if (batchSize <= 1)
        K4 = BATCH_FACTOR.single;
    else if (batchSize <= 50)
        K4 = BATCH_FACTOR.small;
    else if (batchSize <= 500)
        K4 = BATCH_FACTOR.medium;
    else if (batchSize <= 10000)
        K4 = BATCH_FACTOR.large;
    else
        K4 = BATCH_FACTOR.mass;
    return Math.round(K1 * K2 * K3 * K4 * 1000) / 1000;
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
export function calculateComprehensiveQuote(params) {
    const { processingFee, materialFee, complexity, precision, surface, batchSize, profitMargin = 0.20, taxRate = 0.13, } = params;
    // 小计
    const subTotal = processingFee + materialFee;
    // 综合乘数
    const compositeFactor = calculateCompositeFactor(complexity, precision, surface, batchSize);
    // 调整后费用
    const adjustedFee = Math.round(subTotal * compositeFactor * 100) / 100;
    // 最终报价
    const finalQuote = Math.round(adjustedFee * (1 + profitMargin + taxRate) * 100) / 100;
    return {
        processingFee: Math.round(processingFee * 100) / 100,
        materialFee: Math.round(materialFee * 100) / 100,
        subTotal: Math.round(subTotal * 100) / 100,
        compositeFactor,
        adjustedFee,
        profitMargin,
        taxRate,
        finalQuote,
    };
}
/**
 * 完整的设备费率表
 */
export const MACHINE_RATE_TABLE = [
    {
        type: MachineType.CNC_TURN,
        rate: 35,
        description: 'CNC车削中心',
        commonParts: '轴类/盘类/螺纹件',
    },
    {
        type: MachineType.CNC_MILL,
        rate: 35,
        description: 'CNC铣削中心',
        commonParts: '壳体/板类/模具',
    },
    {
        type: MachineType.WIRE_CUT_SLOW,
        rate: 30,
        description: '慢走丝线割',
        commonParts: '精密冲模/细缝',
    },
    {
        type: MachineType.WIRE_CUT_FAST,
        rate: 15,
        description: '快走丝线割',
        commonParts: '普通冲模/穿孔',
    },
    {
        type: MachineType.EDM,
        rate: 28,
        description: '放电加工',
        commonParts: '深槽/细孔/异形',
    },
    {
        type: MachineType.GRINDING,
        rate: 25,
        description: '磨床',
        commonParts: '精密轴/平面/模具',
    },
    {
        type: MachineType.CONVENTIONAL_TURN,
        rate: 18,
        description: '手动车床',
        commonParts: '简单轴类/修配',
    },
    {
        type: MachineType.CONVENTIONAL_MILL,
        rate: 18,
        description: '手动铣床',
        commonParts: '简单平面/键槽',
    },
];
//# sourceMappingURL=comprehensive-quote.js.map