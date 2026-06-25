/**
 * 数控报价计算器 Schema 类型定义
 * 
 * 定义计算器的输入/输出/计算配置，用于动态渲染表单和调用公式。
 * 
 * @module schema/calculator-schema
 */

// ============================================================================
// 输入字段类型
// ============================================================================

/**
 * 输入字段类型
 * - number: 数值输入（支持min/max/step）
 * - select: 下拉选择（需要options）
 * - radio: 单选按钮（需要options）
 * - checkbox: 复选框
 * - text: 文本输入（可选，用于备注等）
 */
export type InputFieldType = 'number' | 'select' | 'radio' | 'checkbox' | 'text';

/**
 * 枚举选项
 */
export interface SelectOption {
  /** 选项显示文本 */
  label: string;
  /** 选项值 */
  value: string | number;
  /** 是否默认选中 */
  default?: boolean;
}

/**
 * 输入字段定义
 * 
 * 与cf-form的字段定义保持兼容：
 * - type: 与cf-form一致（number/select/radio/checkbox/text）
 * - key: 字段唯一标识，对应公式参数名
 * - label: 显示标签（支持中文+公式符号）
 * - required: 是否必填
 * - unit: 单位（mm/元/min等）
 * - helpText: 帮助文本（解释参数含义）
 */
export interface InputField {
  /** 字段类型 */
  type: InputFieldType;
  /** 字段唯一标识（对应公式参数名） */
  key: string;
  /** 显示标签 */
  label: string;
  /** 是否必填 */
  required?: boolean;
  /** 单位 */
  unit?: string;
  /** 占位文本 */
  placeholder?: string;
  /** 帮助文本（参数说明） */
  helpText?: string;
  /** 默认值 */
  default?: string | number;
  
  // number类型专用
  /** 最小值 */
  min?: number;
  /** 最大值 */
  max?: number;
  /** 步进值 */
  step?: number;
  
  // select/radio类型专用
  /** 选项列表 */
  options?: SelectOption[];
  
  // checkbox类型专用
  /** 选中时的值 */
  trueValue?: string | number;
  /** 未选中时的值 */
  falseValue?: string | number;
  
  // 条件显示
  /** 条件：当其他字段等于某值时显示 */
  showIf?: {
    key: string;
    value: string | number;
  };
}

// ============================================================================
// 输出字段类型
// ============================================================================

/**
 * 输出字段类型
 * - computed: 自动计算的结果（只读数值）
 * - summary: 汇总信息（key-value对）
 * - table: 明细表格（用于展示中间计算步骤）
 */
export type OutputFieldType = 'computed' | 'summary' | 'table';

/**
 * 输出字段定义
 * 
 * 定义计算结果的展示方式
 */
export interface OutputField {
  /** 字段类型 */
  type: OutputFieldType;
  /** 字段标识（对应公式返回对象的key） */
  key: string;
  /** 显示标签 */
  label: string;
  /** 单位 */
  unit?: string;
  /** 小数位数 */
  decimal?: number;
  /** 是否显示（用于条件展示） */
  visible?: boolean;
  /** 帮助文本 */
  helpText?: string;
  /** 排序权重（越小越靠前） */
  order?: number;
  /** 是否高亮显示 */
  highlight?: boolean;
}

/**
 * 表格列定义
 */
export interface TableColumn {
  /** 列标识 */
  key: string;
  /** 列标题 */
  label: string;
  /** 列宽度（px/%） */
  width?: string;
  /** 格式：number/text/percent */
  format?: 'number' | 'text' | 'percent';
  /** 小数位数 */
  decimal?: number;
}

/**
 * 表格输出字段
 */
export interface OutputTableField extends OutputField {
  type: 'table';
  /** 表格列定义 */
  columns: TableColumn[];
}

// ============================================================================
// 计算器配置
// ============================================================================

/**
 * 计算模式
 * - auto: 输入变更时自动计算
 * - manual: 需要用户点击计算按钮
 */
export type CalculationMode = 'auto' | 'manual';

