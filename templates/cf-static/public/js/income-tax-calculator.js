/**
 * 个人所得税计算器 - 2026 版
 * 支持综合所得、专项附加扣除、年终奖计算
 */

// 引入通用工具函数
// formatMoney, formatCurrency, scrollToElement, showResult, hideResult, 
// validateNumberInput, bindEnterKey, createTableRow, createHighlightRow, createTotalRow

// 2026 年综合所得个税税率表（年度）
const TAX_BRACKETS = [
  { min: 0, max: 36000, rate: 0.03, deduction: 0 },
  { min: 36000, max: 144000, rate: 0.10, deduction: 2520 },
  { min: 144000, max: 300000, rate: 0.20, deduction: 16920 },
  { min: 300000, max: 420000, rate: 0.25, deduction: 31920 },
  { min: 420000, max: 660000, rate: 0.30, deduction: 52920 },
  { min: 660000, max: 960000, rate: 0.35, deduction: 85920 },
  { min: 960000, max: Infinity, rate: 0.45, deduction: 181920 }
];

// 年终奖税率表（月度）
const BONUS_BRACKETS = [
  { min: 0, max: 3000, rate: 0.03, deduction: 0 },
  { min: 3000, max: 12000, rate: 0.10, deduction: 210 },
  { min: 12000, max: 25000, rate: 0.20, deduction: 1410 },
  { min: 25000, max: 35000, rate: 0.25, deduction: 2660 },
  { min: 35000, max: 55000, rate: 0.30, deduction: 4410 },
  { min: 55000, max: 80000, rate: 0.35, deduction: 7160 },
  { min: 80000, max: Infinity, rate: 0.45, deduction: 15160 }
];

// 专项附加扣除标准（月度）
const SPECIAL_DEDUCTIONS = {
  childrenEducation: 2000,      // 子女教育：每个子女每月 2000 元
  continuingEducation: 400,     // 继续教育：学历教育每月 400 元
  housingLoan: 1000,            // 住房贷款利息：每月 1000 元
  housingRent: 1500,            // 住房租金：每月 1500 元（大城市）
  elderlyCare: 3000             // 赡养老人：每月 3000 元
};

// 计算综合所得年度个税
function calculateAnnualTax(taxableIncome) {
  for (const bracket of TAX_BRACKETS) {
    if (taxableIncome <= bracket.max) {
      return Math.max(0, taxableIncome * bracket.rate - bracket.deduction);
    }
  }
  return 0;
}

// 计算年终奖个税（单独计税）
function calculateBonusTax(bonus) {
  const monthlyBonus = bonus / 12;
  for (const bracket of BONUS_BRACKETS) {
    if (monthlyBonus <= bracket.max) {
      return Math.max(0, bonus * bracket.rate - bracket.deduction);
    }
  }
  return 0;
}

// 计算专项附加扣除总额（月度）
function calculateSpecialDeductions(deductions) {
  let total = 0;
  if (deductions.childrenEducation) total += deductions.childrenCount * SPECIAL_DEDUCTIONS.childrenEducation;
  if (deductions.continuingEducation) total += SPECIAL_DEDUCTIONS.continuingEducation;
  if (deductions.housingLoan) total += SPECIAL_DEDUCTIONS.housingLoan;
  if (deductions.housingRent) total += SPECIAL_DEDUCTIONS.housingRent;
  if (deductions.elderlyCare) total += SPECIAL_DEDUCTIONS.elderlyCare;
  return total;
}

// 主计算函数
function calculate() {
  const monthlySalary = parseFloat(document.getElementById('monthlySalary').value) || 0;
  const socialInsurance = parseFloat(document.getElementById('socialInsurance').value) || 0;
  const bonus = parseFloat(document.getElementById('bonus').value) || 0;
  
  // 专项附加扣除
  const deductions = {
    childrenEducation: document.getElementById('childrenEducation').checked,
    childrenCount: parseInt(document.getElementById('childrenCount').value) || 1,
    continuingEducation: document.getElementById('continuingEducation').checked,
    housingLoan: document.getElementById('housingLoan').checked,
    housingRent: document.getElementById('housingRent').checked,
    elderlyCare: document.getElementById('elderlyCare').checked
  };
  
  // 住房贷款和住房租金不能同时享受
  if (deductions.housingLoan && deductions.housingRent) {
    alert('住房贷款利息和住房租金不能同时享受，请只选择其中一项');
    return;
  }
  
  const specialDeductionsMonthly = calculateSpecialDeductions(deductions);
  const basicDeduction = 5000; // 基本减除费用
  
  // 综合所得计算（不含年终奖）
  const monthlyTaxableIncome = Math.max(0, monthlySalary - basicDeduction - socialInsurance - specialDeductionsMonthly);
  const annualTaxableIncome = monthlyTaxableIncome * 12;
  const annualTax = calculateAnnualTax(annualTaxableIncome);
  const monthlyTax = annualTax / 12;
  const afterTaxSalary = monthlySalary - socialInsurance - monthlyTax;
  
  // 年终奖计算
  let bonusTaxSeparate = 0;
  let bonusTaxCombined = 0;
  let bonusAfterTaxSeparate = 0;
  let bonusAfterTaxCombined = 0;
  
  if (bonus > 0) {
    // 方式一：单独计税
    bonusTaxSeparate = calculateBonusTax(bonus);
    bonusAfterTaxSeparate = bonus - bonusTaxSeparate;
    
    // 方式二：并入综合所得
    const combinedAnnualIncome = annualTaxableIncome + bonus;
    const combinedTax = calculateAnnualTax(combinedAnnualIncome);
    bonusTaxCombined = combinedTax - annualTax;
    bonusAfterTaxCombined = bonus - bonusTaxCombined;
  }
  
  // 显示结果
  displayResults({
    monthlySalary,
    socialInsurance,
    specialDeductionsMonthly,
    monthlyTaxableIncome,
    annualTaxableIncome,
    annualTax,
    monthlyTax,
    afterTaxSalary,
    bonus,
    bonusTaxSeparate,
    bonusTaxCombined,
    bonusAfterTaxSeparate,
    bonusAfterTaxCombined
  });
}

