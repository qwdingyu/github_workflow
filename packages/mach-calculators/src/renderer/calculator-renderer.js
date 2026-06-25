/**
 * 数控报价计算器渲染引擎
 * 
 * 根据 CalculatorDefinition schema 动态渲染输入表单和计算结果。
 * 纯 vanilla JS 实现，无框架依赖。
 * 
 * 工作流程：
 * 1. 从 schema 定义中读取输入字段配置
 * 2. 动态创建表单元素
 * 3. 监听输入变更，调用公式函数
 * 4. 根据输出定义渲染结果
 * 
 * @module renderer/calculator-renderer
 */

/**
 * 输入字段渲染器
 * 根据 InputField 配置创建对应的 DOM 元素
 */
class InputRenderer {
  /**
   * 渲染单个输入字段
   * @param {InputField} field - 输入字段定义
   * @returns {HTMLElement} - 字段容器元素
   */
  static render(field) {
    const wrapper = document.createElement('div');
    wrapper.className = 'calc-field';

    // 创建 label
    const label = document.createElement('label');
    label.className = 'calc-field-label';
    label.htmlFor = `calc-${field.key}`;
    label.textContent = field.label;
    
    // 添加单位
    if (field.unit) {
      const unitSpan = document.createElement('span');
      unitSpan.className = 'calc-field-unit';
      unitSpan.textContent = field.unit;
      label.append(unitSpan);
    }
    
    // 添加必填标记
    if (field.required) {
      const req = document.createElement('span');
      req.className = 'calc-required';
      req.textContent = ' *';
      label.append(req);
    }
    
    wrapper.appendChild(label);

    let input;
    
    if (field.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
      if (field.default !== undefined) input.value = field.default;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.helpText) input.title = field.helpText;
      
    } else if (field.type === 'select') {
      input = document.createElement('select');
      for (const option of field.options || []) {
        const opt = document.createElement('option');
        opt.value = String(option.value);
        opt.textContent = option.label;
        if (option.default) opt.selected = true;
        input.appendChild(opt);
      }
      
    } else if (field.type === 'radio') {
      const group = document.createElement('div');
      group.className = 'calc-radio-group';
      for (const option of field.options || []) {
        const radioLabel = document.createElement('label');
        radioLabel.className = 'calc-radio-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = field.key;
        radio.value = String(option.value);
        if (option.default) radio.checked = true;
        radioLabel.append(radio);
        radioLabel.append(document.createTextNode(` ${option.label}`));
        group.appendChild(radioLabel);
      }
      wrapper.appendChild(group);
      return wrapper;
      
    } else if (field.type === 'checkbox') {
      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'calc-checkbox';
      input = document.createElement('input');
      input.type = 'checkbox';
      input.name = field.key;
      checkboxLabel.append(input);
      checkboxLabel.append(document.createTextNode(` ${field.label}`));
      wrapper.appendChild(checkboxLabel);
      return wrapper;
      
    } else if (field.type === 'text') {
      input = document.createElement('input');
      input.type = 'text';
      if (field.placeholder) input.placeholder = field.placeholder;
    }
    
    input.id = `calc-${field.key}`;
    input.name = field.key;
    input.className = 'calc-input';
    wrapper.appendChild(input);

    // 添加帮助文本
    if (field.helpText) {
      const help = document.createElement('div');
      help.className = 'calc-field-help';
      help.textContent = field.helpText;
      wrapper.appendChild(help);
    }

    return wrapper;
  }

  /**
   * 收集所有输入字段的值
   * @param {CalculatorDefinition} schema - 计算器定义
   * @param {HTMLElement} container - 表单容器
   * @returns {Object} - 输入参数对象
   */
  static collectValues(schema, container) {
    const values = {};
    
    for (const input of schema.inputs) {
      if (input.type === 'select') {
        const select = container.querySelector(`select[name="${input.key}"]`);
        if (select) {
          values[input.key] = select.value;
        }
      } else if (input.type === 'radio') {
        const radios = container.querySelectorAll(`input[name="${input.key}"]:checked`);
        if (radios.length > 0) {
          values[input.key] = radios[0].value;
        }
      } else if (input.type === 'checkbox') {
        const checkbox = container.querySelector(`input[name="${input.key}"]`);
        if (checkbox) {
          values[input.key] = checkbox.checked;
        }
      } else {
        const field = container.querySelector(`input[name="${input.key}"]`);
        if (field) {
          const val = field.type === 'number' ? parseFloat(field.value) : field.value;
          if (!isNaN(val) || field.value) {
            values[input.key] = val;
          }
        }
      }
    }
    
    return values;
  }
}

