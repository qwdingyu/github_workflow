# 数控报价系统 — 公式→JSON Schema抽象分析

> 日期：2026-06-03
> 范围：mach-formulas 9个公式模块的JSON Schema抽象可行性分析
> 前置文档：
> - arch/008 — JSON Schema闭环可行性
> - arch/010 — 表单设计器决策记录（否决自建设计器）
> - mach-formulas 9个公式模块源码及114个测试用例

---

## 一、项目定位与目标

### 1.1 核心目标

将10个数控报价Excel文件中的计算公式转换为TypeScript函数，并通过**前端动态表单**实现Web产品，用于"AI辅助设计系统"的引流推广。

### 1.2 关键决策回顾

1. ✅ **测试驱动开发**：公式真实性优先，114个测试用例验证
2. ✅ **前后端分离**：前期网站模式，后期上小程序
3. ✅ **复用cf-calculators模板**：Eleventy+Nunjucks+原生JS
4. ✅ **不自建设计器**：使用现有工具辅助

---

## 二、现有表单模式 vs 计算器模式对比

### 2.1 cf-form 表单模式（数据采集型）

**定位**：用户填写表单 → 提交到后端 → 存储到数据库

**数据流**：
```
用户填写 → JSON Schema定义 → 动态渲染表单 → 提交到API → 数据库存储
```

**字段类型**：text/email/textarea/select/radio/checkbox/number/date/hidden/divider/heading（12种）

**核心特征**：
- 表单字段是**输入导向**的
- 验证规则简单（必填/长度/正则）
- 无复杂计算逻辑
- 数据持久化（DB存储）

### 2.2 cf-calculators 计算器模式（计算导向型）

**定位**：用户填写参数 → 前端JS计算 → 实时显示结果

**数据流**：
```
用户填写参数 → 原生JS计算函数 → DOM渲染结果 → 无需后端
```

**核心特征**：
- 表单字段是**参数输入**的
- 计算逻辑复杂（查表/条件分支/多步计算）
- 结果实时展示
- 无需后端存储

### 2.3 两种模式的差异

| 维度 | cf-form（表单） | cf-calculators（计算器） |
|------|-----------------|--------------------------|
| **目的** | 数据采集 | 计算求解 |
| **计算** | 无/简单验证 | 复杂公式/查表/多步 |
| **后端** | 必须（存储） | 可选（可纯前端） |
| **JSON Schema** | 适合（定义字段结构） | **部分适合**（需扩展） |
| **动态渲染** | 100%动态 | 80%动态+20%特殊 |
| **结果展示** | 提交成功消息 | 复杂表格/图表/明细 |
| **数据持久化** | DB存储 | 无需存储 |

---

## 三、9个公式模块的输入输出模式分析

### 3.1 模块分类

根据输入输出模式，9个模块可分为**4类**：

| 类别 | 模块 | 特征 | JSON Schema可行性 |
|------|------|------|-------------------|
| **A. 简单输入-输出** | comprehensive-quote, price-standard, turning-formulas | 输入参数少（3-8个），输出直接 | ✅ 完全可行 |
| **B. 列表输入型** | comprehensive-cost, process-time, batch-cost | 输入包含可重复列表（工序/ treatments） | ⚠️ 需扩展 |
| **C. 复杂多步型** | milling-time, cutting-params | 多步计算+查表+8种车削 | ⚠️ 需扩展 |
| **D. 纯工具函数** | math-utils | 无UI交互 | ❌ 无需抽象 |

### 3.2 各类别详细分析

#### A类：简单输入-输出

**comprehensive-quote.ts**（综合报价+乘数体系）

```typescript
// 输入：8个参数（6个enum + 2个number + 2个可选）
interface QuoteParams {
  processingFee: number;        // 加工费
  materialFee: number;          // 材料费
  complexity: 'simple' | 'medium' | 'complex' | 'ultra_complex';  // 复杂程度
  precision: 'general' | 'medium' | 'high' | 'ultra_high';        // 精度等级
  surface: 'general' | 'medium' | 'fine' | 'ultra_fine' | 'mirror'; // 表面粗糙度
  batchSize: number;            // 批量
  profitMargin?: number;        // 利润率
  taxRate?: number;             // 税率
}

// 输出：6个字段
interface QuoteResult {
  processingFee: number;
  materialFee: number;
  subTotal: number;
  compositeFactor: number;      // 综合乘数
  adjustedFee: number;
  finalQuote: number;           // 最终报价
}
```

