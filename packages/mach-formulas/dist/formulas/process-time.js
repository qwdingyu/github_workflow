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
// ═══════════════════════════════════════════════════
// 一、设备费率
// ═══════════════════════════════════════════════════
/**
 * 设备类型枚举
 * 来源：文件5 Sheet1
 */
export var EquipmentType;
(function (EquipmentType) {
    EquipmentType["VerticalMilling"] = "vertical_milling";
    EquipmentType["HorizontalMilling"] = "horizontal_milling";
    EquipmentType["CNC_Lathe"] = "cnc_lathe";
    EquipmentType["SpecialDrill"] = "special_drill";
    EquipmentType["PullingMachine"] = "pulling_machine";
    EquipmentType["GearShaper"] = "gear_shaper";
})(EquipmentType || (EquipmentType = {}));
/**
 * 刀具类型枚举
 * 来源：文件5 Sheet1
 */
export var ToolType;
(function (ToolType) {
    // 铣削刀具
    ToolType["FaceMill"] = "face_mill";
    ToolType["EndMill"] = "end_mill";
    ToolType["SideMill"] = "side_mill";
    ToolType["SideFaceMill"] = "side_face_mill";
    // 钻削刀具
    ToolType["CenterDrill"] = "center_drill";
    ToolType["Drill"] = "drill";
    ToolType["GunDrill"] = "gun_drill";
    // 攻牙刀具
    ToolType["TapM4"] = "tap_m4";
    ToolType["TapM5"] = "tap_m5";
    ToolType["TapM6"] = "tap_m6";
    ToolType["TapM8"] = "tap_m8";
    ToolType["TapM10"] = "tap_m10";
    ToolType["TapM12"] = "tap_m12";
    ToolType["TapM15"] = "tap_m15";
    // 铰孔刀具
    ToolType["FineReamer"] = "fine_reamer";
    ToolType["RoughReamer"] = "rough_reamer";
    // 镗孔刀具
    ToolType["FineBore"] = "fine_bore";
    // 车床刀具
    ToolType["OD_Turn"] = "od_turn";
    ToolType["ID_Turn"] = "id_turn";
    ToolType["FaceTurn"] = "face_turn";
    ToolType["GrooveTurn"] = "groove_turn";
    ToolType["ThreadTurn"] = "thread_turn";
    // 磨削刀具
    ToolType["ODGrind"] = "od_grind";
    ToolType["IDGrind"] = "id_grind";
    ToolType["ODWheelGrind"] = "od_wheel_grind";
    // 其他
    ToolType["KeywayPuller"] = "keyway_puller";
    ToolType["SplinedKeywayPuller"] = "splined_keyway_puller";
    ToolType["SprocketPuller"] = "sprocket_puller";
    // 刻字
    ToolType["Engrave"] = "engrave";
})(ToolType || (ToolType = {}));
/**
 * 设备费率（元/秒）
 * 来源：文件5 Sheet1
 * 换算：每秒费用 × 3600 = 每小时费用
 * 例如：0.02元/秒 = 72元/小时, 0.1元/秒 = 360元/小时
 */
