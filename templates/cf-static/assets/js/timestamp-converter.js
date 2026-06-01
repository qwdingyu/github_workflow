/**
 * Timestamp Converter
 */

function processTool() {
  const input = document.getElementById('input').value.trim();
  const output = document.getElementById('output');

  try {
    if (!input) {
      throw new Error('Please enter a timestamp or date');
    }

    let result;
    // Check if input is a timestamp or date string
    if (/^\d+$/.test(input)) {
      // Input is a timestamp
      const timestamp = parseInt(input);
      // Determine seconds vs milliseconds
      const date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);

      if (isNaN(date.getTime())) {
        throw new Error('Invalid timestamp');
      }

      result = `Date/Time: ${date.toLocaleString('en-US')}\n`;
      result += `ISO: ${date.toISOString()}\n`;
      result += `UTC: ${date.toUTCString()}\n`;
      result += `\nTimestamp (seconds): ${Math.floor(date.getTime() / 1000)}\n`;
      result += `Timestamp (milliseconds): ${date.getTime()}`;
    } else {
      // Input is a date string
      const date = new Date(input);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date format');
      }

      result = `Timestamp (seconds): ${Math.floor(date.getTime() / 1000)}\n`;
      result += `Timestamp (milliseconds): ${date.getTime()}\n`;
      result += `\nISO: ${date.toISOString()}\n`;
      result += `UTC: ${date.toUTCString()}`;
    }

    output.value = result;
    output.classList.remove('error');
    output.classList.add('success');
  } catch (e) {
    output.value = '❌ Conversion failed: ' + e.message;
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

// Live current timestamp display
function updateCurrentTimestamp() {
  const now = new Date();
  const el = document.getElementById('current-timestamp');
  if (el) {
    el.textContent = `Current timestamp: ${Math.floor(now.getTime() / 1000)}`;
  }
}

// Update on page load
if (document.getElementById('current-timestamp')) {
  updateCurrentTimestamp();
  setInterval(updateCurrentTimestamp, 1000);
}
