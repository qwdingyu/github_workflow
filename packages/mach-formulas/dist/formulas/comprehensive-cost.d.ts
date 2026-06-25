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
/**
 * 材料类型
 * 来源：文件2 成本分析表 板块1
 */
export declare enum MaterialType {
    Steel = "steel",
    Copper = "copper",
    Aluminum = "aluminum",
    Bakelite = "bakelite",// 电木
    Titanium = "titanium"
}
/**
 * 材料密度（kg/mm³）
 * 来源：文件2 板块1
 * 验证：钢0.008 = 8g/cm³（正确）
 *       铜0.0089 = 8.9g/cm³（正确）
 *       铝0.0027 = 2.7g/cm³（正确）
 */
export declare const MATERIAL_DENSITIES: Record<MaterialType, number>;
/**
 * 材料单价（元/kg）
 * 来源：文件2 板块1，示例数据
 */
export declare const MATERIAL_UNIT_PRICES: Record<MaterialType, number>;
/**
 * 计算圆棒理论重量
 * @param diameter - 直径（mm）
 * @param length - 长度（mm）
 * @param materialType - 材料类型
 * @returns 理论重量（kg）
 */
export declare function calculateCylinderWeight(diameter: number, length: number, materialType: MaterialType): number;
/**
 * 计算圆管理论重量
 * @param outerDiameter - 外径（mm）
 * @param wallThickness - 壁厚（mm）
 * @param length - 长度（mm）
 * @param materialType - 材料类型
 * @returns 理论重量（kg）
 */
export declare function calculateTubeWeight(outerDiameter: number, wallThickness: number, length: number, materialType: MaterialType): number;
/**
 * 设备类型
 * 来源：文件2 板块2
 * 17种设备
 */
export declare enum ProcessingEquipment {
    Lathe = "lathe",// 普车
    Milling = "milling",// 普铣
    CNC_Lathe = "cnc_lathe",// 数控车
    WireCut = "wire_cut",// 线切割
    SurfaceGrinder = "surface_grinder",// 平面磨
    CylindricalGrinder = "cylindrical_grinder",// 外圆磨
    EDM = "edm",// 放电
    CNC1 = "cnc1",// CNC1
    CNC2 = "cnc2",// CNC2
    Tapping = "tapping",// 攻牙机
    Sandblasting = "sandblasting",// 喷砂
    Polishing = "polishing",// 抛光
    Sawing = "sawing",// 锯床
    LargeSurfaceGrinder = "large_surface_grinder",// 大水磨
    Other = "other"
}
/**
 * 加工工时参数
 */
export interface ProcessingTask {
    equipment: ProcessingEquipment;
    hours: number;
}
/**
 * 表面处理类型
 * 来源：文件2 板块4
 * 10种表面处理
 */
export declare enum SurfaceTreatment {
    Quenching = "quenching",// 调质
    Hardening = "hardening",// 淬火
    Annealing = "annealing",// 退火
    Blacking = "blaying",// 发黑（兼容历史拼写）
    Nitriding = "nitriding",// 渗氮
    Anodizing = "anodizing",// 阳极氧化
    ZincPlating = "zinc_plating",// 镀环保锌
    NickelPlating = "nickel_plating",// 镀化学镍
    BrightNickelPlating = "bright_nickel_plating",// 镀亮镍
    Sandblasting = "sandblasting"
}
/**
 * 表面处理单价（元/kg）
 * 来源：文件2 板块4
 */
export declare const SURFACE_TREATMENT_PRICES: Record<SurfaceTreatment, number>;
/**
 * 计算表面处理费
 * @param treatment - 处理类型
 * @param weight - 重量（kg）
 * @returns 处理费（元）
 */
export declare function calculateSurfaceTreatmentFee(treatment: SurfaceTreatment, weight: number): number;
/**
 * 难度级别（影响报废率）
 * 来源：文件2 板块5
 */
export declare enum DifficultyLevel {
    Easy = "easy",// 5% 报废率
    Medium = "medium",// 10% 报废率
    Hard = "hard",// 15% 报废率
    VeryHard = "very_hard"
}
export declare const DIFFICULTY_SCRAP_RATES: Record<DifficultyLevel, number>;
/**
 * 综合报价汇总
 */
export interface ComprehensiveCostSummary {
    materialFee: number;
    processingFee: number;
    配件Fee: number;
    surfaceTreatmentFee: number;
    designFee: number;
    packagingFee: number;
    transportFee: number;
    scrapFee: number;
    managementFee: number;
    profit: number;
    tax: number;
    subtotalBeforeTax: number;
    total: number;
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
export declare function calculateComprehensiveCost(params: {
    materialFee: number;
    processingTasks: ProcessingTask[];
    accessoryFee?: number;
    surfaceTreatments?: {
        treatment: SurfaceTreatment;
        weight: number;
    }[];
    designHours?: number;
    packagingPerPiece?: number;
    transportDistance?: number;
    transportUnitPrice?: number;
    difficulty?: DifficultyLevel;
    managementRate?: number;
    profitRate?: number;
    taxRate?: number;
}): ComprehensiveCostSummary;
//# sourceMappingURL=comprehensive-cost.d.ts.map