/**
 * 输出字段渲染器
 * 根据 OutputField 配置创建结果展示元素
 */
class OutputRenderer {
  /**
   * 渲染单个输出字段
   * @param {OutputField} field - 输出字段定义
   * @param {*} value - 计算结果值
   * @returns {HTMLElement} - 结果展示元素
   */
  static render(field, value) {
    const wrapper = document.createElement('div');
    wrapper.className = `calc-output calc-output-${field.type}`;
    
    if (field.highlight) {
      wrapper.classList.add('calc-highlight');
    }

    const label = document.createElement('div');
    label.className = 'calc-output-label';
    label.textContent = field.label;
    wrapper.appendChild(label);

    const valueContainer = document.createElement('div');
    valueContainer.className = 'calc-output-value';
    
    // 格式化数值
    let displayValue = value;
    if (typeof value === 'number') {
      const decimal = field.decimal !== undefined ? field.decimal : 2;
      displayValue = value.toFixed(decimal);
    }
    
    if (field.unit) {
      const unitSpan = document.createElement('span');
      unitSpan.className = 'calc-output-unit';
      unitSpan.textContent = field.unit;
      valueContainer.append(displayValue, unitSpan);
    } else {
      valueContainer.textContent = displayValue;
    }
    
    wrapper.appendChild(valueContainer);

    // 添加帮助文本
    if (field.helpText) {
      const help = document.createElement('div');
      help.className = 'calc-output-help';
      help.textContent = field.helpText;
      wrapper.appendChild(help);
    }

    return wrapper;
  }

  /**
   * 渲染所有输出结果
   * @param {OutputField[]} outputs - 输出字段定义
   * @param {Object} data - 计算结果数据
   * @returns {DocumentFragment} - 结果片段
   */
  static renderAll(outputs, data) {
    const fragment = document.createDocumentFragment();
    
    // 按 order 排序
    const sortedOutputs = [...outputs].sort((a, b) => (a.order || 0) - (b.order || 0));
    
    for (const output of sortedOutputs) {
      const value = data[output.key];
      if (value !== undefined && value !== null) {
        fragment.appendChild(this.render(output, value));
      }
    }
    
    return fragment;
  }
}

/**
 * 计算器渲染器
 * 核心类，负责整个计算器的渲染和交互
 */
class CalculatorRenderer {
  /**
   * 创建计算器渲染器
   * @param {CalculatorDefinition} schema - 计算器定义
   * @param {Function} calculateFunc - 计算公式函数
   */
  constructor(schema, calculateFunc) {
    this.schema = schema;
    this.calculateFunc = calculateFunc;
    this.container = null;
    this.inputsContainer = null;
    this.resultsContainer = null;
    this.isAutoCalculate = schema.calculation?.mode !== 'manual';
  }

  /**
   * 渲染计算器到指定容器
   * @param {HTMLElement} container - 目标容器
   */
  render(container) {
    this.container = container;
    
    // 创建主容器
    const main = document.createElement('div');
    main.className = 'mach-calculator';
    main.dataset.calculatorId = this.schema.id;

    // 创建输入区域
    this.inputsContainer = document.createElement('div');
    this.inputsContainer.className = 'calc-inputs';
    
    // 渲染所有输入字段
    for (const input of this.schema.inputs) {
      const fieldEl = InputRenderer.render(input);
      this.inputsContainer.appendChild(fieldEl);
    }
    
    // 添加计算按钮（如果是手动模式）
    if (!this.isAutoCalculate) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calc-button calc-button-primary';
      btn.textContent = this.schema.calculation?.buttonText || '计算';
      btn.addEventListener('click', () => this.calculate());
      this.inputsContainer.appendChild(btn);
    }
    
