/**
 * Regex Tester - Regular Expression Tester
 */

function processTool() {
  const pattern = document.getElementById('input').value;
  const testString = document.getElementById('test-string').value;
  const flags = document.getElementById('flags').value;
  const output = document.getElementById('output');

  try {
    if (!pattern) {
      throw new Error('Please enter a regular expression');
    }

    const regex = new RegExp(pattern, flags);
    const matches = [];
    let match;

    if (flags.includes('g')) {
      // Global match
      while ((match = regex.exec(testString)) !== null) {
        matches.push({
          value: match[0],
          index: match.index,
          groups: match.slice(1)
        });
        // Prevent infinite loop on zero-width matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    } else {
      // Single match
      match = regex.exec(testString);
      if (match) {
        matches.push({
          value: match[0],
          index: match.index,
          groups: match.slice(1)
        });
      }
    }

    if (matches.length === 0) {
      output.value = '❌ No matches found';
      output.classList.add('error');
      output.classList.remove('success');
    } else {
      let result = `Found ${matches.length} match(es):\n\n`;
      matches.forEach((m, i) => {
        result += `Match ${i + 1}:\n`;
        result += `  Value: "${m.value}"\n`;
        result += `  Index: ${m.index}\n`;
        if (m.groups.length > 0) {
          result += `  Groups: ${m.groups.map((g, j) => `$${j + 1}="${g}"`).join(', ')}\n`;
        }
        result += '\n';
      });
      output.value = result;
      output.classList.remove('error');
      output.classList.add('success');
    }
  } catch (e) {
    output.value = '❌ Regex error: ' + e.message;
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
  document.getElementById('test-string').value = '';
  document.getElementById('flags').value = 'g';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
