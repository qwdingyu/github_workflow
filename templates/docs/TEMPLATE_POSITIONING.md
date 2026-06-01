# 产品模板定位规约

> **所有模板必须严格遵循单一职责原则。严禁混入不属于本模板目标用户的内容。**

---

## 模板总览

| 模板 | 定位 | 目标用户 | 语言 | 部署 |
|------|------|---------|------|------|
| `cf-tools` | Workers 动态工具站 | 国际用户 | 英文 | Cloudflare Workers |
| `cf-static` | 手工精品工具站 | 国际用户 | 英文 | Cloudflare Pages |
| `cf-calculators` | 中国在线计算器 | 中国用户 | 中文 | 待确定（国内方案） |
| `cf-seo` | 程序化 SEO 站 | 国际用户 | 英文 | Cloudflare Pages |
| `cf-shop` | 发卡商城 | 国际用户 | 英文 | Cloudflare Workers |
| `cf-api` | API 中转站 | 开发者 | 英文 | Cloudflare Workers |
| `cf-form` | 表单收集 | 通用 | 多语言 | Cloudflare Workers |

---

## cf-static vs cf-calculators vs cf-seo

### 核心区别

| 维度 | cf-static | cf-calculators | cf-seo |
|------|-----------|----------------|--------|
| **本质** | 交互工具（产品） | 政策计算器（产品） | 信息内容（流量） |
| **目标用户** | 国际开发者 | 中国职场人 | 国际用户（搜索引擎） |
| **语言** | 纯英文 | 纯中文 | 纯英文 |
| **内容类型** | 有 JS 逻辑的交互页面 | 有复杂计算的表单页面 | 纯 HTML 信息页 |
| **页面规模** | 10-50 个精品 | 5-20 个计算器 | 100-10000 个量产 |
| **开发方式** | 手工写 JS | 手工写 JS + 表单模板 | 数据驱动批量生成 |
| **维护方式** | 每个工具独立迭代 | 政策变化时更新费率 | 改数据源，刷新页面 |
| **技术栈** | Eleventy + 手工 JS | Eleventy + 手工 JS | 纯 Node 脚本 |
| **部署** | Cloudflare Pages | 待确定（国内方案） | Cloudflare Pages |
| **可访问性** | 全球可访问 | 国内无法访问 CF | 全球可访问 |
| **变现** | AdSense + 高级功能 | 国内广告（待确定） | 纯 AdSense |

### 内容归属规则

| 内容类型 | 示例 | 归属 |
|---------|------|------|
| 通用开发工具 | JSON 格式化、Base64、MD5、UUID、正则测试 | `cf-static` |
| 国内政策计算器 | 五险一金、个税、房贷、车贷 | `cf-calculators` |
| 程序化 SEO 内容 | "What is JSON"、"Base64 vs URL Encoding" | `cf-seo` |
| Workers 动态工具 | 需要数据库/限流的工具 | `cf-tools` |

### 严禁混入的内容

**cf-static 中严禁：**
- 国内政策相关内容（五险一金、个税等）
- 中文 UI 文案（按钮、FAQ、页面标题）
- 国内社交媒体链接（微信、微博、知乎）
- Workers 部署脚本（Turso、Turnstile）
- 程序化 SEO 内容页

**cf-calculators 中严禁：**
- 通用开发工具（JSON、Base64 等）
- 英文 UI 文案
- 国际用户相关内容

**cf-seo 中严禁：**
- 需要 JS 交互逻辑的页面
- 手工编写的产品页面
- 国内政策相关内容

---

## 维护规则

1. **新增内容前先确认归属**：在哪个模板中添加内容，必须先确认目标用户和内容类型是否匹配。
2. **语言必须一致**：cf-static 和 cf-seo 全部英文，cf-calculators 全部中文。不允许中英混杂。
3. **部署脚本不得混用**：静态站（cf-static、cf-calculators、cf-seo）不需要 Workers 部署脚本。
4. **package.json name 必须匹配**：`name` 字段必须与模板目录名一致（如 `cf-static`）。
5. **Schema.org 货币必须匹配**：国际站用 `USD`，中国站用 `CNY`。

---

## 检查清单

在往任何模板添加内容前，必须回答：

- [ ] 目标用户是谁？（国际 / 中国 / 通用）
- [ ] 内容类型是什么？（交互工具 / 政策计算器 / 信息内容）
- [ ] 语言是什么？（英文 / 中文）
- [ ] 是否需要 JS 交互逻辑？（是 → cf-static/cf-calculators，否 → cf-seo）
- [ ] 是否涉及国内政策？（是 → cf-calculators，否 → 其他）

如果答案与模板定位不符，**必须放到正确的模板中**。
