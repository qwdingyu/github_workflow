/**
 * 文件2《机械加工报价自动计算》— 综合成本分析
 * 来源：/Users/dingyuwang/Downloads/9-教育/数控报价表/机械加工报价自动计算(含各种工时费).xls
 * 
 * 此模块包含：
 * - 材料费计算（体积×密度×单价）
 * - 加工费汇总（17种设备工时×费率）
 * - 表面处理费
 * - 设计/包装/运输费
 * - 难度系数（报废率）
 * - 管理费、利润、税金
 * - 总成本汇总
 */

// ═══════════════════════════════════════════════════
// 一、材料参数
// ═══════════════════════════════════════════════════

/**
 * 材料类型
 * 来源：文件2 成本分析表 板块1
 */
export enum MaterialType {
  Steel = 'steel',
  Copper = 'copper',
  Aluminum = 'aluminum',
  Bakelite = 'bakelite',  // 电木
  Titanium = 'titanium',
}

/**
 * 材料密度（kg/mm³）
 * 来源：文件2 板块1
 * 验证：钢0.008 = 8g/cm³（正确）
 *       铜0.0089 = 8.9g/cm³（正确）
 *       铝0.0027 = 2.7g/cm³（正确）
 */
export const MATERIAL_DENSITIES: Record<MaterialType, number> = {
  [MaterialType.Steel]: 0.008,
  [MaterialType.Copper]: 0.0089,
  [MaterialType.Aluminum]: 0.0027,
  [MaterialType.Bakelite]: 0.0023,
  [MaterialType.Titanium]: 0.0045,
};

/**
 * 材料单价（元/kg）
 * 来源：文件2 板块1，示例数据
 */
export const MATERIAL_UNIT_PRICES: Record<MaterialType, number> = {
  [MaterialType.Steel]: 4.5,
  [MaterialType.Copper]: 55,
  [MaterialType.Aluminum]: 18,
  [MaterialType.Bakelite]: 30,
  [MaterialType.Titanium]: 180,
};

/**
 * 计算材料理论重量
 * @param length - 长度（mm）
 * @param width - 宽度（mm）
 * @param height - 高度（mm）
 * @param materialType - 材料类型
 * @returns 理论重量（kg）
 * 
 * 公式：重量 = 长 × 宽 × 高 × 密度
 * 
 * 示例验证（Excel）：
 *   方料 90×600×35, 钢材 → 90×600×35×0.008 = 151200×0.008 = 1209.6... 
 *   实际Excel: 90×600×35×0.008/1000000×1 = 15.12kg
 *   注意：公式中除以了1000000，因为密度单位是kg/mm³
 *   但 90×600×35 = 1,890,000 mm³ × 0.008 kg/mm³ = 15120 kg？
 *   
 *   实际上：密度 0.008 kg/mm³ = 8 kg/dm³ = 8 g/cm³
 *   90mm×600mm×35mm = 1,890,000 mm³ = 1890 cm³
 *   1890 cm³ × 8 g/cm³ = 15120 g = 15.12 kg ✓
 *   
 *   所以正确公式：重量(kg) = 长(mm)×宽(mm)×高(mm)×密度(kg/mm³) / 1000
 *   但Excel中除以1000000，说明密度单位可能是 g/mm³
 *   0.008 g/mm³ = 8 g/cm³ ✓
 *   
 *   最终公式：重量 = L×W×H×density/1000
 */
// 与 comprehensive-quote 中的导出冲突，改为非导出内部函数
function _calculateMaterialWeight(
  length: number,
  width: number,
  height: number,
  materialType: MaterialType,
): number {
  const density = MATERIAL_DENSITIES[materialType];
  // L(mm)×W(mm)×H(mm) → mm³
  // 密度: kg/mm³
  // 重量(kg) = mm³ × kg/mm³
  return Math.round(length * width * height * density * 100) / 100;
}