// 显示计算结果
function displayResults(data) {
  const resultDiv = document.getElementById('result');
  
  let html = `
    <h2>📊 计算结果</h2>
    
    <div class="result-section">
      <h3>💼 综合所得（月度）</h3>
      <table class="result-table">
        <tr><td>税前月收入</td><td class="amount">¥${formatMoney(data.monthlySalary)}</td></tr>
        <tr><td>- 五险一金</td><td class="amount">-¥${formatMoney(data.socialInsurance)}</td></tr>
        <tr><td>- 专项附加扣除</td><td class="amount">-¥${formatMoney(data.specialDeductionsMonthly)}</td></tr>
        <tr><td>- 基本减除费用</td><td class="amount">-¥5,000</td></tr>
        <tr class="highlight"><td>= 月度应纳税所得额</td><td class="amount">¥${formatMoney(data.monthlyTaxableIncome)}</td></tr>
        <tr><td>- 个人所得税</td><td class="amount negative">-¥${formatMoney(data.monthlyTax)}</td></tr>
        <tr class="total"><td><strong>= 税后月收入</strong></td><td class="amount positive"><strong>¥${formatMoney(data.afterTaxSalary)}</strong></td></tr>
      </table>
    </div>
    
    <div class="result-section">
      <h3>📅 综合所得（年度）</h3>
      <table class="result-table">
        <tr><td>年度应纳税所得额</td><td class="amount">¥${formatMoney(data.annualTaxableIncome)}</td></tr>
        <tr><td>年度应缴个税</td><td class="amount">¥${formatMoney(data.annualTax)}</td></tr>
        <tr><td>实际税负率</td><td class="amount">${((data.annualTax / (data.monthlySalary * 12)) * 100).toFixed(2)}%</td></tr>
      </table>
    </div>
  `;
  
  if (data.bonus > 0) {
    html += `
      <div class="result-section">
        <h3>🎁 年终奖</h3>
        <table class="result-table">
          <tr><td>年终奖金额</td><td class="amount">¥${formatMoney(data.bonus)}</td></tr>
          <tr><td colspan="2" class="subtitle">方式一：单独计税</td></tr>
          <tr><td>应缴个税</td><td class="amount">¥${formatMoney(data.bonusTaxSeparate)}</td></tr>
          <tr class="highlight"><td>税后年终奖</td><td class="amount positive">¥${formatMoney(data.bonusAfterTaxSeparate)}</td></tr>
          <tr><td>实际税率</td><td class="amount">${((data.bonusTaxSeparate / data.bonus) * 100).toFixed(2)}%</td></tr>
          <tr><td colspan="2" class="subtitle">方式二：并入综合所得</td></tr>
          <tr><td>应缴个税</td><td class="amount">¥${formatMoney(data.bonusTaxCombined)}</td></tr>
          <tr class="highlight"><td>税后年终奖</td><td class="amount positive">¥${formatMoney(data.bonusAfterTaxCombined)}</td></tr>
          <tr><td>实际税率</td><td class="amount">${((data.bonusTaxCombined / data.bonus) * 100).toFixed(2)}%</td></tr>
        </table>
        <div class="recommendation">
          <strong>💡 建议：</strong>
          ${data.bonusTaxSeparate < data.bonusTaxCombined 
            ? '选择<strong>单独计税</strong>更划算，可节省 ¥' + formatMoney(data.bonusTaxCombined - data.bonusTaxSeparate)
            : data.bonusTaxSeparate > data.bonusTaxCombined
              ? '选择<strong>并入综合所得</strong>更划算，可节省 ¥' + formatMoney(data.bonusTaxSeparate - data.bonusTaxCombined)
              : '两种方式税负相同，可任选其一'}
        </div>
      </div>
      
      <div class="result-section">
        <h3>💰 年度总收入</h3>
        <table class="result-table">
          <tr><td>年度税前总收入</td><td class="amount">¥${formatMoney(data.monthlySalary * 12 + data.bonus)}</td></tr>
          <tr><td>年度税后总收入（最优方案）</td><td class="amount positive"><strong>¥${formatMoney(data.afterTaxSalary * 12 + Math.max(data.bonusAfterTaxSeparate, data.bonusAfterTaxCombined))}</strong></td></tr>
        </table>
      </div>
    `;
  }
  
  resultDiv.innerHTML = html;
  resultDiv.style.display = 'block';
  resultDiv.scrollIntoView({ behavior: 'smooth' });
}

// 控制子女数量输入框的显示
document.addEventListener('DOMContentLoaded', function() {
  const childrenEducationCheckbox = document.getElementById('childrenEducation');
  const childrenCountInput = document.getElementById('childrenCount');
  const childrenCountGroup = childrenCountInput.parentElement;
  
  childrenCountGroup.style.display = childrenEducationCheckbox.checked ? 'block' : 'none';
  
  childrenEducationCheckbox.addEventListener('change', function() {
    childrenCountGroup.style.display = this.checked ? 'block' : 'none';
  });
  
  // 绑定计算按钮
  document.getElementById('calculateBtn').addEventListener('click', calculate);
});
