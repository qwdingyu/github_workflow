/**
 * 五险一金计算器 - 2026 版
 * 支持北京、上海、广州、深圳等主要城市
 */

// 2026 年主要城市五险一金费率数据
const CITY_DATA = {
  beijing: {
    name: '北京',
    // 缴费基数上下限（元/月）
    baseMin: 6821,
    baseMax: 35283,
    // 个人费率
    personal: {
      pension: 0.08,      // 养老保险 8%
      medical: 0.02,      // 医疗保险 2%
      unemployment: 0.005, // 失业保险 0.5%
      housing: 0.12       // 住房公积金 12%（默认最高）
    },
    // 企业费率
    company: {
      pension: 0.16,       // 养老保险 16%
      medical: 0.095,      // 医疗保险 9.5%（含生育）
      unemployment: 0.005, // 失业保险 0.5%
      injury: 0.004,       // 工伤保险 0.4%（基准费率）
      housing: 0.12        // 住房公积金 12%（默认最高）
    }
  },
  shanghai: {
    name: '上海',
    baseMin: 7310,
    baseMax: 36549,
    personal: {
      pension: 0.08,
      medical: 0.02,
      unemployment: 0.005,
      housing: 0.07       // 上海公积金 7%
    },
    company: {
      pension: 0.16,
      medical: 0.09,      // 医疗保险 9%（含生育）
      unemployment: 0.005,
      injury: 0.004,
      housing: 0.07
    }
  },
  guangzhou: {
    name: '广州',
    baseMin: 5284,
    baseMax: 26421,
    personal: {
      pension: 0.08,
      medical: 0.02,
      unemployment: 0.002, // 广州失业 0.2%
      housing: 0.12
    },
    company: {
      pension: 0.16,
      medical: 0.055,     // 广州医疗 5.5%（含生育）
      unemployment: 0.008, // 广州失业 0.8%
      injury: 0.004,
      housing: 0.12
    }
  },
  shenzhen: {
    name: '深圳',
    baseMin: 2360,
    baseMax: 34860,
    personal: {
      pension: 0.08,
      medical: 0.02,
      unemployment: 0.003, // 深圳失业 0.3%
      housing: 0.05       // 深圳公积金 5%
    },
    company: {
      pension: 0.16,
      medical: 0.05,      // 深圳医疗 5%（含生育）
      unemployment: 0.007, // 深圳失业 0.7%
      injury: 0.004,
      housing: 0.05
    }
  },
  hangzhou: {
    name: '杭州',
    baseMin: 4812,
    baseMax: 24060,
    personal: {
      pension: 0.08,
      medical: 0.02,
      unemployment: 0.005,
      housing: 0.12
    },
    company: {
      pension: 0.16,
      medical: 0.095,
      unemployment: 0.005,
      injury: 0.004,
      housing: 0.12
    }
  },
  chengdu: {
    name: '成都',
    baseMin: 4246,
    baseMax: 21228,
    personal: {
      pension: 0.08,
      medical: 0.02,
      unemployment: 0.004, // 成都失业 0.4%
      housing: 0.12
    },
    company: {
      pension: 0.16,
      medical: 0.077,     // 成都医疗 7.7%（含生育）
      unemployment: 0.006, // 成都失业 0.6%
      injury: 0.004,
      housing: 0.12
    }
  }
};

// 计算五险一金
function calculateInsurance(salary, cityKey, housingRate) {
  const city = CITY_DATA[cityKey];
  
  // 确定缴费基数（在上下限之间）
  let base = Math.max(city.baseMin, Math.min(city.baseMax, salary));
  
  // 使用自定义公积金比例
  const personalHousing = housingRate / 100;
  const companyHousing = housingRate / 100;
  
  // 个人缴费
  const personal = {
    pension: Math.round(base * city.personal.pension),
    medical: Math.round(base * city.personal.medical),
    unemployment: Math.round(base * city.personal.unemployment),
    housing: Math.round(base * personalHousing)
  };
  personal.total = personal.pension + personal.medical + personal.unemployment + personal.housing;
  
  // 企业缴费
  const company = {
    pension: Math.round(base * city.company.pension),
    medical: Math.round(base * city.company.medical),
    unemployment: Math.round(base * city.company.unemployment),
    injury: Math.round(base * city.company.injury),
    housing: Math.round(base * companyHousing)
  };
  company.total = company.pension + company.medical + company.unemployment + company.injury + company.housing;
  
  return {
    city: city.name,
    base: base,
    baseMin: city.baseMin,
    baseMax: city.baseMax,
    personal,
    company,
    totalCost: personal.total + company.total,
    netSalary: salary - personal.total
  };
}

