# cf-shop — 发卡商城模板

> 部署模式：**workers**（Cloudflare Workers + Static Assets）
> 集成 `@eforge/cf-core` 共享内核，复制后改配置即可上线。
> 详细文档：[产品模板使用指南](../docs/002_产品模板使用指南.md) | [踩坑记录](../docs/003_端到端部署踩坑记录.md) | [深度审计](../docs/004_五大模板深度审计与优化方案.md)

## 快速开始

```bash
cp -r templates/cf-shop your-project-name
cd your-project-name
npm install
npm run db:migrate
npm run dev                    # http://localhost:8787 | 管理后台 /admin
```

一键部署：

```bash
CLOUDFLARE_API_TOKEN="cfat_xxx" TURSO_API_TOKEN="turso_xxx" bash .deploy/one-click.sh
```

## 项目结构

```
cf-shop/
├── src/
│   ├── index.ts              # Worker 入口（bootstrap 工厂）
│   ├── bindings.ts           # 环境变量类型（extends CoreBindings）
│   ├── config.ts             # ★ 业务配置（用户主要修改此文件）
│   ├── db/schema.ts          # 数据库 Schema（5 公共表 + 8 业务表）
│   ├── routes/               # health / products / orders / admin
│   └── services/             # product / order / issue / payments
├── public/                   # index.html + admin.html + _headers
├── migrations/0001_init.sql
├── scripts/                  # migrate.mjs + smoke 测试
├── .deploy/                  # one-click.sh 部署脚本体系（8 个脚本 + 3 个 workflow）
├── .deploy-mode              # "workers"
├── package.json / tsconfig.json / wrangler.jsonc
└── .gitignore
```

## API 接口

**公共**：`GET /api/health` · `GET /api/products` · `GET /api/products/:slug` · `POST /api/orders` · `GET /api/orders/lookup`

**管理（ADMIN_TOKEN）**：商品 CRUD · 卡密导入/列表 · 订单确认/取消 · 系统配置

## 环境变量

| 变量 | 必须 | 说明 |
|------|:----:|------|
| `TURSO_URL` | ✅ | Turso 数据库 URL |
| `TURSO_TOKEN` | ✅ | Turso 认证 Token |
| `ADMIN_TOKEN` | ✅ | 管理后台访问令牌 |
| `ENCRYPTION_KEY` | ✅ | AES-256 加密密钥（64 hex） |
| `TURNSTILE_SECRET_KEY` | 可选 | Turnstile 人机验证 |
| `RATE_LIMIT_SALT` | 可选 | 限流盐值 |
| `ALIPAY_APP_ID/PRIVATE_KEY/PUBLIC_KEY` | 可选 | 支付宝当面付 |

## 自定义指南

- **添加支付方式**：实现 `PaymentProvider` 接口 → 注册到 `registry.ts`
- **修改商品分类**：编辑 `src/config.ts` 的 `PRODUCT_CATEGORIES`
- **修改邮件模板**：编辑 `src/services/email/templates/`

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 边缘计算，全球低延迟 |
| 框架 | Hono | 轻量高性能 |
| 数据库 | Turso (libSQL) | SQLite 兼容，Free 9GB |
| ORM | Drizzle ORM | 类型安全 |
| 共享内核 | @eforge/cf-core | 统一基础设施 |
| 前端 | 原生 HTML/JS（首页）+ Vue 3 + Element Plus（管理后台） | — |

## 冒烟测试

```bash
BASE_URL=https://your-worker.workers.dev npm run smoke:readonly
BASE_URL=https://your-worker.workers.dev ADMIN_TOKEN=xxx npm run smoke:admin
```