    main.appendChild(this.inputsContainer);

    // 创建结果区域
    this.resultsContainer = document.createElement('div');
    this.resultsContainer.className = 'calc-results';
    this.resultsContainer.style.display = 'none';
    main.appendChild(this.resultsContainer);

    // 添加到页面
    container.appendChild(main);

    // 绑定事件
    this.bindEvents();

    // 自动计算
    if (this.isAutoCalculate) {
      this.calculate();
    }
  }

  /**
   * 绑定输入事件
   */
  bindEvents() {
    // 监听所有输入变更
    this.inputsContainer.addEventListener('input', () => {
      if (this.isAutoCalculate) {
        this.calculate();
      }
    });
    
    this.inputsContainer.addEventListener('change', () => {
      if (this.isAutoCalculate) {
        this.calculate();
      }
    });
  }

  /**
   * 执行计算
   */
  calculate() {
    try {
      // 收集输入值
      const params = InputRenderer.collectValues(this.schema, this.inputsContainer);
      
      // 调用公式函数
      const result = this.calculateFunc(params);
      
      // 渲染结果
      if (result && result.success) {
        this.renderResults(result.data);
      } else if (result && result.error) {
        this.showError(result.error);
      }
    } catch (error) {
      console.error('计算错误:', error);
      this.showError(error.message || '计算失败，请检查输入参数');
    }
  }

  /**
   * 渲染计算结果
   * @param {Object} data - 计算结果数据
   */
  renderResults(data) {
    if (!this.resultsContainer) return;
    
    // 清空旧结果
    this.resultsContainer.innerHTML = '';
    
    // 渲染结果
    const fragment = OutputRenderer.renderAll(this.schema.outputs, data);
    this.resultsContainer.appendChild(fragment);
    
    // 显示结果区域
    this.resultsContainer.style.display = 'block';
  }

  /**
   * 显示错误信息
   * @param {string} message - 错误信息
   */
  showError(message) {
    if (!this.resultsContainer) return;
    
    this.resultsContainer.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'calc-error';
    errorDiv.textContent = `⚠️ ${message}`;
    this.resultsContainer.appendChild(errorDiv);
    this.resultsContainer.style.display = 'block';
  }

  /**
   * 手动触发计算
   */
  triggerCalculate() {
    this.calculate();
  }

  /**
   * 重置表单
   */
  reset() {
    // 重置所有输入字段
    for (const input of this.schema.inputs) {
      const field = this.inputsContainer.querySelector(`[name="${input.key}"]`);
      if (field) {
        if (input.type === 'number' && input.default !== undefined) {
          field.value = input.default;
        } else if (input.type === 'select') {
          const defaultOpt = this.inputsContainer.querySelector(
            `select[name="${input.key}"] option[default]`
          );
          if (defaultOpt) {
            field.value = defaultOpt.value;
          }
        }
      }
    }
    
    // 隐藏结果
    if (this.resultsContainer) {
      this.resultsContainer.innerHTML = '';
      this.resultsContainer.style.display = 'none';
    }
    
    // 重新计算
    if (this.isAutoCalculate) {
      this.calculate();
    }
  }
}

// ============================================================================
// 导出
// ============================================================================

export { InputRenderer, OutputRenderer, CalculatorRenderer };

/**
 * 全局工厂函数：快速创建计算器
 * 
 * 用法：
 *   createCalculator(schema, calculateFunc, containerId)
 * 
 * 示例：
 *   createCalculator(comprehensiveQuoteSchema, calculateComprehensiveQuote, 'calculator-root')
 */
function createCalculator(schema, calculateFunc, containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`容器 #${containerId} 不存在`);
    return null;
  }
  
  const renderer = new CalculatorRenderer(schema, calculateFunc);
  renderer.render(container);
  return renderer;
}

// 暴露到全局（供浏览器端使用）
if (typeof window !== 'undefined') {
  window.createCalculator = createCalculator;
  window.CalculatorRenderer = CalculatorRenderer;
}