**JSON Schema可行性评估**：⭐⭐⭐⭐⭐（完全可行）
- 所有字段都是简单类型（number/enum）
- 枚举值可映射为 select/radio
- 输出结果结构简单

**price-standard.ts**（线割/放电价格标准）

```typescript
// 输入：6-8个参数（依赖加工方式）
interface WireCutParams {
  type: 'slow_wire' | 'fast_wire' | 'eds';  // 加工方式
  area?: number;          // 割肉面积 mm²
  holeCount?: number;     // 割孔数量
  angle?: number;         // 斜度 °
  thickness?: number;     // 厚度 mm
  // ... 更多参数
}
```

**JSON Schema可行性评估**：⭐⭐⭐⭐（部分可行）
- 需要根据type显示不同参数
- 条件字段需要schema扩展

#### B类：列表输入型

**comprehensive-cost.ts**（综合成本分析）

```typescript
// 输入：包含可重复列表
interface CostParams {
  materialFee: number;                    // 材料费
  processingTasks: ProcessingTask[];      // 加工任务列表（可重复）
  surfaceTreatments: SurfaceTreatment[];  // 表面处理列表（可重复）
  // ... 其他参数
}

interface ProcessingTask {
  equipment: 'lathe' | 'milling' | 'cnc_lathe' | ...; // 17种设备
  hours: number;                                       // 工时
}

interface SurfaceTreatment {
  treatment: 'quenching' | 'anodizing' | ...;  // 10种处理
  weight: number;                                // 重量
}
```

**JSON Schema可行性评估**：⭐⭐⭐（需扩展）
- 需要支持**可重复字段组**（repeating groups）
- 列表项有独立的输入结构
- cf-form 当前不支持此模式

**process-time.ts**（加工流程工时）

```typescript
// 输入：工序列表（可重复）
interface ProcessParams {
  processes: ProcessInfo[];  // 工序列表，每项13个字段
}

interface ProcessInfo {
  sequence: number;
  processType: enum;       // 18种工序类型
  toolType: enum;          // 30+种刀具类型
  speed: number;
  feedPerRev: number;
  cuttingLength: number;
  // ... 更多字段
}
```

**JSON Schema可行性评估**：⭐⭐⭐（需扩展）
- 需要列表输入+动态添加/删除行
- 每个列表项有复杂的字段结构

#### C类：复杂多步型

**milling-time.ts**（铣削工时八步法）

```typescript
// 输入：8个基础参数 + 批量参数
interface MillingParams {
  cuttingWidth: number;
  cuttingDepth: number;
  workpieceLength: number;
  feedPerTooth: number;
  cutterDiameter: number;
  cuttingSpeed: number;
  cutterTeeth: number;
  batchCount: number;
  complexity: 'simple' | 'medium' | 'complex';
}

// 输出：9个字段（八步法中间结果）
interface MillingResult {
  basicTime: number;
  auxiliaryTime: number;
  operationTime: number;
  loadingTime: number;
  operationWorkTime: number;
  wideRelaxation: number;
  singlePieceTime: number;
  setupTime: number;
  batchTime: number;
}
```

**JSON Schema可行性评估**：⭐⭐⭐（需扩展）
- 输入参数可映射为普通表单字段
- 但输出需要**分步展示**（八步法流程）
- 查表逻辑（辅助时间/装卸时间）需要展示查表结果

**cutting-params.ts**（切削参数推荐数据库）

```typescript
// 6种查询函数，每种输入2-4个参数
getTurningParams(material, ap);
getHSS_RoughMillingFz(power, rigidity, cutterType, material);
getMillingSpeed(material, hardness?);
getDrillingParams(material, diameter);
getHSSReamerParams(diameter, material);
getCarbideReamerParams(diameter, material, tensileStrength?);
getBoringParams(stage, toolMat, material);
getGrindingAllowance(diameter, length, heatTreated, stage);
calculateTheoreticalTime(input, difficultyFactor);
```

**JSON Schema可行性评估**：⭐⭐（部分可行）
- 查表逻辑无法用schema描述
- 输入输出可映射为表单，但结果展示需要特殊处理

#### D类：纯工具函数

**math-utils.ts** — PI常量、圆面积/周长计算，无需独立UI，作为其他模块的辅助函数。

