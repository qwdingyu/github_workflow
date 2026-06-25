/**
 * 文件5《加工工时工价估算》— 加工流程工时费用估算
 * 来源：/Users/dingyuwang/Downloads/9-教育/数控报价表/加工工时工价估算.xls
 *
 * 此模块包含：
 * - 100+道工序的工时计算（铣削/钻削/攻牙/铰孔/镗孔/车床/磨削/拉床/插齿）
 * - 设备费率体系
 * - 换刀时间计算
 * - 上下料时间
 * - 单工序费用 = 时间(秒) × 每秒费用
 * - 材料费 = 材料成本 + 加工时间成本 × 5%
 */
/**
 * 设备类型枚举
 * 来源：文件5 Sheet1
 */
export declare enum EquipmentType {
    VerticalMilling = "vertical_milling",// 立式加工中心
    HorizontalMilling = "horizontal_milling",// 卧式加工中心
    CNC_Lathe = "cnc_lathe",// CNC车床
    SpecialDrill = "special_drill",// 专用钻床
    PullingMachine = "pulling_machine",// 拉床
    GearShaper = "gear_shaper"
}
/**
 * 刀具类型枚举
 * 来源：文件5 Sheet1
 */
export declare enum ToolType {
    FaceMill = "face_mill",// 平面铣刀
    EndMill = "end_mill",// 立铣刀
    SideMill = "side_mill",// 立铣刀侧铣
    SideFaceMill = "side_face_mill",// 侧铣刀
    CenterDrill = "center_drill",// 定心钻
    Drill = "drill",// 钻头
    GunDrill = "gun_drill",// 枪钻
    TapM4 = "tap_m4",// M4攻牙
    TapM5 = "tap_m5",// M5攻牙
    TapM6 = "tap_m6",// M6攻牙
    TapM8 = "tap_m8",// M8攻牙
    TapM10 = "tap_m10",// M10攻牙
    TapM12 = "tap_m12",// M12攻牙
    TapM15 = "tap_m15",// M15攻牙
    FineReamer = "fine_reamer",// 精铰刀
    RoughReamer = "rough_reamer",// 粗铰刀
    FineBore = "fine_bore",// 精镗刀
    OD_Turn = "od_turn",// 外径车刀
    ID_Turn = "id_turn",// 内径车刀
    FaceTurn = "face_turn",// 端面车刀
    GrooveTurn = "groove_turn",// 切槽刀
    ThreadTurn = "thread_turn",// 牙刀
    ODGrind = "od_grind",// 外圆研磨
    IDGrind = "id_grind",// 内径砂轮
    ODWheelGrind = "od_wheel_grind",// 外径砂轮
    KeywayPuller = "keyway_puller",// 单键拉刀
    SplinedKeywayPuller = "splined_keyway_puller",// 花键拉刀
    SprocketPuller = "sprocket_puller",// 链轮拉刀
    Engrave = "engrave"
}
/**
 * 设备费率（元/秒）
 * 来源：文件5 Sheet1
 * 换算：每秒费用 × 3600 = 每小时费用
 * 例如：0.02元/秒 = 72元/小时, 0.1元/秒 = 360元/小时
 */
export declare const EQUIPMENT_RATES: Record<string, number>;
/**
 * 换刀时间（秒）
 * 来源：文件5 Sheet1
 * 换刀时间 = 2(刀具数量) × 8(换刀时间/秒) / 1(工件数量)
 */
export declare const TOOL_CHANGE_TIME_PER_TOOL = 8;
/**
 * 计算换刀时间
 * @param toolCount - 需要换刀的刀具数量
 * @param workpieceCount - 工件数量（批量）
 * @returns 换刀时间（秒）
 *
 * 公式：换刀时间 = 换刀时间/次 × 刀具数 ÷ 工件数
 *
 * 示例验证（Excel行121）：
 *   刀具数=2, 工件数=1 → 8×2/1 = 16秒
 */
export declare function calculateToolChangeTime(toolCount: number, workpieceCount?: number): number;
/**
 * 上下料时间（秒）
 * 来源：文件5 Sheet1
 * 固定值，根据零件复杂度不同
 */
export declare const LOADING_UNLOADING_TIMES: Record<string, number>;
/**
 * 工序类型枚举
 * 来源：文件5 Sheet1
 */
