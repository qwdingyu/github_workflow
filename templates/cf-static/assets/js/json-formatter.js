/**
 * JSON Formatter - Format and validate JSON data
 */

function processTool() {
  const input = document.getElementById('input').value;
  const output = document.getElementById('output');

  try {
    const parsed = JSON.parse(input);
    output.value = JSON.stringify(parsed, null, 2);
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ JSON parse error: ' + e.message;
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
  document.getElementById('input').value = '';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
