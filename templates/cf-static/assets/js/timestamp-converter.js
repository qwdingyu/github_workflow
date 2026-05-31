/**
 * Timestamp Converter - 时间戳转换器
 */

function processTool() {
  const input = document.getElementById('input').value.trim();
  const output = document.getElementById('output');

  try {
    if (!input) {
      throw new Error('请输入时间戳或日期时间');
    }

    let result;
    // 判断输入是时间戳还是日期字符串
    if (/^\d+$/.test(input)) {
      // 输入是时间戳
      const timestamp = parseInt(input);
      // 判断是秒级还是毫秒级
      const date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
      
      if (isNaN(date.getTime())) {
        throw new Error('无效的时间戳');
      }

      result = `日期时间: ${date.toLocaleString('zh-CN')}\n`;
      result += `ISO 格式: ${date.toISOString()}\n`;
      result += `UTC 时间: ${date.toUTCString()}\n`;
      result += `\n时间戳 (秒): ${Math.floor(date.getTime() / 1000)}\n`;
      result += `时间戳 (毫秒): ${date.getTime()}`;
    } else {
      // 输入是日期字符串
      const date = new Date(input);
      if (isNaN(date.getTime())) {
        throw new Error('无效的日期格式');
      }

      result = `时间戳 (秒): ${Math.floor(date.getTime() / 1000)}\n`;
      result += `时间戳 (毫秒): ${date.getTime()}\n`;
      result += `\nISO 格式: ${date.toISOString()}\n`;
      result += `UTC 时间: ${date.toUTCString()}`;
    }

    output.value = result;
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ 转换失败: ' + e.message;
    output.classList.add('error');
    output.classList.remove('success');
  }
}

function copyOutput() {
  const output = document.getElementById('output');
  if (!output.value) return;

  navigator.clipboard.writeText(output.value).then(() => {
    const btn = document.querySelector('.tool-actions .btn-secondary');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = '✓ 已复制';
      setTimeout(() => { btn.textContent = originalText; }, 2000);
    }
  }).catch(() => {
    output.select();
  });
}

function clearAll() {
  document.getElementById('input').value = '';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}

// 实时显示当前时间戳
function updateCurrentTimestamp() {
  const now = new Date();
  const el = document.getElementById('current-timestamp');
  if (el) {
    el.textContent = `当前时间戳: ${Math.floor(now.getTime() / 1000)}`;
  }
}

// 页面加载时更新
if (document.getElementById('current-timestamp')) {
  updateCurrentTimestamp();
  setInterval(updateCurrentTimestamp, 1000);
}