// 渲染结果
function renderResult(result, salary) {
  const resultDiv = document.getElementById('result');
  
  resultDiv.innerHTML = `
    <div class="result-section">
      <h3>📊 基本信息</h3>
      <div class="info-grid">
        <div class="info-item">
          <span class="label">城市：</span>
          <span class="value">${result.city}</span>
        </div>
        <div class="info-item">
          <span class="label">税前工资：</span>
          <span class="value">${formatCurrency(salary)}</span>
        </div>
        <div class="info-item">
          <span class="label">缴费基数：</span>
          <span class="value">${formatCurrency(result.base)}</span>
        </div>
        <div class="info-item">
          <span class="label">基数范围：</span>
          <span class="value small">${formatCurrency(result.baseMin)} - ${formatCurrency(result.baseMax)}</span>
        </div>
      </div>
    </div>

    <div class="result-section">
      <h3>👤 个人缴费（从工资扣除）</h3>
      <table class="detail-table">
        <thead>
          <tr>
            <th>项目</th>
            <th>金额</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>养老保险（8%）</td>
            <td>${formatCurrency(result.personal.pension)}</td>
          </tr>
          <tr>
            <td>医疗保险（2%）</td>
            <td>${formatCurrency(result.personal.medical)}</td>
          </tr>
          <tr>
            <td>失业保险</td>
            <td>${formatCurrency(result.personal.unemployment)}</td>
          </tr>
          <tr>
            <td>住房公积金</td>
            <td>${formatCurrency(result.personal.housing)}</td>
          </tr>
          <tr class="total-row">
            <td><strong>个人合计</strong></td>
            <td><strong>${formatCurrency(result.personal.total)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="result-section">
      <h3>🏢 企业缴费</h3>
      <table class="detail-table">
        <thead>
          <tr>
            <th>项目</th>
            <th>金额</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>养老保险（16%）</td>
            <td>${formatCurrency(result.company.pension)}</td>
          </tr>
          <tr>
            <td>医疗保险（含生育）</td>
            <td>${formatCurrency(result.company.medical)}</td>
          </tr>
          <tr>
            <td>失业保险</td>
            <td>${formatCurrency(result.company.unemployment)}</td>
          </tr>
          <tr>
            <td>工伤保险</td>
            <td>${formatCurrency(result.company.injury)}</td>
          </tr>
          <tr>
            <td>住房公积金</td>
            <td>${formatCurrency(result.company.housing)}</td>
          </tr>
          <tr class="total-row">
            <td><strong>企业合计</strong></td>
            <td><strong>${formatCurrency(result.company.total)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="result-section summary">
      <h3>💡 汇总</h3>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="label">个人缴费</div>
          <div class="value">${formatCurrency(result.personal.total)}</div>
        </div>
        <div class="summary-item">
          <div class="label">企业缴费</div>
          <div class="value">${formatCurrency(result.company.total)}</div>
        </div>
        <div class="summary-item highlight">
          <div class="label">总用工成本</div>
          <div class="value">${formatCurrency(result.totalCost)}</div>
        </div>
        <div class="summary-item highlight">
          <div class="label">税后工资</div>
          <div class="value">${formatCurrency(result.netSalary)}</div>
        </div>
      </div>
      <p class="note">
        * 以上计算基于 2026 年费率标准，实际缴费可能因政策调整而有所变化<br>
        * 工伤保险费率根据企业行业类别有所不同，此处使用基准费率<br>
        * 本计算未包含个人所得税，如需计算请使用个税计算器
      </p>
    </div>
  `;
  
  resultDiv.style.display = 'block';
}

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
  const calculateBtn = document.getElementById('calculateBtn');
  const salaryInput = document.getElementById('salary');
  const citySelect = document.getElementById('city');
  const housingRateInput = document.getElementById('housingRate');
  
  // 填充城市选项
  Object.keys(CITY_DATA).forEach(key => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = CITY_DATA[key].name;
    citySelect.appendChild(option);
  });
  
  // 设置默认值
  citySelect.value = 'beijing';
  housingRateInput.value = '12';
  
  // 绑定计算按钮事件
  calculateBtn.addEventListener('click', function() {
    const salary = parseFloat(salaryInput.value);
    const city = citySelect.value;
    const housingRate = parseFloat(housingRateInput.value);
    
    if (isNaN(salary) || salary <= 0) {
      alert('请输入有效的工资金额');
      return;
    }
    
    if (isNaN(housingRate) || housingRate < 5 || housingRate > 12) {
      alert('公积金比例必须在 5% 到 12% 之间');
      return;
    }
    
    const result = calculateInsurance(salary, city, housingRate);
    renderResult(result, salary);
    
    // 滚动到结果区域
    document.getElementById('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  
  // 回车触发计算
  salaryInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      calculateBtn.click();
    }
  });
});
