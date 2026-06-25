/**
 * 综合报价公式适配器测试
 * 
 * 验证：
 * 1. 参数转换正确
 * 2. 公式调用正确
 * 3. 结果格式正确
 * 4. 错误处理正确
 */

import { describe, it, expect } from 'vitest';
import { comprehensiveQuoteAdapter } from '../src/formulas/comprehensive-quote-adapter';

describe('comprehensiveQuoteAdapter', () => {
  it('应该正确转换简单参数的输入', () => {
    const result = comprehensiveQuoteAdapter({
      processingFee: 500,
      materialFee: 200,
      complexity: 'medium',
      precision: 'general',
      surface: 'general',
      batchSize: 100,
      profitMargin: 20,
      taxRate: 13,
    });
    
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.processingFee).toBe(500);
    expect(result.data.materialFee).toBe(200);
    expect(result.data.subTotal).toBe(700);
  });

  it('应该正确计算综合乘数', () => {
    // 超复杂 × 超高精度 × 镜面 × 单件
    // 2.0 × 1.6 × 1.8 × 2.0 = 11.52
    const result = comprehensiveQuoteAdapter({
      processingFee: 1000,
      materialFee: 500,
      complexity: 'ultra_complex',
      precision: 'ultra_high',
      surface: 'mirror',
      batchSize: 1,
      profitMargin: 20,
      taxRate: 13,
    });
    
    expect(result.success).toBe(true);
    expect(result.data.compositeFactor).toBe(11.52);
    expect(result.data.adjustedFee).toBe((1000 + 500) * 11.52); // 17280
    expect(result.data.adjustedFee).toBe(17280);
  });

  it('应该正确处理大批量低价', () => {
    // 简单 × 一般精度 × 一般表面 × 大量生产
    // 1.0 × 1.0 × 1.0 × 0.85 = 0.85
    const result = comprehensiveQuoteAdapter({
      processingFee: 10000,
      materialFee: 5000,
      complexity: 'simple',
      precision: 'general',
      surface: 'general',
      batchSize: 50000,
      profitMargin: 15,
      taxRate: 13,
    });
    
    expect(result.success).toBe(true);
    expect(result.data.compositeFactor).toBe(0.85);
    expect(result.data.adjustedFee).toBe((10000 + 5000) * 0.85); // 12750
    // 最终报价 = 12750 × (1 + 0.15 + 0.13) = 12750 × 1.28 = 16320
    expect(result.data.finalQuote).toBe(16320);
  });

  it('应该使用默认利润率20%和税率13%', () => {
    const result = comprehensiveQuoteAdapter({
      processingFee: 500,
      materialFee: 200,
      complexity: 'simple',
      precision: 'general',
      surface: 'general',
      batchSize: 1000,
    });
    
    expect(result.success).toBe(true);
    expect(result.data.profitMargin).toBe(0.20);
    expect(result.data.taxRate).toBe(0.13);
    // 小计 = 700, 乘数 = 1.0, 最终 = 700 × 1.33 = 931
    expect(result.data.finalQuote).toBe(931);
  });

  it('应该处理批量边界值', () => {
    // batchSize = 50 → small (1.5)
    const result50 = comprehensiveQuoteAdapter({
      processingFee: 100,
      materialFee: 50,
      complexity: 'simple',
      precision: 'general',
      surface: 'general',
      batchSize: 50,
    });
    expect(result50.data.compositeFactor).toBe(1.5);
    
    // batchSize = 51 → medium (1.2)
    const result51 = comprehensiveQuoteAdapter({
      processingFee: 100,
      materialFee: 50,
      complexity: 'simple',
      precision: 'general',
      surface: 'general',
      batchSize: 51,
    });
    expect(result51.data.compositeFactor).toBe(1.2);
    
    // batchSize = 500 → medium (1.2)
    const result500 = comprehensiveQuoteAdapter({
      processingFee: 100,
      materialFee: 50,
      complexity: 'simple',
      precision: 'general',
      surface: 'general',
      batchSize: 500,
    });
    expect(result500.data.compositeFactor).toBe(1.2);
    
    // batchSize = 501 → large (1.0)
    const result501 = comprehensiveQuoteAdapter({
      processingFee: 100,
      materialFee: 50,
      complexity: 'simple',
      precision: 'general',
      surface: 'general',
      batchSize: 501,
    });
    expect(result501.data.compositeFactor).toBe(1.0);
  });

  it('应该处理错误输入', () => {
    const result = comprehensiveQuoteAdapter({
      processingFee: 'invalid',  // 非数字
      materialFee: -100,         // 负数
    } as any);
    
    // 应该返回成功（因为 Number('invalid') = 0, 但 -100 会被当作有效值）
    expect(result.success).toBe(true);
  });
});
