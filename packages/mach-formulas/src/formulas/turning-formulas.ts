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

import { PI } from './math-utils';

// ═══════════════════════════════════════════════════
// 通用参数定义
// ═══════════════════════════════════════════════════

/**
 * 车削加工通用参数
 * 所有8种车削方式的基础参数
 */
export interface TurningCommonParams {
  diameter: number;           // 直径 D (mm)
  length: number;             // 加工长度 L (mm)
  cuttingSpeed: number;       // 切削速度 Vc (m/min)
  feedPerRev: number;         // 进给量 f (mm/rev)
  cuttingDepth: number;       // 切深 Ap (mm)
  allowance: number;          // 加工余量 (mm)
  numPasses?: number;         // 加工道数
}

/**
 * 切削参数库（来源于文件6）
 */
export interface CuttingParams {
  cuttingSpeed: number;       // Vc (m/min)
  feedPerRev: number;        // f (mm/rev)
  feedPerTooth?: number;     // af (mm/tooth)
}

/**
 * 车削类型
 */
export enum TurningType {
  External = 'external',           // 1. 车外圆
  Internal = 'internal',           // 2. 车内孔
  Taper = 'taper',                 // 3. 车锥度
  Thread = 'thread',               // 4. 车螺纹
  Groove = 'groove',               // 5. 切槽
  Drill = 'drill',                 // 6. 钻孔
  Bore = 'bore',                   // 7. 镗孔
  Form = 'form',                   // 8. 车成形面
}

// ═══════════════════════════════════════════════════
// 1. 车外圆
// ═══════════════════════════════════════════════════

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
export function calculateExternalTurning(params: TurningCommonParams): number {
  const { diameter, length, cuttingSpeed, feedPerRev, numPasses = 1 } = params;
  
  const L = length + 2; // 安全距离取2mm
  const N = (1000 * cuttingSpeed) / (PI * diameter);
  const T = L / (N * feedPerRev) * numPasses;
  
  return Math.round(T * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 2. 车内孔
// ═══════════════════════════════════════════════════

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
export function calculateInternalTurning(
  params: TurningCommonParams & { blindDepth?: boolean },
): number {
  const { diameter, length, cuttingSpeed, feedPerRev, numPasses = 1, blindDepth = true } = params;
  
  const safetyDistance = blindDepth ? 10 : 3;
  const L = length + safetyDistance;
  const N = (1000 * cuttingSpeed) / (PI * diameter);
  const T = L / (N * feedPerRev) * numPasses;
  
  return Math.round(T * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 3. 车锥度
// ═══════════════════════════════════════════════════

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
export function calculateTaperTurning(params: {
  largeDiameter: number;      // D大
  smallDiameter: number;      // D小
  taperLength: number;        // L锥段
  cuttingSpeed: number;       // Vc
  feedPerRev: number;         // f
  numPasses?: number;         // i
}): number {
  const { largeDiameter, smallDiameter, taperLength, cuttingSpeed, feedPerRev, numPasses = 1 } = params;
  
  const Davg = (largeDiameter + smallDiameter) / 2;
  const N = (1000 * cuttingSpeed) / (PI * Davg);
  const T = taperLength / (N * feedPerRev) * numPasses;
  
  return Math.round(T * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 4. 车螺纹
// ═══════════════════════════════════════════════════

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
export function calculateThreadTurning(params: {
  nominalDiameter: number;    // D公称
  pitch: number;              // P（螺距）
  length: number;             // L
  cuttingSpeed: number;       // Vc
  numPasses: number;          // i（根据螺距查表）
}): number {
  const { nominalDiameter, pitch, length, cuttingSpeed, numPasses } = params;
  
  const Dh = nominalDiameter - 0.13 * pitch;
  const threadSpeed = cuttingSpeed / 0.8;
  const T = length / threadSpeed * numPasses;
  
  return Math.round(T * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 5. 切槽
// ═══════════════════════════════════════════════════

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
export function calculateGroove(params: {
  diameter: number;       // D
  grooveWidth: number;    // 槽宽 L
  cuttingSpeed: number;   // Vc
  feedPerRev: number;     // f
  numPasses?: number;     // i
}): number {
  const { diameter, grooveWidth, cuttingSpeed, feedPerRev, numPasses = 1 } = params;
  
  const N = (1000 * cuttingSpeed) / (PI * diameter);
  const T = grooveWidth / (N * feedPerRev) * numPasses;
  
  return Math.round(T * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 6. 钻孔
// ═══════════════════════════════════════════════════

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
export function calculateDrilling(params: {
  diameter: number;       // D
  length: number;         // L
  cuttingSpeed: number;   // Vc
  feedPerRev: number;     // f
  numPasses?: number;     // i
}): number {
  const { diameter, length, cuttingSpeed, feedPerRev, numPasses = 1 } = params;
  
  const N = (1000 * cuttingSpeed) / (PI * diameter);
  const T = length / (N * feedPerRev) * numPasses;
  
  return Math.round(T * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 7. 镗孔
// ═══════════════════════════════════════════════════

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
export function calculateBoring(params: {
  diameter: number;       // D
  length: number;         // L
  cuttingSpeed: number;   // Vc
  feedPerRev: number;     // f
  numPasses?: number;     // i
}): number {
  const { diameter, length, cuttingSpeed, feedPerRev, numPasses = 1 } = params;
  
  const L = length + 3; // 安全距离3mm
  const N = (1000 * cuttingSpeed) / (PI * diameter);
  const T = L / (N * feedPerRev) * numPasses;
  
  return Math.round(T * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 8. 车成形面
// ═══════════════════════════════════════════════════

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
export function calculateFormTurning(params: {
  diameter: number;       // D
  length: number;         // L
  cuttingSpeed: number;   // Vc
  feedPerRev: number;     // f
  numPasses: number;      // i
  correctionFactor: number; // K
}): number {
  const { diameter, length, cuttingSpeed, feedPerRev, numPasses, correctionFactor } = params;
  
  const L = length + 2; // 安全距离2mm
  const N = (1000 * cuttingSpeed) / (PI * diameter);
  const T = L / (N * feedPerRev) * numPasses * correctionFactor;
  
  return Math.round(T * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 总工时汇总
// ═══════════════════════════════════════════════════

/**
 * 8种车削方式的工时汇总
 */
export interface TurningTimeSummary {
  externalTurning: number;    // 1. 车外圆
  internalTurning: number;    // 2. 车内孔
  taperTurning: number;       // 3. 车锥度
  threadTurning: number;      // 4. 车螺纹
  groove: number;             // 5. 切槽
  drilling: number;           // 6. 钻孔
  boring: number;             // 7. 镗孔
  formTurning: number;        // 8. 车成形面
  totalTime: number;          // 总工时
}

/**
 * 汇总计算8种车削方式的总工时
 * @param results - 8种方式的工时
 * @returns 汇总结果
 */
export function calculateTotalTurningTime(results: Omit<TurningTimeSummary, 'totalTime'>): TurningTimeSummary {
  const total =
    results.externalTurning +
    results.internalTurning +
    results.taperTurning +
    results.threadTurning +
    results.groove +
    results.drilling +
    results.boring +
    results.formTurning;

  return {
    ...results,
    totalTime: Math.round(total * 100) / 100,
  };
}