---

## 四、cf-form JSON Schema 扩展方案

### 4.1 现有cf-form schema的局限

cf-form 的字段定义仅支持**单行/单选/多选**输入，无法满足计算器的需求：

```json
// cf-form 现有格式
{ "type": "number", "key": "diameter", "label": "直径", "required": true }
```

**缺失能力**：
1. ❌ 可重复字段组（列表输入）
2. ❌ 条件字段（根据其他字段值显示/隐藏）
3. ❌ 计算字段（自动计算，不手动输入）
4. ❌ 分步展示（多步骤向导）
5. ❌ 结果展示（表格/图表/明细）

### 4.2 扩展方案对比

#### 方案A：扩展cf-form schema（推荐⭐⭐⭐⭐⭐）

在现有cf-form schema基础上增加**计算器专用字段类型**：

```json
{
  "type": "calculator",
  "key": "milling-calculator",
  "title": "铣削工时计算",
  "description": "铣削加工工时八步法定额计算",
  "fields": [
    // 普通输入字段
    { "type": "number", "key": "cuttingWidth", "label": "铣削宽度(Ac)", "unit": "mm", "required": true },
    { "type": "number", "key": "cuttingDepth", "label": "铣削深度(Ap)", "unit": "mm", "required": true },
    // ... 更多字段
    
    // 扩展：计算字段（只读结果）
    { "type": "computed", "key": "basicTime", "label": "基本时间", "formula": "calculateBasicTime(params)" },
    { "type": "computed", "key": "singlePieceTime", "label": "单件时间" },
    
    // 扩展：结果表格
    { 
      "type": "result-table", 
      "key": "summary", 
      "label": "工时汇总",
      "columns": [
        { "key": "step", "label": "步骤" },
        { "key": "time", "label": "时间(min)", "format": "number" }
      ]
    }
  ],
  "calculate": {
    "module": "@eforge/mach-formulas",
    "function": "calculateMillingTime",
    "params": ["cuttingWidth", "cuttingDepth", "workpieceLength", ...]
  }
}
```

**新增字段类型**：

| 新类型 | 用途 | 对应HTML |
|--------|------|----------|
| `computed` | 自动计算的只读字段 | `<input readonly>` 或 `<div>` |
| `result-table` | 结果明细表格 | `<table>` |
| `repeating-group` | 可重复字段组 | 动态添加/删除行 |
| `condition-group` | 条件字段组 | 根据条件显示/隐藏 |

**扩展的表单配置**：

```json
{
  "calculator": {
    "modules": ["@eforge/mach-formulas"],
    "defaultValues": {},
    "autoCalculate": true,
    "resultLayout": "table"  // table | list | chart
  }
}
```

**优点**：
- 复用cf-form现有渲染引擎
- 扩展向后兼容
- 统一的schema体系

**缺点**：
- 需要修改cf-form渲染器
- 需要定义新的字段类型

#### 方案B：为计算器创建独立schema格式（推荐⭐⭐⭐⭐）

不扩展cf-form，而是为计算器创建**独立的schema格式**：

```json
{
  "id": "milling-time-calculator",
  "title": "铣削工时计算",
  "description": "铣削加工工时八步法定额计算",
  "category": "数控加工",
  "icon": "⚙️",
  "version": "1.0.0",
  
  // 公式来源
  "formula": {
    "module": "@eforge/mach-formulas",
    "function": "calculateMillingTime",
    "source": "文件7《铣削工时制定参照表》"
  },
  
  // 输入参数定义
  "inputs": [
    {
      "key": "cuttingWidth",
      "label": "铣削宽度(Ac)",
      "type": "number",
      "unit": "mm",
      "required": true,
      "min": 0,
      "max": 1000,
      "step": 0.1,
      "placeholder": "请输入铣削宽度",
      "helpText": "铣削时刀具与工件的横向间距"
    },
    {
      "key": "cuttingDepth",
      "label": "铣削深度(Ap)",
      "type": "number",
      "unit": "mm",
      "required": true,
      "min": 0,
      "max": 200,
      "step": 0.1
    },
    // 枚举类型
    {
      "key": "material",
      "label": "工件材料",
      "type": "select",
      "options": [
        { "label": "碳素钢", "value": "carbon_steel" },
        { "label": "不锈钢", "value": "stainless_steel" },
        // ...
      ],
      "required": true
    }
  ],
  
  // 输出定义
  "outputs": [
    {
      "key": "basicTime",
      "label": "基本时间",
      "unit": "min",
      "description": "纯切削时间"
    },
    {
      "key": "singlePieceTime",
      "label": "单件时间",
      "unit": "min",
      "description": "含宽放时间的单件工时"
    },
    // 输出表格
    {
      "key": "summary",
      "label": "工时汇总",
      "type": "table",
      "columns": [
        { "key": "step", "label": "步骤", "width": "120px" },
        { "key": "value", "label": "时间(min)", "format": "number", "decimal": 2 },
        { "key": "description", "label": "说明" }
      ]
    }
  ],
  
  // 计算配置
  "calculation": {
    "autoCalculate": true,  // 自动计算 or 手动按钮
    "showSteps": true,      // 展示中间步骤
    "resultSection": "below" // 结果位置：below | modal | tab
  }
}
```

