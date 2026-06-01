/**
 * HTML Escape/Unescape
 */

function escapeHtml(str) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return str.replace(/[&<>"']/g, m => map[m]);
}

function unescapeHtml(str) {
  const map = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'"
  };
  return str.replace(/&(amp|lt|gt|quot|#39);/g, m => map[m]);
}

function processTool() {
  const input = document.getElementById('input').value;
  const output = document.getElementById('output');
  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'escape';

  try {
    if (!input) {
      throw new Error('Please enter text to process');
    }

    let result;
    if (mode === 'escape') {
      result = escapeHtml(input);
    } else {
      result = unescapeHtml(input);
    }

    output.value = result;
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ Processing failed: ' + e.message;
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
    output.select();
  });
}

function clearAll() {
  document.getElementById('input').value = '';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
