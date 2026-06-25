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

// ═══════════════════════════════════════════════════
// 一、工序加工费明细
// ═══════════════════════════════════════════════════

/**
 * 工序信息
 * 来源：文件3 工序加工费明细区域
 */
export interface ProcessStep {
  sequence: number;           // 工序序号
  content: string;            // 工序内容
  machineModel: string;       // 机床型号
  machinePower: number;       // 机床功率（kW）
  dailyQuota: number;         // 班定额（件/班）
  wage: number;               // 工序工资（元/件）
  accessoryCost: number;      // 辅料费（元/件）
  equipmentDepreciation: number; // 设备折旧（元/件）
  fuelCost: number;           // 燃动费（元/件）
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
export function calculateProcessStepFee(step: ProcessStep): number {
  return step.wage + step.accessoryCost + step.equipmentDepreciation + step.fuelCost;
}

/**
 * 计算工序总费用
 * @param steps - 工序列表
 * @returns 总加工费（元/件）
 */
export function calculateTotalProcessFee(steps: ProcessStep[]): number {
  return Math.round(
    steps.reduce((sum, step) => sum + calculateProcessStepFee(step), 0) * 10000
  ) / 10000;
}

// ═══════════════════════════════════════════════════
// 二、模具摊销
// ═══════════════════════════════════════════════════

/**
 * 模具信息
 * 来源：文件3 模治具费用明细区域
 */
export interface MoldInfo {
  sequence: number;           // 序号
  processName: string;        // 加工工序
  moldName: string;           // 模具名称
  piecesPerMold: number;      // 件/模（模具寿命）
  lifespan: number;           // 寿命（件/模）
  price: number;              // 价格（元）
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
export function calculateMoldAmortization(mold: MoldInfo): number {
  if (mold.lifespan <= 0) return 0;
  return Math.round(mold.price / mold.lifespan * 10000) / 10000;
}

/**
 * 计算总模具摊销
 * @param molds - 模具列表
 * @param productionVolume - 生产批量（件）
 * @returns 总模具摊销费（元）
 * 
 * 公式：总摊销 = Σ(每套模具价格)，当批量≥寿命时
 * 如果批量<寿命，则摊销 = 模具价格 × (批量/寿命)
 */
export function calculateTotalMoldAmortization(
  molds: MoldInfo[],
  productionVolume: number,
): number {
  return Math.round(
    molds.reduce((sum, mold) => {
      if (productionVolume >= mold.lifespan) {
        // 批量超过模具寿命，全额摊销
        return sum + mold.price;
      }
      // 批量小于模具寿命，按比例摊销
      return sum + mold.price * (productionVolume / mold.lifespan);
    }, 0) * 10000
  ) / 10000;
}

/**
 * 计算每件模具摊销费
 * @param molds - 模具列表
 * @param productionVolume - 生产批量（件）
 * @returns 每件摊销（元/件）
 */
export function calculateMoldAmortizationPerPiece(
  molds: MoldInfo[],
  productionVolume: number,
): number {
  if (productionVolume <= 0) return 0;
  return Math.round(calculateTotalMoldAmortization(molds, productionVolume) / productionVolume * 10000) / 10000;
}

// ═══════════════════════════════════════════════════
// 三、管理与经营费用
// ═══════════════════════════════════════════════════

/**
 * 管理费用构成
 * 来源：文件3 管理/经营费用区域
 */
export interface ManagementExpenses {
  businessExpenseRate: number;    // 业务费用率，默认2%
  financialExpenseRate: number;   // 财务费用率，默认2%
  productionManagementRate: number; // 生产管理水平率，默认6%
}

export const DEFAULT_MANAGEMENT_EXPENSES: ManagementExpenses = {
  businessExpenseRate: 0.02,
  financialExpenseRate: 0.02,
  productionManagementRate: 0.06,
};

/**
 * 计算管理经营费用
 * @param factoryCost - 工厂成本（元/件）
 * @param expenses - 费用构成
 * @returns 管理经营费用（元/件）
 * 
 * 公式：管理费用 = 工厂成本 × (业务2% + 财务2% + 生产管理6%)
 */
export function calculateManagementExpenses(
  factoryCost: number,
  expenses: ManagementExpenses = DEFAULT_MANAGEMENT_EXPENSES,
): number {
  const totalRate = expenses.businessExpenseRate
    + expenses.financialExpenseRate
    + expenses.productionManagementRate;
  return Math.round(factoryCost * totalRate * 10000) / 10000;
}

// ═══════════════════════════════════════════════════
// 四、包装费用
// ═══════════════════════════════════════════════════

/**
 * 包装信息
 * 来源：文件3 包装费用明细区域
 */
export interface PackagingInfo {
  innerPackagingName: string;     // 内包装名称（如吸塑盒）
  innerPackagingPrice: number;    // 内包装单价（元/个）
  innerPackagingPerBox: number;   // 每箱数量（个）
  outerPackagingName: string;     // 外包装名称（如纸箱）
  outerPackagingPrice: number;    // 外包装单价（元/个）
  outerPackagingPerBox: number;   // 每箱数量（个）
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
export function calculatePackagingFee(packaging: PackagingInfo): number {
  const innerFee = packaging.innerPackagingPrice / packaging.innerPackagingPerBox;
  const outerFee = packaging.outerPackagingPrice / packaging.outerPackagingPerBox;
  return Math.round((innerFee + outerFee) * 1000) / 1000;
}

// ═══════════════════════════════════════════════════
// 五、批量生产成本汇总
// ═══════════════════════════════════════════════════

/**
 * 批量生产成本汇总
 */
export interface BatchCostSummary {
  materialFee: number;           // 材料费（元/件）
  laborFee: number;              // 人工费（元/件）
  fuelCost: number;              // 燃动费（元/件）
  accessoryCost: number;         // 机物料费（元/件）
  equipmentDepreciation: number; // 设备折旧（元/件）
  outsourcingFee: number;        // 外协外购费（元/件）
  manufacturingCost: number;     // 制造成本 = 上述各项之和
  scrapRate: number;             // 废品率
  scrapLoss: number;             // 废品损失（元/件）
  moldAmortization: number;      // 模具分摊费（元/件）
  factoryCost: number;           // 工厂成本 = 制造成本+废品损失+模具分摊
  managementExpense: number;     // 管理费（元/件）
  packagingFee: number;          // 包装费（元/件）
  transportFee: number;          // 运输费（元/件）
  costBeforeProfit: number;      // 利润前成本 = 工厂成本+管理费+包装+运输
  profitRate: number;            // 利润率
  profit: number;                // 利润（元/件）
  tax: number;                   // 税金（元/件）
  unitPrice: number;             // 单价（元/件）
  totalForVolume: number;        // 批量总价（元）
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
export function calculateBatchCost(params: {
  materialFee: number;            // 材料费（元/件）
  laborFee: number;               // 人工费（元/件）
  fuelCost: number;               // 燃动费（元/件）
  accessoryCost: number;          // 机物料费（元/件）
  equipmentDepreciation: number;  // 设备折旧（元/件）
  outsourcingFee: number;         // 外协外购费（元/件）
  scrapRate: number;              // 废品率（如3% → 0.03）
  moldAmortization: number;       // 模具分摊费（元/件）
  managementRate: number;         // 管理费率，默认10%
  packagingFee: number;           // 包装费（元/件）
  transportFee: number;           // 运输费（元/件）
  profitRate: number;             // 利润率，默认10%
  taxRate?: number;               // 税率，默认17%
  productionVolume: number;       // 生产批量
}): BatchCostSummary {
  // 制造成本
  const manufacturingCost = params.materialFee
    + params.laborFee
    + params.fuelCost
    + params.accessoryCost
    + params.equipmentDepreciation
    + params.outsourcingFee;
  
  // 废品损失
  const scrapLoss = Math.round(manufacturingCost * params.scrapRate * 10000) / 10000;
  
  // 工厂成本
  const factoryCost = manufacturingCost + scrapLoss + params.moldAmortization;
  
  // 管理费
  const managementRate = params.managementRate || 0.10;
  const managementExpense = Math.round(factoryCost * managementRate * 10000) / 10000;
  
  // 利润前成本
  const costBeforeProfit = factoryCost + managementExpense
    + params.packagingFee + params.transportFee;
  
  // 利润
  const profit = Math.round(costBeforeProfit * params.profitRate * 10000) / 10000;
  
  // 税金
  const taxRate = params.taxRate || 0.17;
  const tax = Math.round((costBeforeProfit + profit) * taxRate * 10000) / 10000;
  
  // 单价
  const unitPrice = Math.round((costBeforeProfit + profit + tax) * 10000) / 10000;
  
  return {
    materialFee: Math.round(params.materialFee * 10000) / 10000,
    laborFee: Math.round(params.laborFee * 10000) / 10000,
    fuelCost: Math.round(params.fuelCost * 10000) / 10000,
    accessoryCost: Math.round(params.accessoryCost * 10000) / 10000,
    equipmentDepreciation: Math.round(params.equipmentDepreciation * 10000) / 10000,
    outsourcingFee: Math.round(params.outsourcingFee * 10000) / 10000,
    manufacturingCost: Math.round(manufacturingCost * 10000) / 10000,
    scrapRate: params.scrapRate,
    scrapLoss,
    moldAmortization: Math.round(params.moldAmortization * 10000) / 10000,
    factoryCost: Math.round(factoryCost * 10000) / 10000,
    managementExpense,
    packagingFee: Math.round(params.packagingFee * 10000) / 10000,
    transportFee: Math.round(params.transportFee * 10000) / 10000,
    costBeforeProfit: Math.round(costBeforeProfit * 10000) / 10000,
    profitRate: params.profitRate,
    profit,
    tax,
    unitPrice,
    totalForVolume: Math.round(unitPrice * params.productionVolume * 100) / 100,
  };
}
