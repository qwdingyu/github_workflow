---
name: build-domain-specific-tools
description: Create domain-specific tools (calculators, converters) using JSON config + JS implementation + shared utils pattern for rapid tool development
source: auto-skill
extracted_at: '2026-05-30T13:13:55.666Z'
---

# Build Domain-Specific Tools with JSON Config + JS Implementation

When building a static site with multiple domain-specific tools (calculators, converters, formatters), use the **JSON config + JS implementation + shared utils** pattern for rapid, maintainable tool development.

## When to Use

- Building a static site with 5+ domain-specific tools
- Tools have similar structure (input → calculation → output)
- Tools need localization (multiple languages)
- Want to avoid code duplication across tools
- Need to add new tools rapidly

## The Three-File Pattern

Each tool consists of exactly 3 files:

```
src/tools/
├── tool-name.json          # Configuration (metadata, FAQ, form fields)
├── tool-name.js            # Implementation (calculation logic)
└── utils.js                # Shared utilities (formatting, UI helpers)
```

## File 1: JSON Configuration (tool-name.json)

Contains all metadata and user-facing content:

```json
{
  "slug": "income-tax-calculator",
  "title": "个税计算器（2026 版）",
  "description": "计算个人所得税，支持综合所得和年终奖计算",
  "category": "财务计算器",
  "icon": "🧮",
  "keywords": ["个税计算", "个人所得税", "年终奖"],
  "faq": [
    {
      "question": "年终奖如何计算个税？",
      "answer": "年终奖可以选择单独计税或并入综合所得计税..."
    }
  ],
  "fields": [
    {
      "id": "monthlySalary",
      "label": "税前月薪（元）",
      "type": "number",
      "placeholder": "例如：20000",
      "required": true
    },
    {
      "id": "bonus",
      "label": "年终奖（元）",
      "type": "number",
      "placeholder": "例如：50000",
      "required": false
    }
  ]
}
```

**Key principles:**
- All user-facing strings in JSON (easy to localize)
- Form field definitions declarative (not in JS)
- FAQ content in JSON (rendered by build script)
- Category determines which tools share utils.js

## File 2: JS Implementation (tool-name.js)

Contains only calculation logic, no UI code:

```javascript
// Import shared utilities
// Assumes utils.js is loaded globally by build script

// Domain-specific constants (2026 tax rates)
const TAX_BRACKETS = [
  { min: 0, max: 36000, rate: 0.03, deduction: 0 },
  { min: 36000, max: 144000, rate: 0.10, deduction: 2520 },
  // ...
];

// Domain-specific calculation function
function calculate() {
  const monthlySalary = parseFloat(document.getElementById('monthlySalary').value) || 0;
  const bonus = parseFloat(document.getElementById('bonus').value) || 0;
  
  // Perform calculation
  const annualIncome = monthlySalary * 12;
  const tax = calculateTax(annualIncome);
  
  // Display results using shared utilities
  displayResults({
    annualIncome: formatCurrency(annualIncome),
    tax: formatCurrency(tax),
    afterTax: formatCurrency(annualIncome - tax)
  });
}

// Domain-specific helper functions
function calculateTax(income) {
  for (const bracket of TAX_BRACKETS) {
    if (income <= bracket.max) {
      return income * bracket.rate - bracket.deduction;
    }
  }
  return 0;
}

// Bind to UI
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('calculateBtn').addEventListener('click', calculate);
});
```

**Key principles:**
- Only calculation logic, no UI boilerplate
- Use shared utilities from utils.js (formatCurrency, displayResults, etc.)
- Domain-specific constants as module-level constants
- Bind to UI only in DOMContentLoaded

## File 3: Shared Utilities (utils.js)

Contains reusable functions across all tools:

```javascript
/**
 * Shared utilities for all tools
 */

// Currency formatting
function formatCurrency(amount, decimals = 2) {
  return '¥' + amount.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Display results in a table
function displayResults(data) {
  const resultDiv = document.getElementById('result');
  let html = '<div class="result-section"><table class="result-table">';
  
  for (const [key, value] of Object.entries(data)) {
    html += `<tr><td>${key}</td><td class="amount">${value}</td></tr>`;
  }
  
  html += '</table></div>';
  resultDiv.innerHTML = html;
  resultDiv.style.display = 'block';
  resultDiv.scrollIntoView({ behavior: 'smooth' });
}

// Validate number input
function validateNumberInput(inputId, errorMessage) {
  const input = document.getElementById(inputId);
  const value = parseFloat(input.value);
  
  if (isNaN(value) || value <= 0) {
    alert(errorMessage);
    input.focus();
    return null;
  }
  
  return value;
}

// Create table row helper
function createTableRow(label, value) {
  return `<tr><td>${label}</td><td class="amount">${value}</td></tr>`;
}

// Create highlighted row helper
function createHighlightRow(label, value) {
  return `<tr class="highlight"><td><strong>${label}</strong></td><td class="amount positive"><strong>${value}</strong></td></tr>`;
}
```

**Key principles:**
- Only functions used by 2+ tools
- Formatting, validation, UI helpers
- No business logic
- Well-documented with JSDoc comments

## Build Script Integration

The build script (`generate-seo-pages.mjs`) must:

1. **Detect tool category** from JSON config
2. **Auto-include utils.js** for tools that need it
3. **Render form fields** from JSON config
4. **Generate tool pages** with proper script includes