**计算器渲染器**（新的前端引擎）：

```javascript
// calculator-renderer.js
class CalculatorRenderer {
  constructor(schema, formulaModule) {
    this.schema = schema;
    this.formula = formulaModule[schema.formula.function];
  }
  
  renderInputs(container) {
    // 根据inputs定义渲染输入表单
    for (const input of this.schema.inputs) {
      const el = this.createInput(input);
      container.appendChild(el);
    }
  }
  
  renderOutputs(container, result) {
    // 根据outputs定义渲染结果
    for (const output of this.schema.outputs) {
      const el = this.createOutput(output, result);
      container.appendChild(el);
    }
  }
  
  calculate() {
    // 收集输入 → 调用公式 → 渲染结果
    const params = this.collectInputs();
    const result = this.formula(params);
    this.renderOutputs(this.outputsContainer, result);
  }
}
```

**优点**：
- 不修改cf-form，完全独立
- schema格式更丰富（支持单位/帮助文本/公式来源）
- 计算器专用优化（自动计算/分步展示）
- 与cf-form保持职责分离

**缺点**：
- 需要开发新的渲染器
- 两套schema体系需要维护

### 4.3 推荐方案：混合方案（方案B为主）⭐⭐⭐⭐⭐

**核心思路**：

1. **不扩展cf-form** — cf-form继续专注于数据采集场景
2. **创建独立的calculator schema格式** — 专为计算器场景设计
3. **复用cf-form的输入字段类型** — number/select/radio等定义保持一致
4. **新增计算器专用类型** — computed/result-table/repeating-group
5. **复用cf-calculators的渲染模式** — Eleventy+Nunjucks+JS

**具体实施**：

```
mach-formulas (TS公式库)
    ↓
calculator-schema (JSON定义)
    ↓
calculator-renderer.js (动态渲染器)
    ↓
cf-calculators模板 (Eleventy页面)
    ↓
用户浏览器 (计算+展示)
```

---

## 五、可行性评估

### 5.1 技术可行性

| 维度 | 评估 | 说明 |
|------|------|------|
| **公式抽象为schema** | ✅ 完全可行 | 9个模块的输入输出结构清晰 |
| **schema定义输入字段** | ✅ 完全可行 | 映射为number/select/radio等 |
| **schema定义输出格式** | ✅ 完全可行 | 映射为computed/result-table |
| **动态渲染输入表单** | ✅ 完全可行 | 复用cf-form渲染逻辑 |
| **动态渲染结果** | ⚠️ 需开发 | 需要新的渲染器 |
| **列表输入（可重复）** | ⚠️ 需开发 | repeating-group类型 |
| **条件字段** | ⚠️ 需开发 | 根据type显示不同参数 |
| **公式模块动态加载** | ✅ 完全可行 | ES模块import |
| **自动计算** | ✅ 完全可行 | 输入变更时触发计算 |

### 5.2 工作量估算

| 任务 | 工作量 | 难度 |
|------|:------:|:----:|
| 定义calculator schema格式 | ~200行 | 🟢 低 |
| 开发calculator-renderer.js | ~800行 | 🟡 中 |
| 为9个模块编写schema定义 | ~500行 | 🟢 低（模板化） |
| 集成到cf-calculators模板 | ~100行 | 🟢 低 |
| 单元测试 | ~300行 | 🟡 中 |
| **总计** | **~1900行** | **中** |

### 5.3 时间估算

