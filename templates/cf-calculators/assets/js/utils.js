/**
 * 财务工具通用函数库
 * 提供格式化工具、UI 辅助函数等通用功能
 */

/**
 * 格式化货币金额
 * @param {number} amount - 金额数值
 * @param {number} decimals - 小数位数，默认 2
 * @returns {string} 格式化后的货币字符串
 */
function formatMoney(amount, decimals = 2) {
  return '¥' + amount.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 格式化货币金额（使用 toLocaleString）
 * @param {number} amount - 金额数值
 * @param {number} decimals - 小数位数，默认 2
 * @returns {string} 格式化后的货币字符串
 */
function formatCurrency(amount, decimals = 2) {
  return '¥' + amount.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * 平滑滚动到指定元素
 * @param {string} elementId - 目标元素的 ID
 */
function scrollToElement(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/**
 * 显示结果区域
 * @param {string} elementId - 结果容器的 ID
 */
function showResult(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.display = 'block';
    scrollToElement(elementId);
  }
}

/**
 * 隐藏结果区域
 * @param {string} elementId - 结果容器的 ID
 */
function hideResult(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.display = 'none';
  }
}

/**
 * 验证数字输入
 * @param {string} inputId - 输入框的 ID
 * @param {string} errorMessage - 错误提示信息
 * @param {object} options - 验证选项
 * @param {boolean} options.required - 是否必填
 * @param {number} options.min - 最小值
 * @param {number} options.max - 最大值
 * @returns {number|null} 验证通过返回数值，失败返回 null
 */
function validateNumberInput(inputId, errorMessage, options = {}) {
  const input = document.getElementById(inputId);
  if (!input) return null;

  const value = parseFloat(input.value);

  if (options.required !== false && (isNaN(value) || input.value.trim() === '')) {
    alert(errorMessage || '请输入有效的数字');
    input.focus();
    return null;
  }

  if (!isNaN(value)) {
    if (options.min !== undefined && value < options.min) {
      alert(`数值不能小于 ${options.min}`);
      input.focus();
      return null;
    }
    if (options.max !== undefined && value > options.max) {
      alert(`数值不能大于 ${options.max}`);
      input.focus();
      return null;
    }
  }

  return isNaN(value) ? 0 : value;
}

/**
 * 为输入框绑定回车键事件
 * @param {string|string[]} inputIds - 输入框 ID 或 ID 数组
 * @param {Function} callback - 回车时触发的回调函数
 */
function bindEnterKey(inputIds, callback) {
  const ids = Array.isArray(inputIds) ? inputIds : [inputIds];

  ids.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          callback();
        }
      });
    }
  });
}

/**
 * 创建表格行 HTML
 * @param {string} label - 标签文本
 * @param {string|number} value - 值
 * @param {string} className - CSS 类名
 * @returns {string} 表格行 HTML
 */
function createTableRow(label, value, className = '') {
  const classAttr = className ? ` class="${className}"` : '';
  return `<tr${classAttr}><td>${label}</td><td class="amount">${value}</td></tr>`;
}

/**
 * 创建高亮表格行 HTML
 * @param {string} label - 标签文本
 * @param {string|number} value - 值
 * @returns {string} 高亮表格行 HTML
 */
function createHighlightRow(label, value) {
  return `<tr class="highlight"><td><strong>${label}</strong></td><td class="amount positive"><strong>${value}</strong></td></tr>`;
}

/**
 * 创建总计行 HTML
 * @param {string} label - 标签文本
 * @param {string|number} value - 值
 * @returns {string} 总计行 HTML
 */
function createTotalRow(label, value) {
  return `<tr class="total"><td><strong>${label}</strong></td><td class="amount"><strong>${value}</strong></td></tr>`;
}