/**
 * 结果展示位置
 * - below: 结果在输入下方
 * - tab: 结果在新tab页签
 * - expandable: 可展开/收起的结果面板
 */
export type ResultLayout = 'below' | 'tab' | 'expandable';

/**
 * 计算器完整定义
 * 
 * 这是一个计算器的完整配置，包含：
 * 1. 基本信息（标题、描述、图标）
 * 2. 公式来源（哪个TS模块的哪个函数）
 * 3. 输入定义（用户需要填写的参数）
 * 4. 输出定义（计算结果如何展示）
 * 5. 计算配置（自动/手动、结果布局）
 */
export interface CalculatorDefinition {
  /** 计算器唯一标识（对应URL slug） */
  id: string;
  /** 标题 */
  title: string;
  /** 描述 */
  description: string;
  /** 图标（emoji） */
  icon?: string;
  /** 分类（如"数控加工"） */
  category?: string;
  /** 版本 */
  version?: string;
  /** 公式来源 */
  formula: {
    /** 模块路径（相对于@eforge/mach-formulas） */
    module: string;
    /** 函数名 */
    function: string;
    /** 原始文档来源（如"文件10《加工件費用計算表》"） */
    source?: string;
  };
  /** 输入字段定义 */
  inputs: InputField[];
  /** 输出字段定义 */
  outputs: OutputField[];
  /** 计算配置 */
  calculation?: {
    /** 计算模式 */
    mode?: CalculationMode;
    /** 结果布局 */
    resultLayout?: ResultLayout;
    /** 是否展示中间计算步骤 */
    showIntermediate?: boolean;
    /** 计算按钮文本 */
    buttonText?: string;
  };
  /** FAQ（用于SEO） */
  faq?: Array<{
    question: string;
    answer: string;
  }>;
}

// ============================================================================
// 计算结果类型
// ============================================================================

/**
 * 通用计算结果
 */
export interface CalculationResult {
  /** 计算是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
  /** 计算结果数据 */
  data?: Record<string, unknown>;
  /** 中间计算步骤（如果开启showIntermediate） */
  intermediate?: Record<string, unknown>;
}

// ============================================================================
// Schema验证
// ============================================================================

/**
 * Schema验证结果
 */
export interface SchemaValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 验证错误列表 */
  errors: string[];
}

/**
 * 验证计算器schema是否有效
 */
export function validateCalculatorSchema(
  schema: CalculatorDefinition
): SchemaValidationResult {
  const errors: string[] = [];
  
  // 基本必填验证
  if (!schema.id) {
    errors.push('缺少必填字段: id');
  }
  if (!schema.title) {
    errors.push('缺少必填字段: title');
  }
  if (!schema.description) {
    errors.push('缺少必填字段: description');
  }
  if (!schema.formula?.module) {
    errors.push('缺少必填字段: formula.module');
  }
  if (!schema.formula?.function) {
    errors.push('缺少必填字段: formula.function');
  }
  if (!schema.inputs || schema.inputs.length === 0) {
    errors.push('至少需要定义一个输入字段: inputs');
  }
  if (!schema.outputs || schema.outputs.length === 0) {
    errors.push('至少需要定义一个输出字段: outputs');
  }
  
  // 输入字段验证
  if (schema.inputs) {
    const keys = new Set<string>();
    for (const input of schema.inputs) {
      if (!input.key) {
        errors.push(`输入字段缺少key: ${JSON.stringify(input)}`);
      } else if (keys.has(input.key)) {
        errors.push(`输入字段key重复: ${input.key}`);
      }
      keys.add(input.key);
      
      // select/radio必须有options
      if ((input.type === 'select' || input.type === 'radio') && !input.options?.length) {
        errors.push(`输入字段${input.key}是${input.type}类型，但缺少options`);
      }
      
      // number类型验证min/max
      if (input.type === 'number') {
        if (input.min !== undefined && input.max !== undefined && input.min > input.max) {
          errors.push(`输入字段${input.key}的min(${input.min}) > max(${input.max})`);
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