export const EQUIPMENT_RATES = {
    // 铣削类
    [ToolType.FaceMill]: 0.03, // 平面铣刀 108元/h
    [ToolType.EndMill]: 0.025, // 立铣刀 90元/h
    [ToolType.SideMill]: 0.025, // 立铣刀侧铣 90元/h
    [ToolType.SideFaceMill]: 0.03, // 侧铣刀 108元/h
    // 钻削类
    [ToolType.CenterDrill]: 0.02, // 定心钻 72元/h
    [ToolType.Drill]: 0.02, // 钻头 72元/h
    [ToolType.GunDrill]: 0.04, // 枪钻 144元/h
    // 攻牙类
    [ToolType.TapM4]: 0.02, // M4攻牙 72元/h
    [ToolType.TapM5]: 0.02, // M5攻牙 72元/h
    [ToolType.TapM6]: 0.022, // M6攻牙 79.2元/h
    [ToolType.TapM8]: 0.025, // M8攻牙 90元/h
    [ToolType.TapM10]: 0.028, // M10攻牙 100.8元/h
    [ToolType.TapM12]: 0.03, // M12攻牙 108元/h
    [ToolType.TapM15]: 0.035, // M15攻牙 126元/h
    // 铰孔类
    [ToolType.FineReamer]: 0.025, // 精铰刀 90元/h
    [ToolType.RoughReamer]: 0.02, // 粗铰刀 72元/h
    // 镗孔类
    [ToolType.FineBore]: 0.03, // 精镗刀 108元/h
    // 车床类
    [ToolType.OD_Turn]: 0.025, // 外径车刀 90元/h
    [ToolType.ID_Turn]: 0.028, // 内径车刀 100.8元/h
    [ToolType.FaceTurn]: 0.025, // 端面车刀 90元/h
    [ToolType.GrooveTurn]: 0.03, // 切槽刀 108元/h
    [ToolType.ThreadTurn]: 0.028, // 牙刀 100.8元/h
    // 磨削类
    [ToolType.ODGrind]: 0.035, // 外圆研磨 126元/h
    [ToolType.IDGrind]: 0.035, // 内径砂轮 126元/h
    [ToolType.ODWheelGrind]: 0.035, // 外径砂轮 126元/h
    // 拉床类
    [ToolType.KeywayPuller]: 0.04, // 单键拉刀 144元/h
    [ToolType.SplinedKeywayPuller]: 0.045, // 花键拉刀 162元/h
    [ToolType.SprocketPuller]: 0.04, // 链轮拉刀 144元/h
    // 插齿类
    [ToolType.Engrave]: 0.02, // 刻字 72元/h
};
// ═══════════════════════════════════════════════════
// 二、换刀时间
// ═══════════════════════════════════════════════════
/**
 * 换刀时间（秒）
 * 来源：文件5 Sheet1
 * 换刀时间 = 2(刀具数量) × 8(换刀时间/秒) / 1(工件数量)
 */
export const TOOL_CHANGE_TIME_PER_TOOL = 8; // 秒/次
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
export function calculateToolChangeTime(toolCount, workpieceCount = 1) {
    return (TOOL_CHANGE_TIME_PER_TOOL * toolCount) / workpieceCount;
}
// ═══════════════════════════════════════════════════
// 三、上下料时间
// ═══════════════════════════════════════════════════
/**
 * 上下料时间（秒）
 * 来源：文件5 Sheet1
 * 固定值，根据零件复杂度不同
 */
export const LOADING_UNLOADING_TIMES = {
    simple: 80, // 简单零件
    medium: 120, // 中等复杂度
    complex: 180, // 复杂零件
};
// ═══════════════════════════════════════════════════
// 四、工序工时计算
// ═══════════════════════════════════════════════════
/**
 * 工序类型枚举
 * 来源：文件5 Sheet1
 */
