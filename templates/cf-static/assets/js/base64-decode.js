/**
 * Base64 Decoder/Encoder - Base64 编解码工具
 */

function processTool() {
  const input = document.getElementById('input').value;
  const output = document.getElementById('output');
  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'decode';
  
  try {
    let result;
    if (mode === 'decode') {
      result = decodeURIComponent(atob(input).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    } else {
      result = btoa(String.fromCharCode(...new TextEncoder().encode(input)));
    }
    output.value = result;
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ ' + (mode === 'decode' ? '解码' : '编码') + '失败: ' + e.message;
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