| 阶段 | 时间 |
|------|------|
| schema格式定义 + 测试 | 0.5天 |
| calculator-renderer核心逻辑 | 1.5天 |
| 9个模块schema编写 | 1天 |
| 集成+联调+测试 | 1天 |
| **总计** | **~4天** |

---

## 六、推荐实施路径

### 6.1 阶段划分

#### Phase 1: 基础schema + 简单计算器（P0，1.5天）

**目标**：跑通最小闭环，实现1-2个简单计算器

**包含**：
1. 定义calculator schema格式（JSON）
2. 开发calculator-renderer.js核心渲染器
   - 渲染inputs（number/select/radio）
   - 渲染outputs（computed fields）
   - 公式调用+结果展示
3. 为**comprehensive-quote**（综合报价）创建schema
4. 集成到cf-calculators模板
5. 测试通过

**产出**：
- `packages/mach-calculators/src/schema/calculator-schema.ts`（schema定义+TS类型）
- `packages/mach-calculators/src/renderer/calculator-renderer.js`（渲染引擎）
- `templates/cf-calculators/src/_data/mach-calculators.json`（9个计算器配置）
- `templates/cf-calculators/assets/js/calculator-renderer.js`（前端渲染器）

#### Phase 2: 完整支持 + 全部模块（P1，2天）

**目标**：9个模块全部接入

**包含**：
1. 为剩余8个模块创建schema定义
2. 支持repeating-group（列表输入）
3. 支持条件字段（根据type显示不同参数）
4. 支持result-table（结果明细表格）
5. 单元测试覆盖

#### Phase 3: 优化+UI增强（P2，1.5天）

**目标**：用户体验优化

**包含**：
1. 分步向导（多步骤表单）
2. 结果可视化（图表）
3. 计算历史/书签
4. 打印/PDF导出

### 6.2 文件结构

```
mach-calculators/                    # 新包（计算器系统）
├── package.json
├── src/
│   ├── schema/                      # JSON Schema定义
│   │   ├── calculator-schema.ts     # schema类型定义
│   │   ├── comprehensive-quote.json.ts  # 综合报价schema
│   │   ├── milling-time.json.ts     # 铣削工时schema
│   │   └── ... (其他7个)
│   ├── renderer/                    # 渲染器
│   │   ├── calculator-renderer.ts   # 主渲染器
│   │   ├── input-renderer.ts        # 输入字段渲染
│   │   ├── output-renderer.ts       # 输出字段渲染
│   │   └── repeating-group.ts       # 列表输入
│   ├── formulas/                    # 公式适配器
│   │   ├── adapter.ts               # 统一公式调用接口
│   │   └── ... (各模块适配器)
│   └── index.ts                     # 统一导出
├── tests/
│   ├── calculator-renderer.test.ts
│   └── schema-validation.test.ts
└── dist/
```

```
templates/cf-calculators/            # 前端模板
├── src/_data/
│   └── mach-calculators.json        # 9个计算器配置
├── assets/js/
│   ├── calculator-renderer.js       # 前端渲染器
│   └── utils.js
├── src/_includes/
│   └── calculator.njk              # 计算器页面模板
└── src/tools/
    └── mach-comprehensive-quote.njk
    └── mach-milling-time.njk
    └── ... (其他7个)
```

---

## 七、与现有知识库的关系

### 7.1 遵循的架构决策

1. ✅ **cf-form JSON Schema闭环可行性**（arch/008）— 采用独立schema格式，不扩展cf-form
2. ✅ **表单设计器决策记录**（arch/010）— 不自建设计器，使用JSON编辑
3. ✅ **cf-calculators模板模式** - 复用Eleventy+Nunjucks+原生JS
4. ✅ **cf-core基础设施隔离** - mach-calculators独立于cf-core

### 7.2 复用现有代码

| 现有代码 | 复用方式 |
|---------|---------|
| cf-form的input渲染逻辑 | 提取为共享的InputRenderer |
| cf-calculators的tools.json | 扩展为mach-calculators.json |
| mach-formulas公式库 | 直接import使用 |
| cf-calculators的base.njk布局 | 复用整体页面布局 |

### 7.3 避免的陷阱

1. ❌ **不修改cf-form内部格式** — cf-form保持原有定位
2. ❌ **不自建设计器** — 用JSON文件+编辑器
3. ❌ **不引入前端框架** — 纯vanilla JS
4. ❌ **不与cf-core耦合** — mach-calculators独立包

