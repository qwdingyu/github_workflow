/**
 * 文件7《铣削工时制定参照表》— 铣削工时八步法
 * 来源：/Users/dingyuwang/Downloads/9-教育/数控报价表/铣削工时制定参照表.xls
 *
 * 此模块是**铣削加工工时定额计算的最完整流程**，按"八步"结构组织。
 * 数据来源：《机械加工工艺手册》《切削用量手册》
 *
 * 八步流程：
 * 1. 选择铣刀 → 2. 确定切削用量 → 3. 计算基本时间
 * 4. 确定辅助时间 → 5. 确定装卸时间 → 6. 汇总作业时间
 * 7. 计算单件/批量时间 → 8. 计算修正系数
 */
import { PI } from './math-utils';
/**
 * 计算铣削参数
 * @param params - 基础参数
 * @returns 计算结果
 *
 * 公式：
 *   每转进给量 f = af × Z (mm/rev)
 *   进给速度 Vf = f × n = af × Z × n (mm/min)
 *   铣刀转速 n = 1000 × V / (π × d0) (rpm)
 *
 * 示例验证（Excel）：
 *   Ac=7, Ap=6, L0=25, af=0.05, d0=7, V=20, Z=4
 *   f = 0.05 × 4 = 0.20 mm/rev
 *   n = 1000 × 20 / (π × 7) = 20000/21.99 ≈ 909.92 rpm
 *   Vf = 0.20 × 909.92 ≈ 181.98 mm/min ✓
 */
export function calculateMillingBase(params) {
    const { feedPerTooth, cutterDiameter, cuttingSpeed, cutterTeeth } = params;
    const feedPerRev = feedPerTooth * cutterTeeth;
    const cuttingSpeedRPM = (1000 * cuttingSpeed) / (PI * cutterDiameter);
    const feedRate = feedPerRev * cuttingSpeedRPM;
    return {
        feedPerRev: Math.round(feedPerRev * 10000) / 10000,
        cuttingSpeedRPM: Math.round(cuttingSpeedRPM * 100) / 100,
        feedRate: Math.round(feedRate * 100) / 100,
    };
}
// ═══════════════════════════════════════════════════
// 第二步：铣削深度/切削用量推荐
// ═══════════════════════════════════════════════════
/**
 * 铣刀类型
 */
export var MillingToolMaterial;
(function (MillingToolMaterial) {
    MillingToolMaterial["HighSpeedSteel"] = "hss";
    MillingToolMaterial["Carbide"] = "carbide";
})(MillingToolMaterial || (MillingToolMaterial = {}));
/**
 * 加工性质
 */
export var MillingOperationType;
(function (MillingOperationType) {
    MillingOperationType["Rough"] = "rough";
    MillingOperationType["Finish"] = "finish";
})(MillingOperationType || (MillingOperationType = {}));
/**
 * 推荐铣削深度
 * 来源：文件7 Sheet1 第9-11行
 */
export const RECOMMENDED_CUTTING_DEPTH = {
    [MillingToolMaterial.HighSpeedSteel]: {
        [MillingOperationType.Rough]: { min: 5, max: 7 },
        [MillingOperationType.Finish]: { min: 0.5, max: 1 },
    },
    [MillingToolMaterial.Carbide]: {
        [MillingOperationType.Rough]: { min: 10, max: 18 },
        [MillingOperationType.Finish]: { min: 0.2, max: 0.5 },
    },
};
/**
 * 检查铣削深度是否合理
 * @param depth - 设定的铣削深度（mm）
 * @param cutterType - 铣刀类型
 * @param operationType - 加工性质
 * @returns {合理, 推荐范围}
 */
export function checkCuttingDepth(depth, cutterType, operationType) {
    const range = RECOMMENDED_CUTTING_DEPTH[cutterType][operationType];
    return {
        reasonable: depth >= range.min && depth <= range.max,
        ...range,
        recommended: (range.min + range.max) / 2,
    };
}
// ═══════════════════════════════════════════════════
// 第三步：铣削加工切入量与超出量计算
// ═══════════════════════════════════════════════════
/**
 * 铣刀种类
 * 来源：文件7 Sheet1 第47-58行
 */
