# cf-static — 纯静态站模板

> 部署模式：**Pages**（Cloudflare Pages，无限带宽，Free 套餐）

## 适用场景

- **SEO 工具站**：JSON Formatter、Base64 Decoder、UUID Generator 等
- **文档站**：API 文档、产品文档、知识库
- **博客**：技术博客、产品博客
- **落地页**：产品落地页、邀请页、资料页

## 快速开始

```bash
# 1. 复制模板
cp -R templates/cf-static ../my-seo-site
cd ../my-seo-site

# 2. 调整路径
sed -i '' 's|../packages/cf-core|./packages/cf-core|g' tsconfig.json 2>/dev/null

# 3. 安装依赖
npm install

# 4. 编辑 SEO 配置
#    修改 src/seo-config.json — 定义所有页面的 SEO 元数据
#    修改 src/tools/*.json — 每个工具的数据

# 5. 生成页面
npm run generate:seo

# 6. 本地预览
npm run dev
# 打开 http://localhost:8787

# 7. 一键部署
CLOUDFLARE_API_TOKEN="cfat_xxx" bash .deploy/one-click.sh
```

## 目录结构

```
cf-static/
├── .deploy-mode          # "pages"（部署模式标识）
├── .deploy/              # 部署脚本（从模板复制）
├── public/               # 静态文件（部署到 Cloudflare Pages）
│   ├── index.html        # 首页
│   ├── robots.txt        # SEO 爬虫规则
│   ├── _headers          # Cloudflare 自定义响应头
│   ├── css/style.css     # 全站样式
│   └── tools/            # 工具页面（自动生成）
│       ├── json-formatter.html
│       ├── base64-decode.html
│       └── uuid-generator.html
├── src/                  # SEO 数据源
│   ├── seo-config.json   # 全站 SEO 配置
│   ├── tools/            # 每个工具的元数据
│   │   ├── json-formatter.json
│   │   ├── base64-decode.json
│   │   └── uuid-generator.json
│   └── templates/        # HTML 模板
│       └── tool.html     # 工具页面模板
├── scripts/
│   ├── generate-seo-pages.mjs   # 程序化页面生成器
│   └── generate-sitemap.mjs     # sitemap.xml 生成器
└── package.json
```

## SEO 配置

编辑 `src/seo-config.json` 定义全站 SEO 元数据：

```json
{
  "siteName": "DevTools Online",
  "siteUrl": "https://devtools.example.com",
  "description": "Free online developer tools",
  "author": "Your Name",
  "locale": "en_US",
  "twitterHandle": "@yourhandle"
}
```

## 添加工具

1. 在 `src/tools/` 下创建 JSON 文件（如 `my-tool.json`）：

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

2. 运行 `npm run generate:seo` 生成页面
3. 部署即可

## GEO 优化

每个工具页面自动生成：
- **Schema.org JSON-LD**（`SoftwareApplication` + `FAQPage`）
- **Open Graph 标签**（og:title, og:description, og:url）
- **Twitter Card 标签**（twitter:card, twitter:title）
- **FAQ 结构化数据**（AI 搜索引擎友好）
- **canonical URL**（防止重复内容）
- **robots.txt**（允许 GPTBot、ClaudeBot 等 AI 爬虫）
