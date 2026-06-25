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
/**
 * 铣削加工基础参数
 * 来源：文件7 Sheet1 第2-6行
 */
export interface MillingBaseParams {
    cuttingWidth: number;
    cuttingDepth: number;
    workpieceLength: number;
    feedPerTooth: number;
    cutterDiameter: number;
    cuttingSpeed: number;
    cutterTeeth: number;
}
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
export declare function calculateMillingBase(params: MillingBaseParams): {
    feedPerRev: number;
    cuttingSpeedRPM: number;
    feedRate: number;
};
/**
 * 铣刀类型
 */
export declare enum MillingToolMaterial {
    HighSpeedSteel = "hss",// 高速钢
    Carbide = "carbide"
}
/**
 * 加工性质
 */
export declare enum MillingOperationType {
    Rough = "rough",// 粗加工
    Finish = "finish"
}
/**
 * 推荐铣削深度
 * 来源：文件7 Sheet1 第9-11行
 */
export declare const RECOMMENDED_CUTTING_DEPTH: Record<MillingToolMaterial, Record<MillingOperationType, {
    min: number;
    max: number;
}>>;
/**
 * 检查铣削深度是否合理
 * @param depth - 设定的铣削深度（mm）
 * @param cutterType - 铣刀类型
 * @param operationType - 加工性质
 * @returns {合理, 推荐范围}
 */
export declare function checkCuttingDepth(depth: number, cutterType: MillingToolMaterial, operationType: MillingOperationType): {
    reasonable: boolean;
    min: number;
    max: number;
    recommended: number;
};
/**
 * 铣刀种类
 * 来源：文件7 Sheet1 第47-58行
 */
export declare enum CutterKind {
    Cylindrical = "cylindrical",// 圆柱铣刀
    SideFaceMill = "side_face_mill",// 三面刃铣刀
    DiscMill = "disc_mill",// 圆盘铣刀
    SawMill = "saw_mill",// 锯片铣刀
    EndMill = "end_mill",// 端铣刀
    VerticalMill = "vertical_mill",// 立铣刀
    NumberMill = "number_mill"
}
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
export declare function calculateCuttingAmount(kind: CutterKind, cuttingWidth: number, // Ac (mm)
cuttingDepth: number, // Ap (mm)
cutterDiameter: number): {
    L1: number;
    L2: number;
};
/**
 * 铣削方式
 */
export declare enum MillingMethod {
    Plane = "plane",// 铣平面
    Circumferential = "circumferential",// 沿圆周进给铣削
    Gear = "gear",// 铣齿轮
    Slot = "slot"
}
/**
 * 基本时间计算结果
 */
export interface BasicTimeResult {
    method: MillingMethod;
    L0: number;
    L1: number;
    L2: number;
    feedRate: number;
    passes: number;
    gearTeeth?: number;
    gearWidth?: number;
    basicTime: number;
}
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
export declare function calculateBasicTime(method: MillingMethod, params: {
    length: number;
    L1: number;
    L2: number;
    feedRate: number;
    passes?: number;
    gearTeeth?: number;
}): number;
/**
 * 加工工步类型
 * 来源：文件7 Sheet1 第69-97行
 */
export declare enum MillingOperationStep {
    Plane = "plane",// 铣平面
    Side = "side",// 铣侧面（台阶）
    Slot = "slot",// 铣槽
    Keyway = "keyway",// 铣键槽
    Square = "square",// 铣四方
    Hexagonal = "hexagonal"
}
/**
 * 工步辅助时间常量部分 Tf1 (min)
 * 来源：文件7 Sheet1 第71-72行
 * Tf1: 与行程无关的常量辅助时间
 */
export declare const STEP_CONSTANT_TIME: Record<MillingOperationStep, number>;
/**
 * 工步辅助时间变量部分 Tf2 (min)
 * 来源：文件7 Sheet1 第73-97行
 * 分档：不同加工长度L对应的变量部分
 */
export declare const STEP_VARIABLE_TIME: Record<string, Record<string, number>>;
/**
 * 获取工步辅助时间变量部分
 * @param step - 工步类型
 * @param length - 加工长度（mm）
 * @returns Tf2 (min)
 */
