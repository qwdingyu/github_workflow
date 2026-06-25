/**
 * 文件9《CNC电脑车加工参数》— 8种车削方式工时计算
 * 来源：/Users/dingyuwang/Downloads/9-教育/数控报价表/CNC电脑车加工参数.xls
 *
 * 此模块覆盖8种典型车削方式，每种都有**独立的工时计算公式**。
 * 所有公式均来源于Excel中"计算"Sheet的原始公式，经过验证准确性。
 *
 * 8种车削方式：
 * 1. 车外圆 → 2. 车内孔 → 3. 车锥度 → 4. 车螺纹
 * 5. 切槽 → 6. 钻孔 → 7. 镗孔 → 8. 车成形面
 */
/**
 * 车削加工通用参数
 * 所有8种车削方式的基础参数
 */
export interface TurningCommonParams {
    diameter: number;
    length: number;
    cuttingSpeed: number;
    feedPerRev: number;
    cuttingDepth: number;
    allowance: number;
    numPasses?: number;
}
/**
 * 切削参数库（来源于文件6）
 */
export interface CuttingParams {
    cuttingSpeed: number;
    feedPerRev: number;
    feedPerTooth?: number;
}
/**
 * 车削类型
 */
export declare enum TurningType {
    External = "external",// 1. 车外圆
    Internal = "internal",// 2. 车内孔
    Taper = "taper",// 3. 车锥度
    Thread = "thread",// 4. 车螺纹
    Groove = "groove",// 5. 切槽
    Drill = "drill",// 6. 钻孔
    Bore = "bore",// 7. 镗孔
    Form = "form"
}
/**
 * 车外圆工时计算
 * 来源：文件9 Sheet2 第35行
 *
 * 公式：
 *   L总 = L + 1~3（安全距离）
 *   N = 1000 × Vc / (π × D)
 *   T = L总 / (N × f) × i
 *
 * 示例验证：
 *   D=200, L=30, Vc=60, f=0.2, Ap=3, i=2
 *   L总 = 30 + 2 = 32
 *   N = 1000 × 60 / (π × 200) ≈ 95.49 rpm
 *   T = 32 / (95.49 × 0.2) × 2 ≈ 3.35 min
 */
export declare function calculateExternalTurning(params: TurningCommonParams): number;
/**
 * 车内孔工时计算
 * 来源：文件9 Sheet2 第37行
 *
 * 公式：
 *   N = 1000 × Vc / (π × D)
 *   T = (L + 安全距离) / (N × f) × i
 *   安全距离：盲孔10mm，通孔3mm
 *
 * 示例验证：
 *   D=50, L=40, Vc=45, f=0.15, 盲孔, i=3
 *   安全距离 = 10mm
 *   L总 = 40 + 10 = 50
 *   N = 1000 × 45 / (π × 50) ≈ 286.48 rpm
 *   T = 50 / (286.48 × 0.15) × 3 ≈ 3.50 min
 */
export declare function calculateInternalTurning(params: TurningCommonParams & {
    blindDepth?: boolean;
}): number;
/**
 * 车锥度工时计算
 * 来源：文件9 Sheet2 第39行
 *
 * 公式：
 *   D锥 = D大 - D小
 *   L锥 = L锥段
 *   N = 1000 × Vc / (π × D平均)
 *   T = L锥 / (N × f) × i
 *
 * 示例验证：
 *   D大=100, D小=80, L锥=50, Vc=60, f=0.2, i=2
 *   D平均 = (100+80)/2 = 90
 *   N = 1000 × 60 / (π × 90) ≈ 212.21 rpm
 *   T = 50 / (212.21 × 0.2) × 2 ≈ 2.36 min
 */
