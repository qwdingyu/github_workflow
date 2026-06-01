/**
 * URL Encoder/Decoder
 */

function processTool() {
  const input = document.getElementById('input').value;
  const output = document.getElementById('output');
  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'encode';

  try {
    let result;
    if (mode === 'encode') {
      result = encodeURIComponent(input);
    } else {
      result = decodeURIComponent(input);
    }
    output.value = result;
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ ' + (mode === 'encode' ? 'Encode' : 'Decode') + ' failed: ' + e.message;
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
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = originalText; }, 2000);
    }
  }).catch(() => {
    // Fallback: select text for manual copy
    output.select();
  });
}

function clearAll() {
  document.getElementById('input').value = '';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