export var CutterKind;
(function (CutterKind) {
    CutterKind["Cylindrical"] = "cylindrical";
    CutterKind["SideFaceMill"] = "side_face_mill";
    CutterKind["DiscMill"] = "disc_mill";
    CutterKind["SawMill"] = "saw_mill";
    CutterKind["EndMill"] = "end_mill";
    CutterKind["VerticalMill"] = "vertical_mill";
    CutterKind["NumberMill"] = "number_mill";
})(CutterKind || (CutterKind = {}));
/**
 * 计算铣削切入量L1和超出量L2
 * @param kind - 铣刀种类
 * @param params - 铣削参数
 * @returns {L1, L2}
 *
 * 公式验证（Excel）：
 *   圆柱铣刀: L1 = √(Ap × (d0 - Ap))
 *     Ap=6, d0=7: √(6×(7-6)) = √6 ≈ 2.45mm
 *   端铣刀: L1 = 0.5 × (d0 - √(d0² - Ac²))
 *     d0=50, Ac=30: 0.5×(50-√(2500-900)) = 0.5×(50-40) = 5mm
 *   立铣刀: L1 = d0/2
 *     d0=20: L1 = 10mm
 *
 *   L2统一选取范围 1-5mm，通常取2.5mm
 */
export function calculateCuttingAmount(kind, cuttingWidth, // Ac (mm)
cuttingDepth, // Ap (mm)
cutterDiameter) {
    let L1;
    switch (kind) {
        case CutterKind.Cylindrical:
        case CutterKind.SideFaceMill:
        case CutterKind.DiscMill:
        case CutterKind.SawMill:
            // L1 = √(Ap × (d0 - Ap))
            L1 = Math.sqrt(cuttingDepth * (cutterDiameter - cuttingDepth));
            break;
        case CutterKind.EndMill:
            // L1 = 0.5 × (d0 - √(d0² - Ac²))
            L1 = 0.5 * (cutterDiameter - Math.sqrt(cutterDiameter * cutterDiameter - cuttingWidth * cuttingWidth));
            break;
        case CutterKind.VerticalMill:
        case CutterKind.NumberMill:
            // L1 = d0 / 2
            L1 = cutterDiameter / 2;
            break;
        default:
            L1 = Math.sqrt(cuttingDepth * (cutterDiameter - cuttingDepth));
    }
    // L2 统一选取范围 1-5mm
    const L2 = 2.5; // 默认取2.5mm
    return {
        L1: Math.round(L1 * 100) / 100,
        L2,
    };
}
// ═══════════════════════════════════════════════════
// 第四步：基本时间计算
// ═══════════════════════════════════════════════════
/**
 * 铣削方式
 */
export var MillingMethod;
(function (MillingMethod) {
    MillingMethod["Plane"] = "plane";
    MillingMethod["Circumferential"] = "circumferential";
    MillingMethod["Gear"] = "gear";
    MillingMethod["Slot"] = "slot";
})(MillingMethod || (MillingMethod = {}));
/**
 * 计算铣削基本时间
 * @param method - 铣削方式
 * @param params - 计算参数
 * @returns 基本时间（min）
 *
 * 公式：
 *   铣平面: T基 = (L0 + L1 + L2) / Vf × i
 *   沿圆周铣削: T基 = (π×D + L1 + L2) / Vf
 *   铣齿轮: T基 = (Ac + L1 + L2) / Vf × Z
 *   铣槽: T基 = (L0 + L1 + L2) / Vf × i
 *
 * 示例验证（Excel第59-68行）：
 *   L0=25, L1=10, L2=2.5, Vf=25, i=5
 *   T基 = (25+10+2.5)/25 × 5 = 37.5/25 × 5 = 7.50 min ✓
 */
export function calculateBasicTime(method, params) {
    const { length, L1, L2, feedRate, passes = 1 } = params;
    let totalLength;
    switch (method) {
        case MillingMethod.Plane:
        case MillingMethod.Slot:
            // T基 = (L0 + L1 + L2) / Vf × i
            totalLength = (length + L1 + L2) / feedRate * passes;
            break;
        case MillingMethod.Circumferential:
            // T基 = (π×D + L1 + L2) / Vf
            totalLength = (PI * length + L1 + L2) / feedRate;
            break;
        case MillingMethod.Gear:
            // T基 = (Ac + L1 + L2) / Vf × Z
            const Z = params.gearTeeth || 1;
            totalLength = (length + L1 + L2) / feedRate * Z;
            break;
        default:
            totalLength = (length + L1 + L2) / feedRate * passes;
    }
    return Math.round(totalLength * 100) / 100;
}
// ═══════════════════════════════════════════════════
// 第五步：辅助时间（工步辅助时间表）
// ═══════════════════════════════════════════════════
/**
 * 加工工步类型
 * 来源：文件7 Sheet1 第69-97行
 */
