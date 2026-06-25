/**
 * 文件6《各种机械加工工时计算软件》— 切削参数推荐数据库
 * 来源：/Users/dingyuwang/Downloads/9-教育/数控报价表/各种机械加工工时计算软件.xls
 * Sheet数量：22个
 *
 * 此模块是**整个Excel文件夹中最核心的数据资产**，
 * 所有切削参数均与国家标准《金属切削手册》《机械制造工艺手册》一致。
 *
 * 包含：
 * - 车削切削参数（硬质合金车刀、高速钢车刀）
 * - 铣削切削参数（高速钢粗铣/半精铣、硬质合金端周粗铣/精铣、立铣刀）
 * - 铣削速度表
 * - 钻削切削参数（硬质合金钻头）
 * - 镗削用量表
 * - 铰削用量表（高速钢铰刀、硬质合金铰刀）
 * - 磨削参数（外圆磨/内圆磨/平面磨，粗磨/精磨）
 * - 理论工时计算公式
 */
/**
 * 常用工件材料
 * 来源：文件6 多个Sheet
 */
export declare enum WorkpieceMaterial {
    LowCarbonSteel = "low_carbon_steel",// 低碳钢
    MediumCarbonSteel = "medium_carbon_steel",// 中碳钢
    Steel45 = "steel_45",// 45#钢
    AlloySteel = "alloy_steel",// 合金钢
    HighCarbonSteel = "high_carbon_steel",// 高碳钢
    ToolSteel = "tool_steel",// 工具钢
    StainlessSteel = "stainless_steel",// 不锈钢
    GrayCastIron = "gray_cast_iron",// 灰铸铁
    MalleableCastIron = "malleable_cast_iron",// 可锻铸铁
    HighManganeseSteel = "high_manganese_steel",// 高锰钢Mn13%
    CopperAlloy = "copper_alloy",// 铜合金
    AluminumAlloy = "aluminum_alloy",// 铝镁合金
    CastAluminum = "cast_aluminum",// 铸铝合金
    Brass = "brass",// 黄铜
    Bronze = "bronze",// 青铜
    SteelCastIron = "steel_casting"
}
/**
 * 刀具材料枚举
 * 来源：文件6 多个Sheet
 */
export declare enum ToolMaterial {
    HighSpeedSteel = "hss",// 高速钢
    Carbide = "carbide",// 硬质合金
    CarbideYT15 = "carbide_yt15",// YT15刀片
    CarbideYT5 = "carbide_yt5",// YT5刀片
    CarbideYG6 = "carbide_yg6",// YG6刀片
    CarbideYG8 = "carbide_yg8"
}
/**
 * 加工阶段枚举
 * 来源：文件6 多个Sheet
 */
export declare enum MachiningStage {
    Rough = "rough",// 粗加工
    SemiFinish = "semi_finish",// 半精加工
    Finish = "finish",// 精加工
    SuperFinish = "super_finish"
}
/**
 * 硬质合金车刀切削参数表
 * 来源：文件6 Sheet[2]（20行×8列）
 * 数据与ISO标准硬质合金刀具切削参数一致
 *
 * 每个材料有多个ap（切削深度）档位，对应不同的f（进给量）和Vc（切削速度）
 */
export interface CuttingParam {
    ap: number;
    f: number;
    vc: number;
}
export interface MaterialCuttingParams {
    material: WorkpieceMaterial;
    params: CuttingParam[];
}
export declare const HARD_METAL_TURNING_PARAMS: MaterialCuttingParams[];
/**
 * 根据材料+切削深度查车削参数
 * @param material - 工件材料
 * @param ap - 切削深度（mm）
 * @returns 最接近的切削参数 {f, vc}
 */
export declare function getTurningParams(material: WorkpieceMaterial, ap: number): CuttingParam | null;
/**
 * 工艺系统刚性
 * 来源：文件6 Sheet[3]（高速钢粗铣）
 */
