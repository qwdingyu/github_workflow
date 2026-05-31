/**
 * UUID Generator - UUID v4 生成器
 */

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function processTool() {
  const count = parseInt(document.getElementById('count')?.value) || 1;
  const output = document.getElementById('output');
  
  try {
    if (count < 1 || count > 100) {
      throw new Error('生成数量必须在 1-100 之间');
    }
    
    const uuids = [];
    for (let i = 0; i < count; i++) {
      uuids.push(generateUUID());
    }
    
    output.value = uuids.join('\n');
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ 生成失败: ' + e.message;
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
  document.getElementById('count').value = '1';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