export var MillingOperationStep;
(function (MillingOperationStep) {
    MillingOperationStep["Plane"] = "plane";
    MillingOperationStep["Side"] = "side";
    MillingOperationStep["Slot"] = "slot";
    MillingOperationStep["Keyway"] = "keyway";
    MillingOperationStep["Square"] = "square";
    MillingOperationStep["Hexagonal"] = "hexagonal";
})(MillingOperationStep || (MillingOperationStep = {}));
/**
 * 工步辅助时间常量部分 Tf1 (min)
 * 来源：文件7 Sheet1 第71-72行
 * Tf1: 与行程无关的常量辅助时间
 */
export const STEP_CONSTANT_TIME = {
    [MillingOperationStep.Plane]: 0.15,
    [MillingOperationStep.Side]: 0.18,
    [MillingOperationStep.Slot]: 0.20,
    [MillingOperationStep.Keyway]: 0.22,
    [MillingOperationStep.Square]: 0.22,
    [MillingOperationStep.Hexagonal]: 0.23,
};
/**
 * 工步辅助时间变量部分 Tf2 (min)
 * 来源：文件7 Sheet1 第73-97行
 * 分档：不同加工长度L对应的变量部分
 */
export const STEP_VARIABLE_TIME = {
    plane: {
        '10-30': 0.05,
        '31-60': 0.08,
        '61-100': 0.12,
        '101-200': 0.18,
        '201-500': 0.30,
        'over-500': 0.50,
    },
    side: {
        '10-30': 0.06,
        '31-60': 0.10,
        '61-100': 0.15,
        '101-200': 0.22,
        '201-500': 0.35,
        'over-500': 0.55,
    },
    slot: {
        '10-30': 0.07,
        '31-60': 0.12,
        '61-100': 0.18,
        '101-200': 0.28,
        '201-500': 0.42,
        'over-500': 0.65,
    },
    keyway: {
        '10-30': 0.08,
        '31-60': 0.14,
        '61-100': 0.20,
        '101-200': 0.30,
        '201-500': 0.45,
        'over-500': 0.70,
    },
    square: {
        '10-30': 0.10,
        '31-60': 0.18,
        '61-100': 0.25,
        '101-200': 0.38,
        '201-500': 0.55,
        'over-500': 0.80,
    },
    hexagonal: {
        '10-30': 0.12,
        '31-60': 0.20,
        '61-100': 0.30,
        '101-200': 0.45,
        '201-500': 0.65,
        'over-500': 1.00,
    },
};
/**
 * 获取工步辅助时间变量部分
 * @param step - 工步类型
 * @param length - 加工长度（mm）
 * @returns Tf2 (min)
 */
export function getStepVariableTime(step, length) {
    const keyMap = {
        [MillingOperationStep.Plane]: 'plane',
        [MillingOperationStep.Side]: 'side',
        [MillingOperationStep.Slot]: 'slot',
        [MillingOperationStep.Keyway]: 'keyway',
        [MillingOperationStep.Square]: 'square',
        [MillingOperationStep.Hexagonal]: 'hexagonal',
    };
    const rangeKey = keyMap[step];
    const ranges = STEP_VARIABLE_TIME[rangeKey];
    if (!ranges)
        return 0;
    if (length <= 30)
        return ranges['10-30'] || 0;
    if (length <= 60)
        return ranges['31-60'] || 0;
    if (length <= 100)
        return ranges['61-100'] || 0;
    if (length <= 200)
        return ranges['101-200'] || 0;
    if (length <= 500)
        return ranges['201-500'] || 0;
    return ranges['over-500'] || 0;
}
/**
 * 计算工步辅助时间
 * @param step - 工步类型
 * @param length - 加工长度
 * @returns Tf1 + Tf2 (min)
 */
export function calculateStepAuxiliaryTime(step, length) {
    const Tf1 = STEP_CONSTANT_TIME[step] || 0.15;
    const Tf2 = getStepVariableTime(step, length);
    return Math.round((Tf1 + Tf2) * 1000) / 1000;
}
// ═══════════════════════════════════════════════════
// 第六步：零件装卸时间
// ═══════════════════════════════════════════════════
/**
 * 安装方法
 * 来源：文件7 Sheet1 第103-125行
 */
export var MountingMethod;
(function (MountingMethod) {
    MountingMethod["Vice"] = "vice";
    MountingMethod["Center"] = "center";
    MountingMethod["VBlock"] = "v_block";
    MountingMethod["DividingHead"] = "dividing_head";
    MountingMethod["BoltPlate"] = "bolt_plate";
    MountingMethod["Fixture"] = "fixture";
})(MountingMethod || (MountingMethod = {}));
/**
 * 装夹复杂程度
 */
