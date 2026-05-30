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
  output.select();
  document.execCommand('copy');
  
  // 显示复制成功提示
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = '✓ 已复制';
  setTimeout(() => {
    btn.textContent = originalText;
  }, 2000);
}

function clearAll() {
  document.getElementById('input').value = '';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
