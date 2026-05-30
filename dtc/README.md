# DTC Lookup — 汽车 DTC 故障码查询服务

> 部署模式：**workers**（Cloudflare Workers + Static Assets）
> 集成 `@eforge/cf-core` 共享内核，复制后改配置即可上线。
> 数据来源：Wal33D/dtc-database（MIT License）+ wzr1337/dtcmapping → 21,360 条 / 34 制造商

基于 Cloudflare Workers + Turso + Drizzle ORM 的 OBD-II DTC 故障码查询服务。

## 快速开始

```bash
cd dtc && npm install
npm run dev                    # http://localhost:8780
npm test                       # 43 个单元测试
```

一键部署：

```bash
CLOUDFLARE_API_TOKEN="cfat_xxx" TURSO_API_TOKEN="turso_xxx" \
  bash .deploy/one-click.sh
```

## 数据结构

| 维度 | 数值 |
|------|------|
| DTC 故障码 | 21,360 条（汽车 OBD-II） |
| 制造商 | 34 个 |
| 系统类型 | P=15,463 / B=2,612 / C=1,453 / U=1,832 |
| 通用码 (GENERIC) | 11,970 条 |
| 数据来源 | wal33d/dtc-database + wzr1337/dtcmapping |

## API 接口

**公共**：`GET /api/health`

**v1 查询**：`GET /api/v1/dtc/{code}`（单码·支持 `?manufacturer=`） · `GET /api/v1/dtc/search`（搜索·支持 `?q=&manufacturer=&system=&limit=&offset=`）
`POST /api/v1/dtc/batch`（批量·最多 500） · `GET /api/v1/dtc/stats`
`GET /api/v1/dtc/by-manufacturer/{mfr}` · `POST /api/v1/dtc/extract`
`GET /api/v1/dtc/normalize/{code}` · `GET /api/v1/manufacturers`

## 项目结构

```
dtc/
├── src/
│   ├── index.ts              # Worker 入口（bootstrap 工厂）
│   ├── bindings.ts           # 环境变量类型（extends CoreBindings）
│   ├── config.ts             # 业务配置
│   ├── db/schema.ts          # 数据库 Schema（2 张业务表）
│   ├── routes/
│   │   ├── health.ts         # 健康检查
│   │   ├── dtc.ts            # DTC 查询 API 路由（7 端点）
│   │   └── manufacturers.ts  # 制造商列表路由
│   └── services/
│       └── dtc-service.ts    # 核心业务逻辑（lookup/search/batch/stats...）
├── public/                   # 静态资源 + 生成的 SEO 页面
│   ├── index.html            # 首页（搜索入口）
│   ├── search.html           # API 驱动的搜索结果页
│   ├── 404.html              # 友好错误页
│   ├── _headers              # 安全与缓存响应头
│   ├── css/style.css         # 暗色主题样式
│   ├── dtc/{code}.html       # 自动生成：19,000+ SEO 详情页
│   ├── p/b/c/u.html          # 自动生成：系统分类页
│   └── manufacturers/*.html  # 自动生成：34 个制造商页
├── scripts/
│   ├── import-data.mjs       # DTC 数据导入 Turso
│   ├── generate-pages.mjs    # SEO 页面生成器（19K+ 页 + sitemap + robots）
│   ├── migrate.mjs           # 数据库迁移
│   └── smoke-readonly.mjs    # API 冒烟测试（9 个断言）
├── migrations/0001_init.sql  # 初始化 SQL
├── .deploy/                  # one-click 部署体系（8 脚本 + 2 定时任务）
├── .github/workflows/        # CI/CD 部署流水线
├── .deploy-mode              # "workers"
├── .dev.vars.example         # 本地开发环境变量模板
├── package.json / wrangler.jsonc / tsconfig.json / vitest.config.ts
└── README.md
```

## 环境变量

| 变量 | 必须 | 说明 |
|------|:----:|------|
| `TURSO_URL` | ✅ | Turso 数据库 URL |
| `TURSO_TOKEN` | ✅ | Turso 认证 Token |
| `ADMIN_TOKEN` | ✅ | 管理端 API 认证 Token |
| `APP_ORIGIN` | 可选 | 站点域名（SEO canonical） |
| `RATE_LIMIT_SALT` | 可选 | 限流盐值 |

## 冒烟测试

```bash
BASE_URL=https://dtc.eforge.xyz node scripts/smoke-readonly.mjs
```

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 边缘计算，全球低延迟 |
| 框架 | Hono | 轻量高性能 |
| 数据库 | Turso (libSQL) | SQLite 兼容，Free 9GB |
| ORM | Drizzle ORM | 类型安全，防 SQL 注入 |
| 共享内核 | @eforge/cf-core | 认证/安全/限流/缓存/日志 |
| 静态页面 | Workers Assets | 自动生成 19,000+ SEO 页 |