```javascript
function generateToolContent(tool) {
  // Check if tool needs utils.js (financial calculators do)
  const needsUtils = tool.category === '财务计算器';
  const utilsScript = needsUtils ? '\n    <script src="/js/utils.js"></script>' : '';
  
  // Render form fields from JSON config
  const formFields = tool.fields.map(field => {
    const required = field.required ? 'required' : '';
    return `
      <div class="form-group">
        <label for="${field.id}">${field.label}</label>
        <input type="${field.type}" id="${field.id}" 
               placeholder="${field.placeholder}" ${required}>
      </div>
    `;
  }).join('\n');
  
  return `
    <div class="tool-container">
      ${formFields}
      <button id="calculateBtn" class="btn-primary">计算</button>
      <div id="result" style="display: none;"></div>
    </div>
    <script src="/js/${tool.slug}.js"></script>${utilsScript}
  `;
}
```

## Localization Strategy

When localizing tools:

1. **JSON config** - Translate all user-facing strings
2. **JS implementation** - Only translate error messages and UI text
3. **utils.js** - Update currency symbol and locale-specific formatting
4. **Domain-specific data** - Use localized data (e.g., 2026 Chinese tax rates)

**Example: Chinese localization**

```json
{
  "title": "个税计算器（2026 版）",
  "fields": [
    {
      "label": "税前月薪（元）",
      "placeholder": "例如：20000"
    }
  ],
  "faq": [
    {
      "question": "年终奖如何计算个税？",
      "answer": "年终奖可以选择单独计税或并入综合所得计税..."
    }
  ]
}
```

```javascript
// utils.js - Chinese currency formatting
function formatCurrency(amount, decimals = 2) {
  return '¥' + amount.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
```

## Domain-Specific Data Examples

### Chinese Social Insurance (五险一金) - 2026

```javascript
const CITY_DATA = {
  beijing: {
    name: '北京',
    baseMin: 6326,
    baseMax: 33891,
    personal: {
      pension: 0.08,
      medical: 0.02,
      unemployment: 0.005,
      housing: 0.12
    },
    company: {
      pension: 0.16,
      medical: 0.098,
      unemployment: 0.005,
      injury: 0.002,
      maternity: 0.008,
      housing: 0.12
    }
  },
  // ... other cities
};
```

### Chinese Income Tax Brackets - 2026

```javascript
const TAX_BRACKETS = [
  { min: 0, max: 36000, rate: 0.03, deduction: 0 },
  { min: 36000, max: 144000, rate: 0.10, deduction: 2520 },
  { min: 144000, max: 300000, rate: 0.20, deduction: 16920 },
  { min: 300000, max: 420000, rate: 0.25, deduction: 31920 },
  { min: 420000, max: 660000, rate: 0.30, deduction: 52920 },
  { min: 660000, max: 960000, rate: 0.35, deduction: 85920 },
  { min: 960000, max: Infinity, rate: 0.45, deduction: 181920 }
];

const SPECIAL_DEDUCTIONS = {
  childEducation: 2000,      // 每个子女每月 2000 元
  continuingEducation: 400,  // 学历教育每月 400 元
  housingLoan: 1000,         // 住房贷款每月 1000 元
  housingRent: 1500,         // 住房租金每月 1500 元（大城市）
  elderlySupport: 3000       // 赡养老人每月 3000 元
};
```

## Verification Checklist

After creating a new tool:

```bash
# 1. JSON config is valid
node -e "JSON.parse(require('fs').readFileSync('src/tools/tool-name.json','utf8'))"

# 2. JS has no syntax errors
node --check src/tools/tool-name.js

# 3. Build succeeds
node scripts/generate-seo-pages.mjs

# 4. Tool page is generated
ls public/tools/tool-name.html

# 5. Tool page includes correct scripts
grep -E 'tool-name.js|utils.js' public/tools/tool-name.html

# 6. Tool page has correct metadata
grep -E '<title>|<meta name="description"' public/tools/tool-name.html

# 7. Tool page has FAQ
grep -c 'FAQPage' public/tools/tool-name.html

# 8. Tool page has breadcrumb
grep -c 'BreadcrumbList' public/tools/tool-name.html

# 9. Tool page has related tools
grep -c 'related-tools' public/tools/tool-name.html

# 10. HTTP test
curl -s http://localhost:8787/public/tools/tool-name.html | grep -o '<title>.*</title>'
```

## Key Lessons Learned

1. **Separation of concerns** - JSON for config, JS for logic, utils for shared code
2. **Build script intelligence** - Detect tool category and auto-include utils.js
3. **Declarative form fields** - Define in JSON, render in build script
4. **Domain-specific data as constants** - Tax rates, city data as module-level constants
5. **Localization in JSON** - All user-facing strings in JSON for easy translation
6. **Shared utilities** - Only functions used by 2+ tools go in utils.js
7. **Category-based utils inclusion** - Build script includes utils.js based on tool category
8. **Domain expertise required** - Financial calculators need accurate 2026 tax data
9. **No UI code in JS** - Only calculation logic, UI rendered by build script
10. **Well-documented utilities** - JSDoc comments for all shared functions

## Anti-Patterns to Avoid

1. **Don't put UI code in JS** - Render forms in build script from JSON config
2. **Don't duplicate utilities** - If a function is used by 2+ tools, move to utils.js
3. **Don't hardcode domain data in JSON** - Keep in JS as constants (easier to update)
4. **Don't translate in JS** - All user-facing strings in JSON config
5. **Don't auto-include utils.js for all tools** - Only include for tools that need it
6. **Don't put business logic in utils.js** - Only shared formatting/validation helpers

## References

- Example tool: `templates/cf-static/src/tools/income-tax-calculator.json`
- Example implementation: `templates/cf-static/src/tools/income-tax-calculator.js`
- Shared utilities: `templates/cf-static/src/tools/utils.js`
- Build script: `templates/cf-static/scripts/generate-seo-pages.mjs`
- Generated page: `templates/cf-static/public/tools/income-tax-calculator.html`
- Related skills: `create-product-template` (template creation), `localize-static-site` (localization), `seo-geo-hardening` (SEO optimization)