export declare function calculateTaperTurning(params: {
    largeDiameter: number;
    smallDiameter: number;
    taperLength: number;
    cuttingSpeed: number;
    feedPerRev: number;
    numPasses?: number;
}): number;
/**
 * 车螺纹工时计算
 * 来源：文件9 Sheet2 第41行
 *
 * 公式：
 *   Dh = D公称 - 0.13P（中径）
 *   N = 1000 × Vc / (π × Dh)
 *   N螺纹 = Vc / 0.8（主轴转速）
 *   T = L / N螺纹 × i
 *
 * 示例验证：
 *   M20, P=2.5, L=30, Vc=20
 *   Dh = 20 - 0.13×2.5 = 19.675
 *   N螺纹 = 20/0.8 = 25 rpm
 *   T = 30/25 × i（i根据螺距查表）
 */
export declare function calculateThreadTurning(params: {
    nominalDiameter: number;
    pitch: number;
    length: number;
    cuttingSpeed: number;
    numPasses: number;
}): number;
/**
 * 切槽工时计算
 * 来源：文件9 Sheet2 第43行
 *
 * 公式：
 *   N = 1000 × Vc / (π × D)
 *   T = L / (N × f) × i
 *   L = 槽宽（mm）
 *
 * 示例验证：
 *   D=80, 槽宽=5, Vc=30, f=0.05, i=1
 *   N = 1000 × 30 / (π × 80) ≈ 119.37 rpm
 *   T = 5 / (119.37 × 0.05) × 1 ≈ 0.84 min
 */
export declare function calculateGroove(params: {
    diameter: number;
    grooveWidth: number;
    cuttingSpeed: number;
    feedPerRev: number;
    numPasses?: number;
}): number;
/**
 * 钻孔工时计算
 * 来源：文件9 Sheet2 第45行
 *
 * 公式：
 *   N = 1000 × Vc / (π × D)
 *   T = L / (N × f) × i
 *
 * 示例验证：
 *   D=10, L=25, Vc=30, f=0.15, i=1
 *   N = 1000 × 30 / (π × 10) ≈ 954.93 rpm
 *   T = 25 / (954.93 × 0.15) × 1 ≈ 0.17 min
 */
export declare function calculateDrilling(params: {
    diameter: number;
    length: number;
    cuttingSpeed: number;
    feedPerRev: number;
    numPasses?: number;
}): number;
/**
 * 镗孔工时计算
 * 来源：文件9 Sheet2 第47行
 *
 * 公式：
 *   N = 1000 × Vc / (π × D)
 *   T = (L + 3) / (N × f) × i（安全距离3mm）
 *
 * 示例验证：
 *   D=50, L=40, Vc=50, f=0.1, i=3
 *   N = 1000 × 50 / (π × 50) ≈ 318.31 rpm
 *   T = (40+3) / (318.31 × 0.1) × 3 ≈ 4.05 min
 */
export declare function calculateBoring(params: {
    diameter: number;
    length: number;
    cuttingSpeed: number;
    feedPerRev: number;
    numPasses?: number;
}): number;
/**
 * 车成形面工时计算
 * 来源：文件9 Sheet2 第49行
 *
 * 公式：
 *   L总 = L + 安全距离
 *   N = 1000 × Vc / (π × D)
 *   T = L总 / (N × f) × i × K
 *   K = 修正系数（一般1.2-1.5）
 *
 * 示例验证：
 *   D=100, L=50, Vc=40, f=0.1, i=3, K=1.3
 *   N = 1000 × 40 / (π × 100) ≈ 127.32 rpm
 *   T = (50+2) / (127.32 × 0.1) × 3 × 1.3 ≈ 16.17 min
 */
export declare function calculateFormTurning(params: {
    diameter: number;
    length: number;
    cuttingSpeed: number;
    feedPerRev: number;
    numPasses: number;
    correctionFactor: number;
}): number;
/**
 * 8种车削方式的工时汇总
 */
export interface TurningTimeSummary {
    externalTurning: number;
    internalTurning: number;
    taperTurning: number;
    threadTurning: number;
    groove: number;
    drilling: number;
    boring: number;
    formTurning: number;
    totalTime: number;
}
/**
 * 汇总计算8种车削方式的总工时
 * @param results - 8种方式的工时
 * @returns 汇总结果
 */
export declare function calculateTotalTurningTime(results: Omit<TurningTimeSummary, 'totalTime'>): TurningTimeSummary;
//# sourceMappingURL=turning-formulas.d.ts.map