export declare enum SystemRigidity {
    High = "high",// 大（刚性大）
    Medium = "medium",// 中等
    Low = "low"
}
/**
 * 机床功率
 * 来源：文件6 Sheet[3], Sheet[5]
 */
export declare enum MachinePower {
    Under5kW = "under_5kW",// ≤5kW
    _5to10kW = "5to_10kW",// 5-10kW
    Over10kW = "over_10kW"
}
/**
 * 表面粗糙度要求 Ra (μm)
 * 来源：文件6 Sheet[4]（高速钢半精铣）, Sheet[6]（硬质合金精铣）
 */
export declare enum SurfaceRoughness {
    Ra6_3 = 6.3,
    Ra3_2 = 3.2,
    Ra1_6 = 1.6,
    Ra0_8 = 0.8,
    Ra0_4 = 0.4
}
/**
 * 铣刀类型
 */
export declare enum MillingCutterType {
    RoughTooth = "rough_tooth",// 粗齿
    FineTooth = "fine_tooth",// 细齿
    EndMill = "end_mill",// 端铣刀
    FaceMill = "face_mill",// 面铣刀
    CylindricalMill = "cylindrical_mill",// 圆柱铣刀
    SideMill = "side_mill",// 圆盘铣刀
    ShellMill = "shell_mill"
}
/**
 * 立铣刀类型
 * 来源：文件6 Sheet[7]
 */
export declare enum EndMillType {
    Solid = "solid",// 整体
    IndexedInsert = "indexed_insert"
}
/**
 * 每齿进给量推荐表 — 高速钢粗铣
 * 来源：文件6 Sheet[3]（23行×31列）
 *
 * 维度：铣床功率 × 工艺系统刚性 × 铣刀类型 × 加工材料
 * fz范围：0.06~0.5 mm/z
 */
export interface HSS_RoughMillingParams {
    fz_min: number;
    fz_max: number;
}
/**
 * 高速钢粗铣每齿进给量推荐
 */
export declare function getHSS_RoughMillingFz(power: MachinePower, rigidity: SystemRigidity, cutterType: MillingCutterType, material: WorkpieceMaterial): {
    fz_min: number;
    fz_max: number;
} | null;
/**
 * 默认铣削每齿进给量（简化版）
 * 来源：文件6 Sheet[3] 典型值提取
 */
export declare function getDefaultMillingFz(material: WorkpieceMaterial, cutterType: MillingCutterType, rigidity: SystemRigidity): {
    fz_min: number;
    fz_max: number;
};
/**
 * 铣削速度推荐表
 * 来源：文件6 Sheet[8]（28行×20列）
 *
 * 按工件材料+硬度，查硬质合金铣刀和高速钢铣刀的切削速度(m/min)
 */
export interface MillingSpeedEntry {
    material: WorkpieceMaterial;
    hardness?: string;
    carbideVC: number;
    hssVC: number;
}
export declare const MILLING_SPEED_TABLE: MillingSpeedEntry[];
/**
 * 根据材料查铣削速度
 * @param material - 工件材料
 * @param hardness - 硬度范围（可选）
 * @returns {carbideVC, hssVC} m/min
 */
export declare function getMillingSpeed(material: WorkpieceMaterial, hardness?: string): {
    carbideVC: number;
    hssVC: number;
} | null;
/**
 * 硬质合金钻头切削参数
 * 来源：文件6 Sheet[18]（24行×16列）
 *
 * 按加工材料+抗拉强度+硬度，查不同刀具直径对应的每转进给量和切削速度
 */
export interface DrillParam {
    diameterRange: string;
    fz: number;
    vc: number;
}
/**
 * 钻头每转进给量和切削速度（典型值）
 * 来源：文件6 Sheet[18]
 */
export declare function getDrillingParams(material: WorkpieceMaterial, diameter: number): {
    fz: number;
    vc: number;
} | null;
/**
 * 高速钢铰刀参数
 * 来源：文件6 Sheet[16]（25行×25列）
 *
 * 按铰刀直径(6-50mm)和加工材料查每转进给量f和切削速度V
 */