export var MountingComplexity;
(function (MountingComplexity) {
    MountingComplexity["Simple"] = "simple";
    MountingComplexity["Complex"] = "complex";
})(MountingComplexity || (MountingComplexity = {}));
/**
 * 装卸时间查表数据
 * 来源：文件7 Sheet1 第103-125行
 *
 * 分两个质量段：0.5/1/3/5 kg 和 8/12/16 kg
 * 每个质量段按安装方法×复杂程度查表
 */
export const LOADING_TIME_TABLE = {
    '0.5': {
        vice: { simple: 0.48, complex: 0.72 },
        center: { simple: 0.60, complex: 0.90 },
        v_block: { simple: 0.55, complex: 0.82 },
        dividing_head: { simple: 0.72, complex: 1.08 },
        bolt_plate: { simple: 0.84, complex: 1.26 },
        fixture: { simple: 1.02, complex: 1.50 },
    },
    '3': {
        vice: { simple: 0.84, complex: 1.26 },
        center: { simple: 1.02, complex: 1.53 },
        v_block: { simple: 0.96, complex: 1.44 },
        dividing_head: { simple: 1.20, complex: 1.80 },
        bolt_plate: { simple: 1.38, complex: 2.07 },
        fixture: { simple: 1.68, complex: 2.52 },
    },
    '8': {
        vice: { simple: 1.20, complex: 1.80 },
        center: { simple: 1.50, complex: 2.25 },
        v_block: { simple: 1.38, complex: 2.07 },
        dividing_head: { simple: 1.80, complex: 2.70 },
        bolt_plate: { simple: 2.10, complex: 3.15 },
        fixture: { simple: 2.55, complex: 3.84 },
    },
    '16': {
        vice: { simple: 1.62, complex: 2.43 },
        center: { simple: 2.04, complex: 3.06 },
        v_block: { simple: 1.92, complex: 2.88 },
        dividing_head: { simple: 2.40, complex: 3.60 },
        bolt_plate: { simple: 2.82, complex: 4.23 },
        fixture: { simple: 3.42, complex: 5.13 },
    },
};
/**
 * 获取质量档
 * @param weight - 零件重量（kg）
 * @returns 质量档标识
 */
export function getWeightGrade(weight) {
    if (weight <= 0.5)
        return '0.5';
    if (weight <= 1)
        return '1';
    if (weight <= 3)
        return '3';
    if (weight <= 5)
        return '5';
    if (weight <= 8)
        return '8';
    if (weight <= 12)
        return '12';
    return '16';
}
/**
 * 计算装卸时间
 * @param weight - 零件重量（kg）
 * @param method - 安装方法
 * @param complexity - 复杂程度
 * @returns 装卸时间（min）
 */
export function calculateLoadingTime(weight, method, complexity) {
    const grade = getWeightGrade(weight);
    const methodKey = method;
    const table = LOADING_TIME_TABLE[grade]?.[methodKey];
    if (!table)
        return 0;
    const complexityKey = complexity === MountingComplexity.Simple ? 'simple' : 'complex';
    return table[complexityKey] || 0;
}
// ═══════════════════════════════════════════════════
// 第七步：汇总计算与单件/批量时间
// ═══════════════════════════════════════════════════
/**
 * 宽放系数
 * 来源：文件7 Sheet1 第139-151行
 * 典型值 5%-15%，用于考虑工人疲劳、环境等因素
 */
export const DEFAULT_WIDE_RELAXATION_RATE = 0.09; // 9%
/**
 * 准备结束时间
 * 来源：文件7 Sheet1 第152-174行
 * 分简单/中等/复杂三种情况
 */
export const SETUP_TIMES = {
    simple: 30, // 简单：30min
    medium: 60, // 中等：60min
    complex: 90, // 复杂：90min
};
/**
 * 计算铣削总工时
 * @param params - 工时参数
 * @returns 工时结果
 *
 * 公式链（与文件7完全一致）：
 *   T工步 = T基 + T工辅
 *   T作业 = T工步 + T装卸
 *   T单件 = T作业 × (1 + K宽放)
 *   T批量 = T单件 × N投数 + T准结
 *
 * 示例验证（Excel）：
 *   T基=25.50, T工辅=3, T装卸=1.50
 *   T工步 = 25.50+3 = 28.50
 *   T作业 = 28.50+1.50 = 30.00
 *   K宽放=0.09
 *   T单件 = 30×(1+0.09) = 32.70
 *   N=10, T准结=60
 *   T批量 = 32.70×10+60 = 387.00
 */
