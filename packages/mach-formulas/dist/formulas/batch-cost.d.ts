/**
 * 文件3《机械加工费报价明细及计算表》— 批量生产成本明细
 * 来源：/Users/dingyuwang/Downloads/9-教育/数控报价表/机械加工费报价明细及计算表.xls
 *
 * 此模块专门针对**大批量生产**的成本核算，深入到每件工序的微观层面。
 * 与文件2（单件/小批量）不同，文件3包含：
 * - 工序级的燃动费、设备折旧、工时工资
 * - 模具摊销计算
 * - 外购外协费用
 * - 管理/经营费用明细
 * - 包装费用明细
 */
/**
 * 工序信息
 * 来源：文件3 工序加工费明细区域
 */
export interface ProcessStep {
    sequence: number;
    content: string;
    machineModel: string;
    machinePower: number;
    dailyQuota: number;
    wage: number;
    accessoryCost: number;
    equipmentDepreciation: number;
    fuelCost: number;
}
/**
 * 计算工序单项费用
 * @param step - 工序信息
 * @returns 合计费用（元/件）
 *
 * 公式：合计 = 工序工资 + 辅料费 + 设备折旧 + 燃动费
 *
 * 示例验证（Excel）：
 *   磨外圆工序：工资0.080 + 辅料0.022 + 折旧0.016 + 燃动0.016 = 0.134元/件
 */
export declare function calculateProcessStepFee(step: ProcessStep): number;
/**
 * 计算工序总费用
 * @param steps - 工序列表
 * @returns 总加工费（元/件）
 */
export declare function calculateTotalProcessFee(steps: ProcessStep[]): number;
/**
 * 模具信息
 * 来源：文件3 模治具费用明细区域
 */
export interface MoldInfo {
    sequence: number;
    processName: string;
    moldName: string;
    piecesPerMold: number;
    lifespan: number;
    price: number;
}
/**
 * 计算模具单件摊销费
 * @param mold - 模具信息
 * @returns 摊销费（元/件）
 *
 * 公式：摊销 = 模具价格 ÷ 寿命
 *
 * 示例验证（Excel）：
 *   腔体毛坯冲压模：4500元 ÷ 200000件 = 0.0225元/件
 */
export declare function calculateMoldAmortization(mold: MoldInfo): number;
/**
 * 计算总模具摊销
 * @param molds - 模具列表
 * @param productionVolume - 生产批量（件）
 * @returns 总模具摊销费（元）
 *
 * 公式：总摊销 = Σ(每套模具价格)，当批量≥寿命时
 * 如果批量<寿命，则摊销 = 模具价格 × (批量/寿命)
 */
export declare function calculateTotalMoldAmortization(molds: MoldInfo[], productionVolume: number): number;
/**
 * 计算每件模具摊销费
 * @param molds - 模具列表
 * @param productionVolume - 生产批量（件）
 * @returns 每件摊销（元/件）
 */
export declare function calculateMoldAmortizationPerPiece(molds: MoldInfo[], productionVolume: number): number;
/**
 * 管理费用构成
 * 来源：文件3 管理/经营费用区域
 */
export interface ManagementExpenses {
    businessExpenseRate: number;
    financialExpenseRate: number;
    productionManagementRate: number;
}
export declare const DEFAULT_MANAGEMENT_EXPENSES: ManagementExpenses;
/**
 * 计算管理经营费用
 * @param factoryCost - 工厂成本（元/件）
 * @param expenses - 费用构成
 * @returns 管理经营费用（元/件）
 *
 * 公式：管理费用 = 工厂成本 × (业务2% + 财务2% + 生产管理6%)
 */
export declare function calculateManagementExpenses(factoryCost: number, expenses?: ManagementExpenses): number;
/**
 * 包装信息
 * 来源：文件3 包装费用明细区域
 */
export interface PackagingInfo {
    innerPackagingName: string;
    innerPackagingPrice: number;
    innerPackagingPerBox: number;
    outerPackagingName: string;
    outerPackagingPrice: number;
    outerPackagingPerBox: number;
}
/**
 * 计算包装费（元/件）
 * @param packaging - 包装信息
 * @returns 包装费（元/件）
 *
 * 公式：
 *   内包装费 = 内包装单价 ÷ 每箱数量
 *   外包装费 = 外包装单价 ÷ 每箱数量
 *   总包装费 = 内包装费 + 外包装费
 *
 * 示例验证（Excel）：
 *   吸塑盒：3.2元÷80个 = 0.04元/个
 *   纸箱：2.8元÷160个 = 0.0175元/个
 *   总包装费 = 0.04 + 0.0175 = 0.0575 ≈ 0.057元/件
 */
export declare function calculatePackagingFee(packaging: PackagingInfo): number;
/**
 * 批量生产成本汇总
 */
export interface BatchCostSummary {
    materialFee: number;
    laborFee: number;
    fuelCost: number;
    accessoryCost: number;
    equipmentDepreciation: number;
    outsourcingFee: number;
    manufacturingCost: number;
    scrapRate: number;
    scrapLoss: number;
    moldAmortization: number;
    factoryCost: number;
    managementExpense: number;
    packagingFee: number;
    transportFee: number;
    costBeforeProfit: number;
    profitRate: number;
    profit: number;
    tax: number;
    unitPrice: number;
    totalForVolume: number;
}
/**
 * 计算批量生产成本
 * @param params - 成本参数
 * @returns 成本汇总
 *
 * 公式链（与文件3完全一致）：
 *   制造成本 = 材料费+人工费+燃动费+机物料费+设备折旧+外协外购
 *   废品损失 = 制造成本 × 废品率
 *   工厂成本 = 制造成本 + 废品损失 + 模具分摊费
 *   管理费 = 工厂成本 × 管理费率
 *   利润前成本 = 工厂成本 + 管理费 + 包装费 + 运输费
 *   利润 = 利润前成本 × 利润率
 *   税金 = (利润前成本 + 利润) × 税率(默认17%)
 *   单价 = 利润前成本 + 利润 + 税金
 */
export declare function calculateBatchCost(params: {
    materialFee: number;
    laborFee: number;
    fuelCost: number;
    accessoryCost: number;
    equipmentDepreciation: number;
    outsourcingFee: number;
    scrapRate: number;
    moldAmortization: number;
    managementRate: number;
    packagingFee: number;
    transportFee: number;
    profitRate: number;
    taxRate?: number;
    productionVolume: number;
}): BatchCostSummary;
//# sourceMappingURL=batch-cost.d.ts.map