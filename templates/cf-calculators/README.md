# cf-static — 纯静态站模板

> 部署模式：**pages**（Cloudflare Pages，无限带宽，Free 套餐）
> 不依赖 `@eforge/cf-core`，纯静态站无需后端。
> 详细文档：[产品模板使用指南](../docs/002_产品模板使用指南.md) | [踩坑记录](../docs/003_端到端部署踩坑记录.md) | [深度审计](../docs/004_五大模板深度审计与优化方案.md)

## 适用场景

- **SEO 工具站**：JSON Formatter、Base64 Decoder、UUID Generator 等
- **文档站**：API 文档、产品文档、知识库
- **博客/落地页**：产品落地页、邀请页、资料页

## 快速开始

```bash
cp -r templates/cf-static your-seo-site
cd your-seo-site
npm install
vim src/seo-config.json        # 编辑 SEO 配置
vim src/tools/*.json           # 添加工具定义
npm run generate:seo           # 生成页面 + sitemap + robots.txt
npm run dev                    # http://localhost:8787
```

一键部署：

```bash
CLOUDFLARE_API_TOKEN="cfat_xxx" DEPLOY_MODE=pages bash .deploy/one-click.sh
```

## 项目结构

```
cf-static/
├── public/                   # 静态文件（部署到 Cloudflare Pages）
│   ├── index.html            # 首页（工具列表）
│   ├── robots.txt            # SEO 爬虫规则（允许 GPTBot/ClaudeBot）
│   ├── sitemap.xml           # 站点地图（自动生成）
│   ├── _headers              # Cloudflare 自定义响应头
│   ├── css/style.css         # 全站样式（暗色主题）
│   ├── js/                   # 工具 JS 文件
│   │   ├── json-formatter.js
│   │   ├── base64-decode.js
│   │   └── uuid-generator.js
│   └── tools/                # 工具页面（自动生成）
│       ├── json-formatter.html
│       ├── base64-decode.html
│       └── uuid-generator.html
├── src/                      # SEO 数据源
│   ├── seo-config.json       # 全站 SEO 配置
│   ├── tools/*.json          # 每个工具的元数据
│   └── templates/tool.html   # 工具页面模板
├── scripts/
│   └── generate-seo-pages.mjs  # 程序化页面生成器（含 sitemap + robots）
├── .deploy/                  # one-click.sh 部署脚本体系
├── .deploy-mode              # "pages"
├── package.json
└── .gitignore
```

## SEO/GEO 优化

每个工具页面自动生成：
- **Schema.org JSON-LD**（`SoftwareApplication` + `FAQPage`）
- **Open Graph + Twitter Card** 标签
- **FAQ 结构化数据**（AI 搜索引擎友好）
- **canonical URL**（防重复内容）
- **robots.txt**（允许 GPTBot、ClaudeBot、PerplexityBot 等 AI 爬虫）

## 添加工具

1. 创建 `src/tools/my-tool.json`：

```json
{
  "slug": "my-tool",
  "title": "My Awesome Tool",
  "description": "Does something amazing",
  "keywords": ["tool", "online", "free"],
  "category": "general",
  "faq": [
    { "q": "What is this tool?", "a": "It does X." },
    { "q": "Is it free?", "a": "Yes, completely free." }
  ]
}
```

2. 创建 `public/js/my-tool.js`（实现 `processTool()` / `copyOutput()` / `clearAll()` 三个函数）
3. 运行 `npm run generate:seo` 生成页面
4. 部署即可

## 环境变量

| 变量 | 必须 | 说明 |
|------|:----:|------|
| `CLOUDFLARE_API_TOKEN` | ✅ | Cloudflare API Token（部署用） |
| `TURSO_URL` | ❌ | 纯静态站不需要数据库 |
| `TURSO_TOKEN` | ❌ | 纯静态站不需要数据库 |

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 部署 | Cloudflare Pages | 无限带宽，Free 套餐 |
| 页面生成 | Node.js 脚本 | 程序化 SEO 页面生成 |
| 样式 | 原生 CSS | 暗色主题，响应式 |
| 工具 JS | 原生 JavaScript | 浏览器端执行，无后端依赖 |