export declare function getStepVariableTime(step: MillingOperationStep, length: number): number;
/**
 * 计算工步辅助时间
 * @param step - 工步类型
 * @param length - 加工长度
 * @returns Tf1 + Tf2 (min)
 */
export declare function calculateStepAuxiliaryTime(step: MillingOperationStep, length: number): number;
/**
 * 安装方法
 * 来源：文件7 Sheet1 第103-125行
 */
export declare enum MountingMethod {
    Vice = "vice",// 虎钳/三爪卡盘
    Center = "center",// 顶尖/专用夹具
    VBlock = "v_block",// V型铁/三角铁
    DividingHead = "dividing_head",// 分度头
    BoltPlate = "bolt_plate",// 螺栓压板
    Fixture = "fixture"
}
/**
 * 装夹复杂程度
 */
export declare enum MountingComplexity {
    Simple = "simple",// A: 形状规则不需找正
    Complex = "complex"
}
/**
 * 装卸时间查表数据
 * 来源：文件7 Sheet1 第103-125行
 *
 * 分两个质量段：0.5/1/3/5 kg 和 8/12/16 kg
 * 每个质量段按安装方法×复杂程度查表
 */
export declare const LOADING_TIME_TABLE: Record<string, Record<string, Record<string, number>>>;
/**
 * 获取质量档
 * @param weight - 零件重量（kg）
 * @returns 质量档标识
 */
export declare function getWeightGrade(weight: number): string;
/**
 * 计算装卸时间
 * @param weight - 零件重量（kg）
 * @param method - 安装方法
 * @param complexity - 复杂程度
 * @returns 装卸时间（min）
 */
export declare function calculateLoadingTime(weight: number, method: MountingMethod, complexity: MountingComplexity): number;
/**
 * 宽放系数
 * 来源：文件7 Sheet1 第139-151行
 * 典型值 5%-15%，用于考虑工人疲劳、环境等因素
 */
export declare const DEFAULT_WIDE_RELAXATION_RATE = 0.09;
/**
 * 准备结束时间
 * 来源：文件7 Sheet1 第152-174行
 * 分简单/中等/复杂三种情况
 */
export declare const SETUP_TIMES: Record<string, number>;
/**
 * 铣削工时计算结果
 */
export interface MillingTimeResult {
    basicTime: number;
    auxiliaryTime: number;
    operationTime: number;
    loadingTime: number;
    operationWorkTime: number;
    wideRelaxation: number;
    singlePieceTime: number;
    setupTime: number;
    batchTime: number;
}
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
export declare function calculateMillingTotalTime(params: {
    basicTime: number;
    auxiliaryTime: number;
    loadingTime: number;
    wideRelaxationRate?: number;
    batchQuantity: number;
    setupComplexity?: 'simple' | 'medium' | 'complex';
}): MillingTimeResult;
/**
 * 薄壁件修正系数K1
 * 来源：文件7 Sheet1 第177-198行
 *
 * 根据 Lz/H、D/H、Lf 比值确定
 * Kb从1.0到2.20
 */
export declare function getThinWallCorrection(lengthRatio: number, // Lz/H 比值
diameterRatio: number): number;
/**
 * 工件材料修正系数K2
 * 来源：文件7 Sheet1 第177-198行
 */
export declare const MATERIAL_CORRECTION: Record<string, number>;
/**
 * 批量修正系数K3
 * 来源：文件7 Sheet1 第177-198行
 */
export declare const BATCH_CORRECTION: Record<string, number>;
/**
 * 获取修正系数
 * @param params - 修正参数
 * @returns {K1, K2, K3} 修正系数
 */
export declare function getCorrectionCoefficients(params: {
    isThinWall?: boolean;
    thinWallLengthRatio?: number;
    thinWallDiameterRatio?: number;
    material: string;
    batchSize: number;
}): {
    K1: number;
    K2: number;
    K3: number;
};
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
export declare function applyCorrection(baseTime: number, K1: number, K2: number, K3: number): number;
//# sourceMappingURL=milling-time.d.ts.map