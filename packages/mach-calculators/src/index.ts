/**
 * mach-calculators 计算器系统
 * 
 * JSON Schema驱动的动态计算器，用于数控报价领域。
 * 
 * 架构：
 * 1. schema/ - 计算器定义（输入/输出/计算配置）
 * 2. renderer/ - 前端渲染引擎（动态表单+结果展示）
 * 3. formulas/ - 公式适配器（调用@eforge/mach-formulas）
 * 
 * @packageDocumentation
 */

export * from './schema';