export var ProcessType;
(function (ProcessType) {
    // 铣削
    ProcessType["Milling"] = "milling";
    ProcessType["SideMilling"] = "side_milling";
    ProcessType["FaceMilling"] = "face_milling";
    ProcessType["SlotMilling"] = "slot_milling";
    // 钻削
    ProcessType["Drilling"] = "drilling";
    ProcessType["DeepHoleDrilling"] = "deep_hole_drilling";
    // 攻牙
    ProcessType["Tapping"] = "tapping";
    // 铰孔
    ProcessType["Reaming"] = "reaming";
    // 镗孔
    ProcessType["Boring"] = "boring";
    // 车床
    ProcessType["Turning"] = "turning";
    ProcessType["OD_Turning"] = "od_turning";
    ProcessType["ID_Turning"] = "id_turning";
    // 磨削
    ProcessType["Grinding"] = "grinding";
    // 其他
    ProcessType["Pulling"] = "pulling";
    ProcessType["GearCutting"] = "gear_cutting";
    ProcessType["Degreasing"] = "degreasing";
    ProcessType["Deburring"] = "deburring";
    ProcessType["BalanceCheck"] = "balance_check";
    ProcessType["Engraving"] = "engraving";
})(ProcessType || (ProcessType = {}));
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
export function calculateProcessTime(info) {
    // 进给速度（mm/min）
    const feedRate = info.feedPerRev * info.speed;
    if (feedRate <= 0)
        return 0; // 防止除零
    // 切削时间（秒）= (切削长度 / 进给速度) × 走刀次数 × 60
    const cuttingTime = (info.cuttingLength / feedRate) * info.passes * 60;
    // 换刀时间（秒）
    const toolChangeTime = calculateToolChangeTime(info.toolCount, info.workpieceCount);
    // 上下料时间（秒）
    const loadingTime = LOADING_UNLOADING_TIMES[info.loadingUnloading] || LOADING_UNLOADING_TIMES.medium;
    return cuttingTime + toolChangeTime + loadingTime;
}
// ═══════════════════════════════════════════════════
// 五、工序费用计算
// ═══════════════════════════════════════════════════
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
export function calculateProcessFee(info, toolTypeOverride) {
    const time = calculateProcessTime(info);
    const rate = toolTypeOverride
        ? (EQUIPMENT_RATES[toolTypeOverride] || 0.025)
        : (EQUIPMENT_RATES[info.toolType] || 0.025);
    return Math.round(time * rate * 100) / 100;
}
// ═══════════════════════════════════════════════════
// 六、材料费计算
// ═══════════════════════════════════════════════════
/**
 * 材料成本占加工费的比例
 * 来源：文件5 Sheet1 行121-125
 * 材料费 = 材料成本 + 加工时间成本 × 5%（加工2% + 铸造3%）
 */
export const MATERIAL_OVERHEAD_RATE = 0.05; // 5%
/**
 * 计算材料费
 * @param materialCost - 纯材料成本（元）
 * @param processingTimeCost - 加工时间成本（元）
 * @returns 材料费（元）
 *
 * 公式：材料费 = 材料成本 + 加工时间成本 × 5%
 */
export function calculateMaterialCost(materialCost, processingTimeCost) {
    return materialCost + processingTimeCost * MATERIAL_OVERHEAD_RATE;
}
/**
 * 计算完整报价
 * @param processes - 工序列表
 * @param materialCost - 纯材料成本（元）
 * @returns 报价汇总
 */
export function calculateQuoteTotal(processes, materialCost) {
    const processResults = [];
    let totalProcessingFee = 0;
    for (const info of processes) {
        const timeSeconds = calculateProcessTime(info);
        const fee = calculateProcessFee(info);
        processResults.push({
            sequence: info.sequence,
            processType: info.processType,
            toolType: info.toolType,
            timeSeconds: Math.round(timeSeconds * 100) / 100,
            timeMinutes: Math.round((timeSeconds / 60) * 100) / 100,
            fee: Math.round(fee * 100) / 100,
        });
        totalProcessingFee += fee;
    }
    // 材料费 = 材料成本 + 加工时间成本 × 5%
    const adjustedMaterialCost = calculateMaterialCost(materialCost, totalProcessingFee);
    const grandTotal = adjustedMaterialCost + totalProcessingFee;
    return {
        processes: processResults,
        materialCost: Math.round(adjustedMaterialCost * 100) / 100,
        totalProcessingFee: Math.round(totalProcessingFee * 100) / 100,
        grandTotal: Math.round(grandTotal * 100) / 100,
    };
}
// ═══════════════════════════════════════════════════
// 八、设备稼动率计算（年度产能参考）
// ═══════════════════════════════════════════════════
/**
 * 设备年度产能计算
 * 来源：文件5 Sheet1 行125
 * 设备计算依据：300天/年, 20.5小时/天, 稼动率85%
 */
export const WORK_DAYS_PER_YEAR = 300; // 天/年
export const HOURS_PER_DAY = 20.5; // 小时/天
export const OEE_RATE = 0.85; // 稼动率 85%
/**
 * 计算设备年度有效工时（小时）
 * @returns 年度有效工时
 *
 * 公式：年度工时 = 300天 × 20.5小时 × 85% = 5242.5小时
 */
export function calculateAnnualAvailableHours() {
    return WORK_DAYS_PER_YEAR * HOURS_PER_DAY * OEE_RATE;
}
//# sourceMappingURL=process-time.js.map