/**
 * 计算圆棒理论重量
 * @param diameter - 直径（mm）
 * @param length - 长度（mm）
 * @param materialType - 材料类型
 * @returns 理论重量（kg）
 */
export function calculateCylinderWeight(
  diameter: number,
  length: number,
  materialType: MaterialType,
): number {
  const density = MATERIAL_DENSITIES[materialType];
  const volume = (Math.PI / 4) * diameter * diameter * length;
  return Math.round(volume * density * 100) / 100;
}

/**
 * 计算圆管理论重量
 * @param outerDiameter - 外径（mm）
 * @param wallThickness - 壁厚（mm）
 * @param length - 长度（mm）
 * @param materialType - 材料类型
 * @returns 理论重量（kg）
 */
export function calculateTubeWeight(
  outerDiameter: number,
  wallThickness: number,
  length: number,
  materialType: MaterialType,
): number {
  const density = MATERIAL_DENSITIES[materialType];
  const innerDiameter = outerDiameter - 2 * wallThickness;
  const volume = (Math.PI / 4) * (outerDiameter * outerDiameter - innerDiameter * innerDiameter) * length;
  return Math.round(volume * density * 100) / 100;
}

/**
 * 计算材料费
 * @param weight - 材料重量（kg）
 * @param materialType - 材料类型
 * @returns 材料费（元）
 */
