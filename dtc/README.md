# DTC Lookup — 汽车故障码查询服务

基于 Cloudflare Workers + Turso + Drizzle ORM 的 OBD-II DTC 故障码查询服务。

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 边缘计算，全球低延迟 |
| 框架 | Hono | 轻量高性能 |
| 数据库 | Turso (libSQL) | SQLite 兼容，Free 9GB |
| ORM | Drizzle ORM | 类型安全，防 SQL 注入 |
| 共享内核 | @eforge/cf-core | 认证/安全/限流/缓存/日志 |
| 静态页面 | Cloudflare Pages | 18,000+ SEO 页面 |

## 数据结构

- **18,805** DTC 故障码（含汽车 + 工业）
- **34** 个汽车制造商
- 数据来源：Wal33D/dtc-database（MIT License）+ wzr1337/dtcmapping

## API 接口

```
GET  /api/v1/dtc/{code}                    — 单码查询
GET  /api/v1/dtc/search?q=keyword          — 关键词搜索
POST /api/v1/dtc/batch                     — 批量查询
GET  /api/v1/dtc/stats                     — 统计信息
GET  /api/v1/dtc/by-manufacturer/{mfr}     — 按制造商查询
POST /api/v1/dtc/extract                   — 从文本提取 DTC
GET  /api/v1/dtc/normalize/{code}          — 归一化 DTC 码
GET  /api/v1/manufacturers                 — 制造商列表
GET  /api/health                           — 健康检查
```

## 使用方式

```bash
# 安装依赖
cd dtc && npm install

# 本地开发
npm run dev

# 运行测试
npm test

# 迁移数据库
TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=xxx npm run db:migrate

# 导入 DTC 数据
TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=xxx npm run import:data

# 生成 SEO 页面
TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=xxx SITE_URL=https://dtc.eforge.xyz npm run generate:pages

# 部署
npm run deploy
```

## 环境变量

| 变量 | 必须 | 说明 |
|------|:----:|------|
| TURSO_URL | ✅ | Turso 数据库 URL |
| TURSO_TOKEN | ✅ | Turso 认证 Token |
| APP_ORIGIN | ✅ | 站点域名 |
| ADMIN_TOKEN | 可选 | 管理端认证 Token |
| RATE_LIMIT_SALT | 可选 | 限流盐值 |

## 项目结构

```
dtc/
├── src/
│   ├── index.ts                 # Worker 入口（bootstrap）
│   ├── bindings.ts              # 环境变量类型
│   ├── config.ts                # 业务配置
│   ├── db/schema.ts             # 数据库 Schema
│   ├── routes/health.ts         # 健康检查
│   ├── routes/dtc.ts            # DTC 查询 API 路由
│   └── services/dtc-service.ts  # 核心业务逻辑
├── scripts/
│   ├── import-data.mjs          # 数据导入
│   ├── generate-pages.mjs       # SEO 页面生成
│   └── migrate.mjs              # 数据库迁移
├── public/                      # 静态资源 + 生成的 SEO 页面
├── migrations/                  # SQL 迁移文件
├── package.json / wrangler.jsonc
└── vitest.config.ts
```