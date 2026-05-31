/**
 * Regex Tester - 正则表达式测试器
 */

function processTool() {
  const pattern = document.getElementById('input').value;
  const testString = document.getElementById('test-string')?.value || '';
  const output = document.getElementById('output');
  const flags = document.getElementById('flags')?.value || 'g';

  try {
    if (!pattern) {
      throw new Error('请输入正则表达式');
    }

    const regex = new RegExp(pattern, flags);
    const matches = [];
    let match;

    if (flags.includes('g')) {
      // 全局匹配
      while ((match = regex.exec(testString)) !== null) {
        matches.push({
          value: match[0],
          index: match.index,
          groups: match.slice(1)
        });
        // 防止零宽度匹配导致无限循环
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    } else {
      // 单次匹配
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
      output.value = '❌ 未找到匹配项';
      output.classList.add('error');
      output.classList.remove('success');
    } else {
      let result = `找到 ${matches.length} 个匹配:\n\n`;
      matches.forEach((m, i) => {
        result += `匹配 ${i + 1}:\n`;
        result += `  值: "${m.value}"\n`;
        result += `  位置: ${m.index}\n`;
        if (m.groups.length > 0) {
          result += `  捕获组: ${m.groups.map((g, j) => `$${j + 1}="${g}"`).join(', ')}\n`;
        }
        result += '\n';
      });
      output.value = result;
      output.classList.remove('error');
      output.classList.add('success');
    }
  } catch (e) {
    output.value = '❌ 正则表达式错误: ' + e.message;
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
    output.select();
  });
}

function clearAll() {
  document.getElementById('input').value = '';
  const testString = document.getElementById('test-string');
  if (testString) testString.value = '';
  document.getElementById('output').value = '';
  document.getElementById('output').classList.remove('error', 'success');
}
