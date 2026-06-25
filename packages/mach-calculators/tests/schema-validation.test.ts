/**
 * Calculator Schema 验证测试
 * 
 * 测试：
 * 1. comprehensive-quote schema 结构验证
 * 2. validateCalculatorSchema 函数验证
 * 3. 边界条件测试
 */

import { describe, it, expect } from 'vitest';
import { validateCalculatorSchema } from '../src/schema/calculator-schema';
import { comprehensiveQuoteSchema } from '../src/schema/comprehensive-quote';

describe('comprehensiveQuoteSchema', () => {
  it('应该有完整的 schema 结构', () => {
    expect(comprehensiveQuoteSchema.id).toBe('mach-comprehensive-quote');
    expect(comprehensiveQuoteSchema.title).toContain('综合报价');
    expect(comprehensiveQuoteSchema.description).toBeTruthy();
    expect(comprehensiveQuoteSchema.icon).toBe('💰');
    expect(comprehensiveQuoteSchema.category).toBe('数控加工');
  });

  it('应该有正确的 formula 配置', () => {
    expect(comprehensiveQuoteSchema.formula.module).toBe('@eforge/mach-formulas');
    expect(comprehensiveQuoteSchema.formula.function).toBe('calculateComprehensiveQuote');
    expect(comprehensiveQuoteSchema.formula.source).toContain('文件10');
  });

  it('应该定义 8 个输入字段', () => {
    expect(comprehensiveQuoteSchema.inputs).toHaveLength(8);
    
    const keys = comprehensiveQuoteSchema.inputs.map(i => i.key);
    expect(keys).toContain('processingFee');
    expect(keys).toContain('materialFee');
    expect(keys).toContain('complexity');
    expect(keys).toContain('precision');
    expect(keys).toContain('surface');
    expect(keys).toContain('batchSize');
    expect(keys).toContain('profitMargin');
    expect(keys).toContain('taxRate');
  });

  it('输入字段类型应该正确', () => {
    const feeInput = comprehensiveQuoteSchema.inputs.find(i => i.key === 'processingFee');
    expect(feeInput?.type).toBe('number');
    expect(feeInput?.required).toBe(true);
    expect(feeInput?.unit).toBe('元');
    
    const complexityInput = comprehensiveQuoteSchema.inputs.find(i => i.key === 'complexity');
    expect(complexityInput?.type).toBe('select');
    expect(complexityInput?.options).toHaveLength(4);
  });

  it('应该有 6 个输出字段', () => {
    expect(comprehensiveQuoteSchema.outputs).toHaveLength(6);
    
    const keys = comprehensiveQuoteSchema.outputs.map(o => o.key);
    expect(keys).toContain('processingFee');
    expect(keys).toContain('materialFee');
    expect(keys).toContain('subTotal');
    expect(keys).toContain('compositeFactor');
    expect(keys).toContain('adjustedFee');
    expect(keys).toContain('finalQuote');
  });

  it('应该包含 FAQ 数据', () => {
    expect(comprehensiveQuoteSchema.faq).toHaveLength(3);
    expect(comprehensiveQuoteSchema.faq?.[0].question).toContain('台湾风格');
  });
});

describe('validateCalculatorSchema', () => {
  it('应该通过有效 schema 验证', () => {
    const result = validateCalculatorSchema(comprehensiveQuoteSchema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('应该拒绝缺少 id 的 schema', () => {
    const invalid = { ...comprehensiveQuoteSchema, id: '' };
    const result = validateCalculatorSchema(invalid as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('id'))).toBe(true);
  });

  it('应该拒绝缺少 inputs 的 schema', () => {
    const invalid = { ...comprehensiveQuoteSchema, inputs: [] };
    const result = validateCalculatorSchema(invalid as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('inputs'))).toBe(true);
  });

  it('应该拒绝缺少 outputs 的 schema', () => {
    const invalid = { ...comprehensiveQuoteSchema, outputs: [] };
    const result = validateCalculatorSchema(invalid as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('outputs'))).toBe(true);
  });

  it('应该拒绝 select 类型缺少 options 的 schema', () => {
    const invalid = {
      ...comprehensiveQuoteSchema,
      inputs: [
        { type: 'select', key: 'test', label: '测试' },
      ],
    };
    const result = validateCalculatorSchema(invalid as any);
    expect(result.valid).toBe(false);
  });

  it('应该拒绝 number 类型 min > max 的 schema', () => {
    const invalid = {
      ...comprehensiveQuoteSchema,
      inputs: [
        { type: 'number', key: 'test', label: '测试', min: 100, max: 10 },
      ],
    };
    const result = validateCalculatorSchema(invalid as any);
    expect(result.valid).toBe(false);
  });
});