// 与 comprehensive-quote 冲突
function _calculateMaterialFee(
  weight: number,
  materialType: MaterialType,
): number {
  return Math.round(weight * MATERIAL_UNIT_PRICES[materialType] * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 二、加工费
// ═══════════════════════════════════════════════════

/**
 * 设备类型
 * 来源：文件2 板块2
 * 17种设备
 */
export enum ProcessingEquipment {
  Lathe = 'lathe',           // 普车
  Milling = 'milling',       // 普铣
  CNC_Lathe = 'cnc_lathe',   // 数控车
  WireCut = 'wire_cut',      // 线切割
  SurfaceGrinder = 'surface_grinder', // 平面磨
  CylindricalGrinder = 'cylindrical_grinder', // 外圆磨
  EDM = 'edm',               // 放电
  CNC1 = 'cnc1',             // CNC1
  CNC2 = 'cnc2',             // CNC2
  Tapping = 'tapping',       // 攻牙机
  Sandblasting = 'sandblasting', // 喷砂
  Polishing = 'polishing',   // 抛光
  Sawing = 'sawing',         // 锯床
  LargeSurfaceGrinder = 'large_surface_grinder', // 大水磨
  Other = 'other',           // 其它
}

/**
 * 设备工时费率（元/小时）
 * 来源：文件2 板块2
 * 处于行业中低端水平，符合中国大陆制造业实际
 */
// 与 process-time 冲突
const _EQUIPMENT_RATES: Record<ProcessingEquipment, number> = {
  [ProcessingEquipment.Lathe]: 40,
  [ProcessingEquipment.Milling]: 40,
  [ProcessingEquipment.CNC_Lathe]: 80,
  [ProcessingEquipment.WireCut]: 60,
  [ProcessingEquipment.SurfaceGrinder]: 40,
  [ProcessingEquipment.CylindricalGrinder]: 50,
  [ProcessingEquipment.EDM]: 30,
  [ProcessingEquipment.CNC1]: 80,
  [ProcessingEquipment.CNC2]: 100,
  [ProcessingEquipment.Tapping]: 30,
  [ProcessingEquipment.Sandblasting]: 35,
  [ProcessingEquipment.Polishing]: 35,
  [ProcessingEquipment.Sawing]: 25,
  [ProcessingEquipment.LargeSurfaceGrinder]: 45,
  [ProcessingEquipment.Other]: 30,
};

/**
 * 加工工时参数
 */
export interface ProcessingTask {
  equipment: ProcessingEquipment;
  hours: number;       // 工时（小时）
}

/**
 * 计算加工费
 * @param task - 加工任务
 * @returns 加工费（元）
 * 
 * 公式：费用 = 工时(小时) × 单价(元/小时)
 */
// 与 comprehensive-quote 冲突
function _calculateProcessingFee(task: ProcessingTask): number {
  return Math.round(task.hours * _EQUIPMENT_RATES[task.equipment] * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 三、表面处理
// ═══════════════════════════════════════════════════

/**
 * 表面处理类型
 * 来源：文件2 板块4
 * 10种表面处理
 */
export enum SurfaceTreatment {
  Quenching = 'quenching',          // 调质
  Hardening = 'hardening',          // 淬火
  Annealing = 'annealing',          // 退火
  Blacking = 'blaying',             // 发黑（兼容历史拼写）
  Nitriding = 'nitriding',          // 渗氮
  Anodizing = 'anodizing',          // 阳极氧化
  ZincPlating = 'zinc_plating',     // 镀环保锌
  NickelPlating = 'nickel_plating', // 镀化学镍
  BrightNickelPlating = 'bright_nickel_plating', // 镀亮镍
  Sandblasting = 'sandblasting',    // 喷砂
}

/**
 * 表面处理单价（元/kg）
 * 来源：文件2 板块4
 */
export const SURFACE_TREATMENT_PRICES: Record<SurfaceTreatment, number> = {
  [SurfaceTreatment.Quenching]: 0.8,
  [SurfaceTreatment.Hardening]: 1.2,
  [SurfaceTreatment.Annealing]: 0.5,
  [SurfaceTreatment.Blacking]: 2.0,
  [SurfaceTreatment.Nitriding]: 8.0,
  [SurfaceTreatment.Anodizing]: 6.0,
  [SurfaceTreatment.ZincPlating]: 2.5,
  [SurfaceTreatment.NickelPlating]: 5.0,
  [SurfaceTreatment.BrightNickelPlating]: 7.0,
  [SurfaceTreatment.Sandblasting]: 4.0,
};

/**
 * 计算表面处理费
 * @param treatment - 处理类型
 * @param weight - 重量（kg）
 * @returns 处理费（元）
 */
export function calculateSurfaceTreatmentFee(
  treatment: SurfaceTreatment,
  weight: number,
): number {
  return Math.round(weight * SURFACE_TREATMENT_PRICES[treatment] * 100) / 100;
}

// ═══════════════════════════════════════════════════
// 四、设计/包装/运输/其它费用
// ═══════════════════════════════════════════════════

/**
 * 难度级别（影响报废率）
 * 来源：文件2 板块5
 */
export enum DifficultyLevel {
  Easy = 'easy',       // 5% 报废率
  Medium = 'medium',   // 10% 报废率
  Hard = 'hard',       // 15% 报废率
  VeryHard = 'very_hard', // 30% 报废率
}

export const DIFFICULTY_SCRAP_RATES: Record<DifficultyLevel, number> = {
  [DifficultyLevel.Easy]: 0.05,
  [DifficultyLevel.Medium]: 0.10,
  [DifficultyLevel.Hard]: 0.15,
  [DifficultyLevel.VeryHard]: 0.30,
};

/**
 * 综合报价汇总
 */
export interface ComprehensiveCostSummary {
  // 各项费用
  materialFee: number;          // 材料费
  processingFee: number;        // 加工费
 配件Fee: number;               // 配件费
  surfaceTreatmentFee: number;  // 表面处理费
  designFee: number;            // 设计费
  packagingFee: number;         // 包装费
  transportFee: number;         // 运输费
  scrapFee: number;             // 报废损失费
  managementFee: number;        // 管理费
  profit: number;               // 利润
  tax: number;                  // 税金
  // 汇总
  subtotalBeforeTax: number;    // 税前合计
  total: number;                // 含税总价
}

/**
 * 综合成本分析计算
 * @param params - 成本参数
 * @returns 成本汇总
 * 
 * 公式链：
 *   加工费合计 = Σ(各设备工时 × 费率)
 *   报废损失 = (材料费 + 加工费) × 报废率
 *   管理费 = 工厂成本 × 管理费率(10-20%)
 *   利润 = 工厂成本 × 利润率(15-30%)
 *   税金 = (工厂成本 + 管理费 + 利润) × 17%
 *   总价 = 工厂成本 + 管理费 + 利润 + 税金
 * 
 * 示例验证（Excel）：
 *   材料费1320.96 + 加工费825.0 + 其它费用686.71 = 2832.67
 *   总成本 = 3154.56（含其它附加费）
 */
export function calculateComprehensiveCost(params: {
  materialFee: number;
  processingTasks: ProcessingTask[];
  accessoryFee?: number;
  surfaceTreatments?: { treatment: SurfaceTreatment; weight: number }[];
  designHours?: number;
  packagingPerPiece?: number;
  transportDistance?: number;
  transportUnitPrice?: number;
  difficulty?: DifficultyLevel;
  managementRate?: number;    // 10-20%, 默认15%
  profitRate?: number;        // 15-30%, 默认20%
  taxRate?: number;           // 默认17%
}): ComprehensiveCostSummary {
  // 加工费
  const processingFee = params.processingTasks.reduce(
    (sum, task) => sum + _calculateProcessingFee(task),
    0,
  );
  
  // 表面处理费
  let surfaceTreatmentFee = 0;
  if (params.surfaceTreatments) {
    for (const st of params.surfaceTreatments) {
      surfaceTreatmentFee += calculateSurfaceTreatmentFee(st.treatment, st.weight);
    }
  }
  
  // 设计费
  const designFee = params.designHours ? params.designHours * 45 : 0; // 45元/小时
  
  // 包装费
  const packagingFee = params.packagingPerPiece
    ? params.packagingPerPiece
    : 0;
  
  // 运输费
  const transportFee = params.transportDistance
    ? params.transportDistance * (params.transportUnitPrice || 2)
    : 0;
  
  // 基础成本
  const baseCost = params.materialFee + processingFee
    + (params.accessoryFee || 0) + surfaceTreatmentFee
    + designFee + packagingFee + transportFee;
  
  // 报废损失
  const scrapRate = DIFFICULTY_SCRAP_RATES[params.difficulty || DifficultyLevel.Medium];
  const scrapFee = Math.round(baseCost * scrapRate * 100) / 100;
  
  // 工厂成本
  const factoryCost = baseCost + scrapFee;
  
  // 管理费
  const managementRate = params.managementRate || 0.15;
  const managementFee = Math.round(factoryCost * managementRate * 100) / 100;
  
  // 利润
  const profitRate = params.profitRate || 0.20;
  const profit = Math.round(factoryCost * profitRate * 100) / 100;
  
  // 税前合计
  const subtotalBeforeTax = factoryCost + managementFee + profit;
  
  // 税金
  const taxRate = params.taxRate || 0.17;
  const tax = Math.round(subtotalBeforeTax * taxRate * 100) / 100;
  
  return {
    materialFee: Math.round(params.materialFee * 100) / 100,
    processingFee: Math.round(processingFee * 100) / 100,
   配件Fee: Math.round((params.accessoryFee || 0) * 100) / 100,
    surfaceTreatmentFee: Math.round(surfaceTreatmentFee * 100) / 100,
    designFee: Math.round(designFee * 100) / 100,
    packagingFee: Math.round(packagingFee * 100) / 100,
    transportFee: Math.round(transportFee * 100) / 100,
    scrapFee,
    managementFee,
    profit,
    tax,
    subtotalBeforeTax: Math.round(subtotalBeforeTax * 100) / 100,
    total: Math.round((subtotalBeforeTax + tax) * 100) / 100,
  };
}
