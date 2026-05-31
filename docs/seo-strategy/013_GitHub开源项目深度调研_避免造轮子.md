# GitHub 开源项目深度调研：避免过度造轮子

> 撰写时间：2026 年 5 月 31 日
> 目标：找到可以直接 fork/参考/集成的开源工具站项目，适配 Cloudflare Pages + Eleventy 生态
> 原则：**只引用可验证的信息，不确定处明确标注**

---

## 第一部分：GEO（AI 搜索优化）相关开源项目——全是理论，没有工具站

你提到"GitHub 上有很多 GEO 的项目"，经过系统搜索，结论是：

### GitHub 上 `generative-engine-optimization` 主题下的所有项目：

| 项目 | 类型 | 能否直接用 | 说明 |
|------|------|-----------|------|
| `GEO-optim/GEO` | 学术论文 + 评测基准 (GEO-BENCH) | ❌ | 研究用，不是工具站 |
| `krillinai/GEO` | GEO 指南文档（Markdown） | ❌ | 纯文档，类似 wiki |
| `Kulraj69/Generative-Engine-Optimization` | Awesome 列表（资源合集） | ❌ | 链接集合，不是可部署项目 |
| `cxcscmu/AutoGEO` | ICLR'26 论文框架（Python） | ❌ | 学术研究，黑盒优化网页内容 |
| `alexandrebrt14-sys/geo-checklist` | GEO 检查清单（Markdown） | ❌ | 文档，对应 geo-checklist.dev 网站 |
| `geo-lint` | 代码质量检查工具 | ⚠️ | 检查代码是否符合 GEO 规范，不是工具站 |
| `geo-optimizer-skill` | Claude Code 技能文件 | ❌ | AI 辅助工具，不是网站 |
| `xanlens` | 未知（stars=0） | ❌ | 无实质内容 |
| `awesome-geo` | 资源列表 | ❌ | 链接合集 |
| `ai-visibility-monitor` | AI 可见性监控 | ⚠️ | stars=0，不成熟 |
| `aeo-tracker` | AEO 追踪器 | ❌ | stars=0 |
| `llms-txt-templates` | LLMs.txt 模板 | ❌ | 配置文件模板 |
| `aeoptimize` | 未知 | ❌ | stars=0 |
| `aio-surfaces` | 未知 | ❌ | stars=0 |

### 核心结论：

```
GitHub 上所有 tagged "generative-engine-optimization" 的项目：
  - 100% 是理论/文档/研究/检查清单
  - 0% 是可部署的工具网站
  - 0% 可以直接 fork 后部署到 Cloudflare Pages

GEO 是一个"优化方法论"，不是一个"可复用的代码框架"。
你无法 fork 一个 GEO 项目来做一个工具站。
GEO 是你"怎么做"你的工具站，而不是"做什么"。
```

**所以：GEO 相关开源项目，对你的工具站项目没有直接复用价值。**

---

## 第二部分：AI/ML 工具类开源项目——有可参考的，但需要改造

### 2.1 AI Token 计算器

| 项目 | 技术栈 | 开源协议 | 可直接用？ | 适配 Cloudflare Pages？ |
|------|--------|---------|-----------|----------------------|
| **Turtles-AI-Lab/llm-cost-calculator** | **JavaScript 71.3% + HTML 16.5% + CSS 12.2%**（纯前端） | 需确认（GitHub 页面加载失败） | ✅ **最接近** | ✅ **完美适配** |
| anirudhhgupta/ai-token-calculator | TypeScript 93.2% + CSS 4.3% + JS 2.5%（可能是 React/Vite） | 需确认 | ⚠️ 需改造 | ⚠️ 需改为静态构建 |
| Steveclare/ai-token-calculator | Python 99.5%（Streamlit） | 需确认 | ❌ | ❌ Streamlit 需要 Python 运行时 |
| artosien/Tokensense-Ai | 未知（已部署为网站 tokensense.ai） | 需确认 | ⚠️ | ⚠️ 需看源码 |
| farhanhamim.github.io/llm-token-calculator | 已部署在 GitHub Pages | 需确认 | ⚠️ | ⚠️ 可参考 |
| saoud30/AI-token-calculator | Streamlit（Python） | 需确认 | ❌ | ❌ |

