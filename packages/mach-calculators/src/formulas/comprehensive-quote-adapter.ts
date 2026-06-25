/**
 * 公式适配器 - 综合报价
 * 
 * 将 @eforge/mach-formulas 的 calculateComprehensiveQuote 函数
 * 包装为 CalculatorRenderer 可用的标准格式。
 * 
 * 标准格式：
 *   function(params): CalculationResult
 * 
 * @module formulas/comprehensive-quote-adapter
 */

import { calculateComprehensiveQuote } from '@eforge/mach-formulas';

/**
 * 综合报价公式适配器
 * 
 * 将 schema 输入参数转换为公式函数所需的参数格式，
 * 并返回标准格式的 CalculationResult。
 * 
 * @param {Object} params - 输入参数（来自表单）
 * @returns {Object} - CalculationResult 格式
 */
export function comprehensiveQuoteAdapter(params) {
  try {
    // 参数转换：将 schema 输入转换为公式参数
    const formulaParams = {
      processingFee: Number(params.processingFee) || 0,
      materialFee: Number(params.materialFee) || 0,
      complexity: params.complexity || 'medium',
      precision: params.precision || 'general',
      surface: params.surface || 'general',
      batchSize: Number(params.batchSize) || 1,
      profitMargin: (Number(params.profitMargin) || 20) / 100,
      taxRate: (Number(params.taxRate) || 13) / 100,
    };
    
    // 调用公式函数
    const result = calculateComprehensiveQuote(formulaParams);
    
    // 返回标准格式
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || '计算失败',
    };
  }
}