export declare function getHSSReamerParams(diameter: number, // mm (6-50)
material: WorkpieceMaterial): {
    fz: number;
    vc: number;
} | null;
/**
 * 硬质合金铰刀参数（更详细）
 * 来源：文件6 Sheet[17]（75行×14列）
 * 分多种钢材(σb≤1000MPa/>1000MPa)、铸钢、铸铁、有色金属、非金属等
 */
export declare function getCarbideReamerParams(diameter: number, material: WorkpieceMaterial, tensileStrength?: number): {
    fz: number;
    vc: number;
} | null;
/**
 * 镗削用量表
 * 来源：文件6 Sheet[15]（22行×22列）
 *
 * 按加工方式(粗/半精/精镗)、刀具材料、加工材料查切削速度和进给量
 */
export declare function getBoringParams(stage: MachiningStage, toolMat: ToolMaterial, material: WorkpieceMaterial): {
    fz: number;
    vc: number;
} | null;
/**
 * 外圆磨削余量
 * 来源：文件6 Sheet[9]（25行×12列）
 *
 * 按工件直径和轴长，确定磨削余量
 * 分经热处理/未经热处理，以及粗磨后精磨前、精磨后研磨前
 */
export declare function getGrindingAllowance(workpieceDiameter: number, // mm
workpieceLength: number, // mm
heatTreated: boolean, // 是否经热处理
stage: 'rough' | 'finish' | 'polish'): number;
/**
 * 纵进给外圆粗磨参数
 * 来源：文件6 Sheet[10]（30行×15列）
 *
 * 工件磨削直径(20-300mm)、工件速度(10-34m/min)、磨削深度ap
 */
export declare function getExternalCylindricalGrindingParams(workpieceDiameter: number): {
    ap: number;
    vf: number;
    vw: number;
} | null;
/**
 * 平面磨削余量和速度
 * 来源：文件6 Sheet[12]（21行×9列）
 */
export declare function getSurfaceGrindingParams(surfaceLength: number, // mm
surfaceWidth: number, // mm
heatTreated: boolean): {
    allowance: number;
    vc: number;
} | null;
/**
 * 理论工时计算接口
 */
export interface TheoreticalTimeInput {
    material: WorkpieceMaterial;
    machiningType: MachiningType;
    stage: MachiningStage;
    cuttingDepth?: number;
    feedPerRev?: number;
    feedPerTooth?: number;
    cuttingSpeed?: number;
    cutterDiameter?: number;
    cutterTeeth?: number;
    spindleSpeed?: number;
    workpieceLength?: number;
    workpieceDiameter?: number;
    machiningAllowance?: number;
    passes?: number;
    gearTeeth?: number;
    gearWidth?: number;
}
/**
 * 计算结果
 */
export interface TheoreticalTimeResult {
    feedRate: number;
    spindleSpeed: number;
    cuttingTime: number;
    totalTime: number;
    difficultyFactor: number;
}
/**
 * 加工类型
 */
export type MachiningType = 'turning' | 'milling' | 'drilling' | 'boring' | 'reaming' | 'grinding';
/**
 * 计算理论工时
 * @param input - 加工参数
 * @param difficultyFactor - 难度系数，推荐 1.0~3.0
 * @returns 理论工时计算结果
 *
 * 公式：
 *   主轴转速 N = 1000 × Vc / (π × D)
 *   进给速度 Vf = fz × Z × N（铣削）或 Vf = f × N（车/钻/镗）
 *   切削时间 T = L / Vf（直线加工）
 *   总时间 = T × 难度系数
 *
 * 来源：文件6 Sheet[1] 工时计算
 */
export declare function calculateTheoreticalTime(input: TheoreticalTimeInput, difficultyFactor?: number): TheoreticalTimeResult;
//# sourceMappingURL=cutting-params.d.ts.map