**⭐ 重点推荐：`Turtles-AI-Lab/llm-cost-calculator`**
- 纯前端（JS + HTML + CSS），无后端依赖
- 支持 OpenAI、Anthropic、Google、Azure、Mistral 等多厂商
- 可直接 fork，稍作改造即可嵌入 Eleventy 项目
- **但需要确认：License 是否允许商用/修改**

### 2.2 LLM 定价数据源

| 项目 | 类型 | 价值 |
|------|------|------|
| **simonw/llm-prices** | Python 脚本 + HTML 生成静态站（llm-prices.com） | ⭐⭐⭐ 极好的**定价数据源** |
| llmpricing.ai | 商业 API + 网站 | ⭐⭐ 数据可参考 |
| pricepertoken.com | 商业站（300+ 模型） | ⭐⭐ 数据可参考 |

**simonw/llm-prices 的使用方式：**
- Simon Willison 是知名开发者工具作者（Datasette 作者）
- 这个项目维护了各 LLM 的定价数据
- 生成静态 HTML 页面展示
- **你可以直接引用他的定价数据（需确认 License），或者用他的数据格式作为你的数据源**

### 2.3 AI 工具类总结

```
直接可用（fork → 部署）：
  ✅ Turtles-AI-Lab/llm-cost-calculator（纯前端 LLM 成本计算器）

需要改造（fork → 改造 → 部署）：
  ⚠️ anirudhhgupta/ai-token-calculator（TypeScript，需适配 Eleventy）
  ⚠️ artosien/Tokensense-Ai（需查看源码和技术栈）

不可用（技术栈不匹配）：
  ❌ Steveclare/ai-token-calculator（Streamlit/Python）
  ❌ saoud30/AI-token-calculator（Streamlit/Python）

数据源（可引用定价数据）：
  ⭐ simonw/llm-prices（权威定价数据）
```

---

## 第三部分：开发者工具类开源项目——有大量可复用的

### 3.1 Cron 表达式生成器

| 项目 | 技术栈 | 可直接用？ | 说明 |
|------|--------|-----------|------|
| **thomasba/cron-expression-generator** | **纯 HTML + JavaScript** | ✅ | 最简单，可直接嵌入 |
| **Cronhub (cronhub.dev)** | 开源（技术栈需确认） | ⚠️ | 功能最全，支持多平台（Linux/AWS/K8s/GitHub Actions） |
| mathewsachin.github.io/tools/cron | 纯 JavaScript | ✅ | 简单版，GitHub Pages 部署 |
| cronstrue (npm) | npm 包（JS 库） | ✅ | **不是完整工具，但可复用**——将 cron 表达式转为人话描述 |

**⭐ 推荐组合：`thomasba/cron-expression-generator`（UI）+ `cronstrue`（人话描述库）**
- thomasba 项目是纯前端，可直接 fork
- cronstrue 是成熟的 npm 包（被多个项目使用），提供 cron → 人话翻译
- 两者结合 = 完整的 Cron 生成器

### 3.2 Dockerfile 生成器

| 项目 | 技术栈 | 可直接用？ | 说明 |
|------|--------|-----------|------|
| **chitranshk1301/dockerfile-generator** | 已部署在 GitHub Pages | ✅ | 纯前端，支持多语言模板 |
| flexstack/new-dockerfile | Go CLI 工具 | ❌ | 命令行工具，不是网页 |

**⭐ 推荐：`chitranshk1301/dockerfile-generator`**
- 已部署为静态站（GitHub Pages）
- 支持 Node.js、Python、Go 等多种语言模板
- 可直接 fork 改造

### 3.3 其他开发者工具