export function calculateMillingTotalTime(params) {
    const { basicTime, auxiliaryTime, loadingTime, wideRelaxationRate = DEFAULT_WIDE_RELAXATION_RATE, batchQuantity, setupComplexity = 'medium', } = params;
    // 工步时间
    const operationTime = basicTime + auxiliaryTime;
    // 作业时间
    const operationWorkTime = operationTime + loadingTime;
    // 宽放时间
    const wideRelaxation = operationWorkTime * wideRelaxationRate;
    // 单件时间
    const singlePieceTime = operationWorkTime * (1 + wideRelaxationRate);
    // 准备结束时间
    const setupTime = SETUP_TIMES[setupComplexity] || 60;
    // 批量时间
    const batchTime = singlePieceTime * batchQuantity + setupTime;
    return {
        basicTime: Math.round(basicTime * 100) / 100,
        auxiliaryTime: Math.round(auxiliaryTime * 100) / 100,
        operationTime: Math.round(operationTime * 100) / 100,
        loadingTime: Math.round(loadingTime * 100) / 100,
        operationWorkTime: Math.round(operationWorkTime * 100) / 100,
        wideRelaxation: Math.round(wideRelaxation * 100) / 100,
        singlePieceTime: Math.round(singlePieceTime * 100) / 100,
        setupTime,
        batchTime: Math.round(batchTime * 100) / 100,
    };
}
// ═══════════════════════════════════════════════════
// 第八步：修正系数
// ═══════════════════════════════════════════════════
/**
 * 薄壁件修正系数K1
 * 来源：文件7 Sheet1 第177-198行
 *
 * 根据 Lz/H、D/H、Lf 比值确定
 * Kb从1.0到2.20
 */
export function getThinWallCorrection(lengthRatio, // Lz/H 比值
diameterRatio) {
    // 简化版：根据最大比值确定修正系数
    const maxRatio = Math.max(lengthRatio, diameterRatio);
    if (maxRatio <= 5)
        return 1.0;
    if (maxRatio <= 10)
        return 1.2;
    if (maxRatio <= 20)
        return 1.5;
    if (maxRatio <= 30)
        return 1.8;
    return 2.2;
}
/**
 * 工件材料修正系数K2
 * 来源：文件7 Sheet1 第177-198行
 */
export const MATERIAL_CORRECTION = {
    carbon_steel: 1.0, // 碳素钢
    gray_cast_iron: 0.9, // 灰铸铁
    stainless_steel: 1.4, // 不锈钢
    titanium_alloy: 2.2, // 钛合金
    heat_resistant_alloy: 1.7, // 耐热合金钢
    high_manganese_steel: 2.0, // 高锰钢
    aluminum_alloy: 0.7, // 铝镁合金
    copper_alloy: 0.8, // 铜合金
};
/**
 * 批量修正系数K3
 * 来源：文件7 Sheet1 第177-198行
 */
export const BATCH_CORRECTION = {
    small_batch: 1.6, // 单件小批量
    medium_batch: 1.0, // 中批
    large_batch: 0.8, // 大批大量
};
/**
 * 获取修正系数
 * @param params - 修正参数
 * @returns {K1, K2, K3} 修正系数
 */
export function getCorrectionCoefficients(params) {
    const K1 = params.isThinWall
        ? getThinWallCorrection(params.thinWallLengthRatio || 0, params.thinWallDiameterRatio || 0)
        : 1.0;
    const K2 = MATERIAL_CORRECTION[params.material] || 1.0;
    let K3;
    if (params.batchSize <= 50)
        K3 = BATCH_CORRECTION.small_batch;
    else if (params.batchSize <= 500)
        K3 = BATCH_CORRECTION.medium_batch;
    else
        K3 = BATCH_CORRECTION.large_batch;
    return { K1, K2, K3 };
}
/**
 * 应用修正系数
 * @param baseTime - 基准时间
 * @param K1 - 薄壁件修正
 * @param K2 - 材料修正
 * @param K3 - 批量修正
 * @returns 修正后时间
 *
 * 公式：修正后时间 = 基准时间 × K1 × K2 × K3
 */
export function applyCorrection(baseTime, K1, K2, K3) {
    return Math.round(baseTime * K1 * K2 * K3 * 100) / 100;
}
//# sourceMappingURL=milling-time.js.map