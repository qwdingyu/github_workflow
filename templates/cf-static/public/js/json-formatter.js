/**
 * JSON Formatter - 格式化和验证 JSON 数据
 */

function processTool() {
  const input = document.getElementById('input').value;
  const output = document.getElementById('output');
  
  try {
    const parsed = JSON.parse(input);
    const formatted = JSON.stringify(parsed, null, 2);
    output.value = formatted;
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ JSON 格式错误: ' + e.message;
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
    // 降级方案：选中文本让用户手动复制
    output.select();
  });
}

function clearAll() {
  document.getElementById('input').value = '';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