| 工具 | GitHub 项目 | 技术栈 | 可直接用？ |
|------|-----------|--------|-----------|
| **JWT 解码器** | jwt.io（非开源） | - | ❌ 闭源 |
| JWT 解码器（开源替代） | 多个小型项目 | 纯 JS | ⚠️ 需筛选 |
| **JSON 格式化** | 大量 npm 包 | JS | ✅ 用 npm 包即可 |
| **Base64 编解码** | 浏览器原生 API | - | ✅ 无需第三方 |
| **UUID 生成器** | 浏览器 crypto API | - | ✅ 无需第三方 |
| **颜色选择器/转换** | 多个开源项目 | 纯 JS | ✅ |
| **Markdown 预览器** | marked.js（npm） | JS | ✅ |
| **Diff 比较器** | diff-match-patch（Google） | JS | ✅ |

---

## 第四部分：关键判断——哪些该 fork，哪些该自研

### 4.1 Fork & 改造（立即可用）

| 优先级 | 工具 | 来源项目 | 改造工作量 | 预期效果 |
|--------|------|---------|-----------|---------|
| **P0** | **LLM 成本计算器** | Turtles-AI-Lab/llm-cost-calculator | 中（需适配 Eleventy + 更新定价数据） | 直接获得一个功能完整的 AI 成本计算工具页 |
| **P0** | **Cron 表达式生成器** | thomasba/cron-expression-generator + cronstrue | 小（纯前端，直接嵌入） | 1-2 天完成 |
| **P1** | **Dockerfile 生成器** | chitranshk1301/dockerfile-generator | 中（需适配 Eleventy） | 3-5 天完成 |

### 4.2 自研（没有好的开源替代品）

| 工具 | 为什么自研 | 工作量 |
|------|-----------|--------|
| **AI Token 计算器** | 开源项目要么技术栈不匹配（Streamlit），要么功能不完整 | 2-3 天 |
| **LLM 模型对比工具** | 没有成熟的开源项目，需自研数据源 + UI | 3-5 天 |
| **Prompt 模板库** | 内容型工具，无开源可参考 | 2-3 天 |

### 4.3 用 npm 包组合（无需 fork 完整项目）

| 工具 | 核心 npm 包 | 工作量 |
|------|------------|--------|
| JSON 格式化 | `js-beautify` | 0.5 天 |
| Base64 编解码 | 浏览器原生 `btoa`/`atob` | 0.5 天 |
| UUID 生成 | `uuid` 或浏览器 `crypto.randomUUID()` | 0.5 天 |
| Markdown 预览 | `marked` | 0.5 天 |
| Diff 比较 | `diff` | 1 天 |
| 颜色转换 | `color-convert` | 0.5 天 |
| SQL 格式化 | `sql-formatter` | 0.5 天 |
| YAML 格式化 | `js-yaml` | 0.5 天 |

---

## 第五部分：License 风险警告（极其重要）

在 fork 任何开源项目之前，**必须确认 License**：

| License | 能否商用 | 能否修改 | 是否需要开源你的修改 | 风险 |
|---------|---------|---------|-------------------|------|
| **MIT** | ✅ | ✅ | ❌ | 无风险 |
| **Apache 2.0** | ✅ | ✅ | ❌ | 无风险（需保留 NOTICE） |
| **BSD 2/3-Clause** | ✅ | ✅ | ❌ | 无风险 |
| **GPL v3** | ⚠️ | ✅ | ✅ **必须** | **高风险**——你的整个项目可能被要求开源 |
| **AGPL v3** | ❌ | ✅ | ✅ **必须** | **极高风险**——网络使用也算分发 |
| **MPL 2.0** | ✅ | ✅ | ✅ 仅修改的文件 | 中风险 |
| **未声明 License** | ❌ | ❌ | - | **不能用**——默认保留所有权利 |

**上述推荐的开源项目，大部分未能在 GitHub 页面加载时确认 License。**
**在 fork 之前，必须逐一确认：**

```bash
# 对每个候选项目，检查 License：
1. 查看项目根目录的 LICENSE 文件
2. 如果是 MIT/Apache 2.0/BSD → 安全
3. 如果是 GPL/AGPL → 不能用（会传染到你的项目）
4. 如果没有 License 文件 → 不能用
```

