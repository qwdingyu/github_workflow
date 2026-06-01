/**
 * UUID Generator - UUID v4 Generator
 */

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function processTool() {
  const countInput = document.getElementById('count');
  const output = document.getElementById('output');
  
  const count = parseInt(countInput.value, 10);

  try {
    if (count < 1 || count > 100) {
      throw new Error('Count must be between 1 and 100');
    }
    
    const uuids = [];
    for (let i = 0; i < count; i++) {
      uuids.push(generateUUID());
    }
    
    output.value = uuids.join('\n');
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ Generation failed: ' + e.message;
    output.classList.add('error');
    output.classList.remove('success');
  }
}

function copyOutput() {
  const output = document.getElementById('output');
  if (output && output.value) {
    navigator.clipboard.writeText(output.value).then(() => {
      const btn = document.querySelector('.tool-actions .btn-secondary');
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
      }
    }).catch(() => {
      // Fallback: select text for manual copy
      output.select();
    });
  }
}

function clearAll() {
  document.getElementById('count').value = 1;
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
