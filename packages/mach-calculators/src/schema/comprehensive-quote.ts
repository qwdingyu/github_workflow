/**
 * 综合报价计算器 Schema 定义
 * 
 * 对应文件10《加工件費用計算表》— 台湾风格综合报价+乘数体系
 * 
 * 报价公式：
 *   综合报价 = (加工费 + 材料费) × K1 × K2 × K3 × K4 × (1 + 利润率 + 税率)
 * 
 * @module schema/comprehensive-quote
 */

import type { CalculatorDefinition } from './calculator-schema';

/**
 * 综合报价计算器完整定义
 * 
 * 输入参数：
 * - 加工费/材料费（数值）
 * - 复杂程度/精度等级/表面粗糙度（枚举选择）
 * - 批量（数值）
 * - 利润率/税率（可选）
 * 
 * 输出结果：
 * - 加工费/材料费/小计
 * - 综合乘数
 * - 调整后的费用
 * - 最终报价
 */
export const comprehensiveQuoteSchema: CalculatorDefinition = {
  id: 'mach-comprehensive-quote',
  title: '综合报价计算器（台湾风格）',
  description: '基于台湾风格加工件报价表，使用乘数体系进行综合报价。支持复杂程度、精度等级、表面粗糙度、批量等多维度乘数计算。',
  icon: '💰',
  category: '数控加工',
  version: '1.0.0',
  
  formula: {
    module: '@eforge/mach-formulas',
    function: 'calculateComprehensiveQuote',
    source: '文件10《加工件費用計算表》',
  },
  
  inputs: [
    {
      type: 'number',
      key: 'processingFee',
      label: '加工费',
      unit: '元',
      required: true,
      min: 0,
      step: 0.01,
      placeholder: '请输入加工费',
      helpText: '各工序加工工时×设备费率之和',
      default: 500,
    },
    {
      type: 'number',
      key: 'materialFee',
      label: '材料费',
      unit: '元',
      required: true,
      min: 0,
      step: 0.01,
      placeholder: '请输入材料费',
      helpText: '毛坯材料重量×材料单价',
      default: 200,
    },
    {
      type: 'select',
      key: 'complexity',
      label: '复杂程度（K1）',
      required: true,
      helpText: '根据零件加工难度选择复杂程度系数',
      options: [
        { label: '简单（K1=1.0）— 单一工序，无复杂形状', value: 'simple', default: true },
        { label: '中等（K1=1.2）— 多工序，一般形状', value: 'medium' },
        { label: '复杂（K1=1.5）— 多工序+复杂曲面', value: 'complex' },
        { label: '超复杂（K1=2.0）— 精密模具/特殊结构', value: 'ultra_complex' },
      ],
    },
    {
      type: 'select',
      key: 'precision',
      label: '精度等级（K2）',
      required: true,
      helpText: '根据图纸精度要求选择精度等级系数',
      options: [
        { label: '一般精度（K2=1.0）— IT12-IT13', value: 'general', default: true },
        { label: '中等精度（K2=1.15）— IT11-IT12', value: 'medium' },
        { label: '高精度（K2=1.35）— IT9-IT10', value: 'high' },
        { label: '超高精度（K2=1.6）— IT6-IT8', value: 'ultra_high' },
      ],
    },
    {
      type: 'select',
      key: 'surface',
      label: '表面粗糙度（K3）',
      required: true,
      helpText: '根据表面粗糙度要求选择系数',
      options: [
        { label: '一般（K3=1.0）— Ra 12.5-25', value: 'general', default: true },
        { label: '中等（K3=1.1）— Ra 6.3-12.5', value: 'medium' },
        { label: '精细（K3=1.25）— Ra 3.2-6.3', value: 'fine' },
        { label: '超精细（K3=1.5）— Ra 0.8-3.2', value: 'ultra_fine' },
        { label: '镜面（K3=1.8）— Ra < 0.8', value: 'mirror' },
      ],
    },
    {
      type: 'number',
      key: 'batchSize',
      label: '批量',
      unit: '件',
      required: true,
      min: 1,
      step: 1,
      placeholder: '请输入生产批量',
      helpText: '生产数量，影响批量系数K4',
      default: 100,
    },
    {
      type: 'number',
      key: 'profitMargin',
      label: '利润率',
      unit: '%',
      required: false,
      min: 0,
      max: 100,
      step: 1,
      placeholder: '默认20%',
      helpText: '企业目标利润率（百分比）',
      default: 20,
    },
    {
      type: 'number',
      key: 'taxRate',
      label: '税率',
      unit: '%',
      required: false,
      min: 0,
      max: 50,
      step: 1,
      placeholder: '默认13%',
      helpText: '增值税税率（百分比）',
      default: 13,
    },
  ],
  
  outputs: [
    {
      type: 'computed',
      key: 'processingFee',
      label: '加工费',
      unit: '元',
      order: 1,
    },
    {
      type: 'computed',
      key: 'materialFee',
      label: '材料费',
      unit: '元',
      order: 2,
    },
    {
      type: 'computed',
      key: 'subTotal',
      label: '小计（加工费+材料费）',
      unit: '元',
      order: 3,
    },
    {
      type: 'computed',
      key: 'compositeFactor',
      label: '综合乘数（K1×K2×K3×K4）',
      decimal: 3,
      order: 4,
      highlight: true,
    },
    {
      type: 'computed',
      key: 'adjustedFee',
      label: '调整后的费用',
      unit: '元',
      order: 5,
      highlight: true,
    },
    {
      type: 'computed',
      key: 'finalQuote',
      label: '最终报价',
      unit: '元',
      decimal: 2,
      order: 6,
      highlight: true,
    },
  ],
  
  calculation: {
    mode: 'auto',
    resultLayout: 'below',
    showIntermediate: true,
  },
  
  faq: [
    {
      question: '台湾风格报价和大陆风格有什么区别？',
      answer: '台湾风格采用"基础费×乘数"体系，通过复杂程度K1、精度等级K2、表面粗糙度K4个独立乘数调整基础费用，更灵活。大陆风格通常直接给出固定报价或按工序单价累加。',
    },
    {
      question: '综合乘数如何理解？',
      answer: '综合乘数是K1×K2×K3×K4的乘积。例如：复杂零件(K1=1.5)×高精度(K2=1.35)×精细表面(K3=1.25)×中批量(K4=1.2) = 3.038，意味着基础费用需要乘以3倍。',
    },
    {
      question: '批量系数如何确定？',
      answer: '单件(1件)×2.0，小批量(1-50件)×1.5，中批量(51-500件)×1.2，大批量(501-10000件)×1.0，大量生产(>10000件)×0.85。批量越大，单价越低。',
    },
  ],
};