---

## 第六部分：最佳策略——"Fork + 自研"混合模式

### 6.1 不要做的事

| 行为 | 原因 |
|------|------|
| ❌ Fork 一个完整项目然后原样部署 | SEO 上，Google 会识别为"重复内容"，不收录或低权重 |
| ❌ 直接复制 UI 不改代码结构 | 违反大多数开源 License 的 attribution 要求 |
| ❌ 使用 GPL/AGPL 项目 | License 传染风险 |
| ❌ 过度依赖单个开源项目 | 维护者放弃 = 你的项目也停滞 |

### 6.2 应该做的事

```
正确姿势：

Step 1: 参考开源项目的"功能设计"和"数据结构"
  ├─ 看 Turtles-AI-Lab 的定价数据格式 → 建立自己的数据源
  ├─ 看 thomasba 的 Cron UI 交互逻辑 → 用你自己的代码重写
  └─ 看 chitranshk1301 的 Dockerfile 模板 → 扩展更多语言

Step 2: 用 Eleventy + 你自己的代码实现
  ├─ 数据结构：参考开源项目，但用自己的 JSON/TS 格式
  ├─ UI：参考开源项目的设计，但用你自己的组件
  └─ 逻辑：参考开源项目的算法，但用自己的实现

Step 3: 在页脚注明灵感来源
  "Inspired by [项目名] ([License])" — 这是最佳实践
```

### 6.3 具体执行计划

| 工具 | 策略 | 参考项目 | 自研比例 |
|------|------|---------|---------|
| LLM 成本计算器 | **Fork 数据 + 自研 UI** | Turtles-AI-Lab（数据格式）+ simonw/llm-prices（数据源） | 70% 自研 |
| Cron 生成器 | **Fork 核心 + 自研 UI** | thomasba（交互逻辑）+ cronstrue（npm 包） | 60% 自研 |
| Dockerfile 生成器 | **参考设计 + 自研实现** | chitranshk1301（模板思路） | 80% 自研 |
| AI Token 计算器 | **纯自研** | 无合适开源（参考定价数据即可） | 100% 自研 |
| LLM 模型对比 | **纯自研** | 无合适开源 | 100% 自研 |

---

## 第七部分：最终建议

### 一句话总结：

> **GitHub 上没有可以直接 fork 部署的"GEO 工具站"。**
> GEO 相关项目全是理论和文档，不是可部署的代码。
>
> **但有 3 个开源项目值得参考：**
> 1. `Turtles-AI-Lab/llm-cost-calculator` — 纯前端 LLM 成本计算器（参考数据结构和 UI）
> 2. `thomasba/cron-expression-generator` — 纯前端 Cron 生成器（参考交互逻辑）
> 3. `chitranshk1301/dockerfile-generator` — 纯前端 Dockerfile 生成器（参考模板设计）
>
> **策略：参考它们的功能设计和数据结构，用自己的代码在 Eleventy 框架内重新实现。**
> 这样既避免了造轮子，又保证了 SEO 原创性和 License 安全。

### 立即行动：

```bash
# 1. 克隆并检查这三个项目的 License
git clone https://github.com/Turtles-AI-Lab/llm-cost-calculator.git
git clone https://github.com/thomasba/cron-expression-generator.git
git clone https://github.com/chitranshk1301/dockerfile-generator.git

# 2. 确认每个项目的 LICENSE 文件
#    MIT/Apache 2.0/BSD → 可以参考资料和代码结构
#    GPL/AGPL → 只能参考思路，不能复制代码
#    无 License → 只能参考思路

# 3. 在 Eleventy 项目中，用自己的代码重新实现
#    数据结构参考开源项目，UI 和逻辑自己写
```

需要我现在就开始：
1. 克隆这三个项目检查 License？
2. 还是在 Eleventy 项目中直接开始自研第一个工具（AI Token 计算器）？

---

*文档版本：v1.0 | 最后更新：2026-05-31*
*声明：所有 GitHub 项目信息基于搜索结果，License 状态需在克隆后逐一确认。*
