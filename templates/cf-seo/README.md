# cf-static — 手工精品工具站

> 部署模式：**pages**（Cloudflare Pages，Free 套餐）
> 不依赖 `@eforge/cf-core`，纯静态站无需后端。

## 定位

**面向国际用户的精品交互工具站。** 每个工具都是手工编写的产品，靠实用性获客。

| 维度 | 说明 |
|------|------|
| 目标用户 | **国际用户**（英文内容，面向全球开发者） |
| 内容类型 | 交互工具（JSON 格式化、Base64 编解码、UUID 生成器等） |
| 语言 | **纯英文**（标题、描述、FAQ、UI 文案全部英文） |
| 页面规模 | **10-50 个精品工具**（手工编写，不追求数量） |
| 开发方式 | Eleventy 模板 + 手工 JS 逻辑 |
| 部署 | Cloudflare Pages（Free 套餐，无限带宽） |
| 变现方式 | Google AdSense 广告 + 高级功能收费 |

## 严禁混入的内容

| 类型 | 示例 | 应放到 |
|------|------|--------|
| 国内政策相关 | 五险一金、个税计算、房贷计算 | `cf-calculators` |
| 程序化 SEO 内容 | "What is X"、"X vs Y" 信息页 | `cf-seo` |
| 中文 UI 文案 | 按钮文字、FAQ、页面标题 | 不允许，全部用英文 |
| 国内社交媒体 | 微信、微博、知乎链接 | `cf-calculators` |
| Workers 部署脚本 | Turso、Turnstile、GitHub Actions | `cf-tools` / `cf-shop` |

## 与 cf-calculators 的区别

| 维度 | cf-static | cf-calculators |
|------|-----------|----------------|
| 目标用户 | 国际用户（全球开发者） | 中国用户（国内职场人） |
| 语言 | 纯英文 | 纯中文 |
| 内容 | 通用开发工具（JSON、Base64、MD5） | 国内政策计算器（五险一金、个税、房贷） |
| 域名 | Cloudflare Pages 域名（如 devtools.pages.dev） | 需要国内域名（待部署） |
| 可访问性 | 全球可访问 | 国内无法访问 CF，需国内部署方案 |
| 部署状态 | 可立即部署 | 暂缓（国内无法访问 CF） |
| 变现 | Google AdSense | 国内广告平台（待确定） |

## 与 cf-seo 的区别

| 维度 | cf-static | cf-seo |
|------|-----------|--------|
| 内容类型 | 交互工具（有 JS 逻辑） | 信息内容（纯 HTML） |
| 页面数量 | 10-50 个精品 | 100-10000 个量产 |
| 开发方式 | 手工写每个工具的 JS | 编辑数据源，批量生成 |
| 维护方式 | 每个工具独立迭代 | 改数据，刷新页面 |
| 技术栈 | Eleventy + 手工 JS | 纯 Node 脚本生成 HTML |

## 快速开始

```bash
cd templates/cf-static
npm install

# 编辑配置
vim src/_data/config.json     # 站点名称、URL、社交链接
vim src/_data/tools.json      # 添加工具定义（英文）

# 添加工具
# 1. 在 src/_data/tools.json 添加工具元数据
# 2. 在 assets/js/ 创建对应的 JS 文件
# 3. 如需自定义 UI，在 src/_includes/ 创建 njk 模板

# 开发
npm run dev                   # http://localhost:8787

# 构建
npm run build                 # 输出到 _site/

# 部署
CLOUDFLARE_API_TOKEN="cfat_xxx" npm run deploy
```

## 项目结构

```
cf-static/
├── src/                      # Eleventy 源文件
│   ├── _data/
│   │   ├── config.json       # 站点配置（英文）
│   │   └── tools.json        # 工具元数据（英文）
│   ├── _layouts/
│   │   └── base.njk          # 基础模板（含 Schema.org）
│   ├── index.njk             # 首页
│   ├── tools.njk             # 工具页面模板
│   ├── tools-index.njk       # 工具列表页
│   ├── privacy.njk           # 隐私政策（英文）
│   ├── terms.njk             # 服务条款（英文）
│   ├── about.njk             # 关于我们（英文）
│   └── 404.njk               # 404 页面（英文）
├── assets/
│   ├── js/                   # 工具 JS 文件
│   └── styles.css            # 全站样式
├── .eleventy.js              # Eleventy 配置
├── package.json
└── wrangler.toml             # Cloudflare Pages 配置
```

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 部署 | Cloudflare Pages | 无限带宽，Free 套餐 |
| 静态站点生成 | Eleventy (11ty) | 轻量高效 |
| 样式 | 原生 CSS | 暗色主题，响应式 |
| 工具 JS | 原生 JavaScript | 浏览器端执行，无后端依赖 |

## SEO/GEO 优化

每个工具页面自动生成：
- **Schema.org JSON-LD**（`SoftwareApplication` + `FAQPage`）
- **Open Graph + Twitter Card** 标签
- **FAQ 结构化数据**（AI 搜索引擎友好）
- **canonical URL**（防重复内容）
- **robots.txt**（允许 GPTBot、ClaudeBot、PerplexityBot 等 AI 爬虫）