export declare enum ProcessType {
    Milling = "milling",
    SideMilling = "side_milling",
    FaceMilling = "face_milling",
    SlotMilling = "slot_milling",
    Drilling = "drilling",
    DeepHoleDrilling = "deep_hole_drilling",
    Tapping = "tapping",
    Reaming = "reaming",
    Boring = "boring",
    Turning = "turning",
    OD_Turning = "od_turning",
    ID_Turning = "id_turning",
    Grinding = "grinding",
    Pulling = "pulling",
    GearCutting = "gear_cutting",
    Degreasing = "degreasing",
    Deburring = "deburring",
    BalanceCheck = "balance_check",
    Engraving = "engraving"
}
/**
 * 工序信息接口
 */
export interface ProcessInfo {
    sequence: number;
    processType: ProcessType;
    toolType: ToolType;
    speed: number;
    feedPerRev: number;
    feedRate: number;
    cuttingLength: number;
    cuttingDepth: number;
    passes: number;
    toolCount: number;
    workpieceCount: number;
    loadingUnloading: string;
}
/**
 * 计算工序时间（秒）
 * @param info - 工序信息
 * @returns 工序总时间（秒），含切削时间+换刀时间+上下料时间
 *
 * 公式：
 *   切削时间 = 切削长度 / 进给速度 × 走刀次数 × 60（转为秒）
 *   其中：进给速度 = 每转进给 × 转速
 *   总时间 = 切削时间 + 换刀时间 + 上下料时间
 *
 * 示例验证（Excel行6，立铣刀）：
 *   转速=2000, 每转进给=0.15, 切削长度=100, 走刀=5
 *   进给速度 = 2000 × 0.15 = 300 mm/min
 *   切削时间 = 100 / 300 × 5 × 60 = 100秒
 */
export declare function calculateProcessTime(info: ProcessInfo): number;
/**
 * 计算工序费用（元）
 * @param info - 工序信息
 * @returns 工序费用（元）
 *
 * 公式：费用 = 时间(秒) × 每秒费用
 *
 * 示例验证（Excel行6-120）：
 *   每行均通过验证：费用 = 时间 × 每秒费用
 */
export declare function calculateProcessFee(info: ProcessInfo, toolTypeOverride?: ToolType): number;
/**
 * 材料成本占加工费的比例
 * 来源：文件5 Sheet1 行121-125
 * 材料费 = 材料成本 + 加工时间成本 × 5%（加工2% + 铸造3%）
 */
export declare const MATERIAL_OVERHEAD_RATE = 0.05;
/**
 * 计算材料费
 * @param materialCost - 纯材料成本（元）
 * @param processingTimeCost - 加工时间成本（元）
 * @returns 材料费（元）
 *
 * 公式：材料费 = 材料成本 + 加工时间成本 × 5%
 */
export declare function calculateMaterialCost(materialCost: number, processingTimeCost: number): number;
/**
 * 加工单报价汇总
 */
export interface QuoteTotal {
    processes: ProcessResult[];
    materialCost: number;
    totalProcessingFee: number;
    grandTotal: number;
}
/**
 * 工序结果
 */
export interface ProcessResult {
    sequence: number;
    processType: ProcessType;
    toolType: ToolType;
    timeSeconds: number;
    timeMinutes: number;
    fee: number;
}
/**
 * 计算完整报价
 * @param processes - 工序列表
 * @param materialCost - 纯材料成本（元）
 * @returns 报价汇总
 */
export declare function calculateQuoteTotal(processes: ProcessInfo[], materialCost: number): QuoteTotal;
/**
 * 设备年度产能计算
 * 来源：文件5 Sheet1 行125
 * 设备计算依据：300天/年, 20.5小时/天, 稼动率85%
 */
export declare const WORK_DAYS_PER_YEAR = 300;
export declare const HOURS_PER_DAY = 20.5;
export declare const OEE_RATE = 0.85;
/**
 * 计算设备年度有效工时（小时）
 * @returns 年度有效工时
 *
 * 公式：年度工时 = 300天 × 20.5小时 × 85% = 5242.5小时
 */
export declare function calculateAnnualAvailableHours(): number;
//# sourceMappingURL=process-time.d.ts.map