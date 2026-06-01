# cf-calculators — 中国在线计算器

> 部署模式：**pages**（Cloudflare Pages，Free 套餐）
> 不依赖 `@eforge/cf-core`，纯静态站无需后端。

## 定位

**面向中国用户的政策相关计算器。** 内容与中国国内政策强相关。

| 维度 | 说明 |
|------|------|
| 目标用户 | **中国用户**（国内职场人、财务人员） |
| 内容类型 | 政策计算器（五险一金、个税、房贷、车贷） |
| 语言 | **纯中文**（标题、描述、FAQ、UI 文案全部中文） |
| 页面规模 | **5-20 个计算器**（手工编写） |
| 开发方式 | Eleventy 模板 + 手工 JS 逻辑 |
| 部署 | Cloudflare Pages（Free 套餐） |

## ⚠️ 部署限制

**国内用户无法直接访问 Cloudflare Pages。** 当前暂缓部署，需确定国内部署方案：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 国内 CDN（阿里云 OSS + CDN） | 国内访问快 | 需要 ICP 备案 |
| 国内服务器 | 完全可控 | 运维成本高 |
| 继续使用 CF + 域名解析到国内 | 折中方案 | 稳定性不确定 |

## 严禁混入的内容

| 类型 | 示例 | 应放到 |
|------|------|--------|
| 通用开发工具 | JSON 格式化、Base64、UUID | `cf-static` |
| 英文内容 | 任何英文 UI 文案 | 不允许，全部用中文 |
| 程序化 SEO 内容 | "What is X" 信息页 | `cf-seo` |

## 与 cf-static 的区别

| 维度 | cf-static | cf-calculators |
|------|-----------|----------------|
| 目标用户 | 国际用户（全球开发者） | 中国用户（国内职场人） |
| 语言 | 纯英文 | 纯中文 |
| 内容 | 通用开发工具（JSON、Base64、MD5） | 国内政策计算器（五险一金、个税、房贷） |
| 域名 | Cloudflare Pages 域名 | 需要国内域名（待部署） |
| 可访问性 | 全球可访问 | 国内无法访问 CF，需国内部署方案 |
| 变现 | Google AdSense | 国内广告平台（待确定） |

## 快速开始

```bash
cd templates/cf-calculators
npm install

# 编辑配置
vim src/_data/config.json     # 站点名称、URL、社交链接
vim src/_data/tools.json      # 添加计算器定义（中文）

# 添加计算器
# 1. 在 src/_data/tools.json 添加计算器元数据（type: "calculator"）
# 2. 在 assets/js/ 创建对应的 JS 文件
# 3. 在 src/_includes/ 创建 njk 模板（自定义表单 UI）

# 开发
npm run dev                   # http://localhost:8787

# 构建
npm run build                 # 输出到 _site/
```

## 项目结构

```
cf-calculators/
├── src/
│   ├── _data/
│   │   ├── config.json       # 站点配置（中文）
│   │   └── tools.json        # 计算器元数据（中文，type: "calculator"）
│   ├── _includes/
│   │   ├── income-tax-calculator.njk    # 个税计算器表单
│   │   └── social-insurance-calculator.njk  # 五险一金表单
│   ├── _layouts/
│   │   └── base.njk          # 基础模板
│   ├── index.njk             # 首页
│   ├── tools.njk             # 工具页面模板（支持 calculator 类型）
│   └── ...
├── assets/
│   ├── js/
│   │   ├── income-tax-calculator.js
│   │   ├── social-insurance-calculator.js
│   │   └── utils.js          # 财务工具通用函数库
│   └── styles.css
├── .eleventy.js
├── package.json
└── wrangler.toml
```

## 环境变量

| 变量 | 必须 | 说明 |
|------|:----:|------|
| `CLOUDFLARE_API_TOKEN` | ✅ | Cloudflare API Token（部署用） |
| `TURSO_URL` | ❌ | 纯静态站不需要数据库 |
| `TURSO_TOKEN` | ❌ | 纯静态站不需要数据库 |