---

## 八、风险评估

| 风险 | 严重度 | 缓解措施 |
|------|:------:|---------|
| schema格式设计反复修改 | 🟡 中 | Phase 1先出最小闭环，再迭代 |
| calculator-renderer开发复杂度超预期 | 🟡 中 | 先支持简单类型，列表/条件推迟到Phase 2 |
| 9个模块schema编写工作量大 | 🟢 低 | 模板化，批量生成 |
| 与cf-calculators集成问题 | 🟢 低 | 复用现有模板模式 |

---

## 九、总结与建议

### 9.1 核心结论

| 问题 | 结论 |
|------|------|
| **JSON Schema抽象可行吗？** | ✅ 完全可行，9个模块均可抽象 |
| **能复用cf-form的schema吗？** | ⚠️ 部分复用，需扩展计算器专用类型 |
| **是否需要自建设计器？** | ❌ 不需要，遵循arch/010决策 |
| **与现有知识库冲突吗？** | ❌ 不冲突，复用现有模式 |
| **工作量可控吗？** | ✅ 可控，约4天，1900行代码 |
| **推荐方案是什么？** | ✅ 独立calculator schema格式 + 渲染器 |

### 9.2 实施建议

**立即执行**：
1. Phase 1：comprehensive-quote计算器跑通最小闭环
2. 验证calculator schema格式的可行性
3. 验证calculator-renderer.js的渲染能力

**Phase 1成功后**：
4. 批量生成剩余8个模块的schema
5. 集成到cf-calculators模板
6. 测试+优化

**Phase 2（如有需要）**：
7. 支持列表输入/条件字段
8. 支持分步向导/结果可视化

### 9.3 关键原则

1. **测试驱动** — 每个schema必须有对应的测试用例
2. **渐进增强** — Phase 1支持简单类型，Phase 2支持复杂类型
3. **复用优先** — 复用cf-form渲染逻辑、cf-calculators模板
4. **职责分离** — cf-form专注数据采集，mach-calculators专注计算

### 9.4 最终架构图

```
┌─────────────────────────────────────────────┐
│              用户浏览器                       │
│  ┌───────────────────────────────────────┐  │
│  │  calculator-renderer.js               │  │
│  │  ├─ 渲染inputs (number/select/radio)  │  │
│  │  ├─ 监听输入变更                      │  │
│  │  ├─ 调用公式函数                      │  │
│  │  └─ 渲染outputs (computed/table)      │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
                    ↓ import
┌─────────────────────────────────────────────┐
│  mach-formulas (TS公式库)                   │
│  ├─ comprehensive-quote.ts                  │  │
│  ├─ milling-time.ts                         │  │
│  ├─ turning-formulas.ts                     │  │
│  └─ ... (其他6个)                           │  │
└─────────────────────────────────────────────┘
                    ↑ 配置
┌─────────────────────────────────────────────┐
│  mach-calculators (计算器系统)               │
│  ├─ calculator-schema.json (9个定义)        │  │
│  └─ formula-adapter.ts (统一调用接口)       │  │
└─────────────────────────────────────────────┘
                    ↓ 构建
┌─────────────────────────────────────────────┐
│  cf-calculators模板 (Eleventy)              │
│  ├─ tools.njk (页面模板)                    │  │
│  ├─ base.njk (布局模板)                     │  │
│  └─ mach-calculators.json (工具列表)        │  │
└─────────────────────────────────────────────┘
```

---

## 十、附录：9个模块的schema映射表

| 模块 | 输入字段数 | 输出字段数 | 主要类型 | 特殊需求 |
|------|-----------|-----------|---------|---------|
| comprehensive-quote | 8 | 6 | number + enum | 无 |
| price-standard | 6-8 | 10 | number + enum | 条件字段 |
| turning-formulas | 6-7 | 8 | number + enum | 8种车削切换 |
| comprehensive-cost | 15+ | 14 | number + enum | 列表输入 |
| batch-cost | 12 | 14 | number + enum | 模具摊销逻辑 |
| process-time | 13 | 4 | number + enum | 列表输入 |
| milling-time | 10 | 9 | number + enum | 八步法分步展示 |
| cutting-params | 2-4 | 2-3 | enum + number | 查表逻辑 |
| math-utils | 1 | 1-2 | number | 无需UI |
