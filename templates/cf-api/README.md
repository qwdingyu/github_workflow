# cf-api — API 中间层服务模板

> 部署模式：**workers**（Cloudflare Workers + Static Assets）
> 集成 `@eforge/cf-core` 共享内核，复制后改配置即可上线。
> 详细文档：[产品模板使用指南](../docs/002_产品模板使用指南.md) | [踩坑记录](../docs/003_端到端部署踩坑记录.md) | [深度审计](../docs/004_五大模板深度审计与优化方案.md)

## 快速开始

```bash
cp -r templates/cf-api your-project-name
cd your-project-name
npm install
npm run db:migrate
npm run dev                    # http://localhost:8787
```

一键部署：

```bash
CLOUDFLARE_API_TOKEN="cfat_xxx" TURSO_API_TOKEN="turso_xxx" bash .deploy/one-click.sh
```

## 项目结构

```
cf-api/
├── src/
│   ├── index.ts              # Worker 入口（bootstrap 工厂）
│   ├── bindings.ts           # 环境变量类型（extends CoreBindings）
│   ├── config.ts             # ★ 业务配置（服务类型/状态机/超时）
│   ├── db/schema.ts          # 数据库 Schema（5 公共表 + 5 业务表）
│   ├── routes/               # health / tokens / user / admin
│   ├── services/             # token-service / handlers/
│   └── channels/             # ChannelAdapter 接口 + manager
├── public/                   # index.html（API 文档）+ admin.html + _headers
├── migrations/0001_init.sql
├── scripts/                  # migrate.mjs + smoke 测试
├── .deploy/                  # one-click.sh 部署脚本体系（8 个脚本 + 3 个 workflow）
├── .deploy-mode              # "workers"
├── package.json / tsconfig.json / wrangler.jsonc
└── .gitignore
```

## API 接口

**API Key 认证**：`POST /api/tokens/generate` · `GET /api/tokens/:id` · `POST /api/tokens/:id/use` · `GET /api/tokens/:id/check` · `POST /api/tokens/:id/release`

**公开（限流）**：`GET /api/user/tokens/:id` · `POST /api/user/tokens/:id/use` · `GET /api/user/tokens/:id/check`

**管理（ADMIN_TOKEN）**：渠道管理 · 凭证列表/导出 · Webhook 管理 · API Key 管理 · 统计

## Token 状态机

```
unused ──→ pending ──→ active ──→ completed
  │           │            ├──→ failed
  ├──→ expired（惰性清理）  └──→ released（手动释放）
```

## 环境变量

| 变量 | 必须 | 说明 |
|------|:----:|------|
| `TURSO_URL` | ✅ | Turso 数据库 URL |
| `TURSO_TOKEN` | ✅ | Turso 认证 Token |
| `ADMIN_TOKEN` | ✅ | 管理端 API 认证 Token |
| `CREDENTIALS_ENCRYPTION_KEY` | ✅ | AES-256 加密密钥（64 hex） |
| `TURNSTILE_SECRET_KEY` | 可选 | Turnstile 人机验证 |
| `RATE_LIMIT_SALT` | 可选 | 限流盐值 |

## 自定义指南

- **添加服务类型**：实现 `ServiceHandler` 接口 → 注册到 `handlers/registry.ts`
- **添加渠道**：实现 `ChannelAdapter` 接口 → 注册到 `channels/manager.ts`
- **修改认证**：`createApiKeyAuth({ prefix: "your_" })` 修改 API Key 前缀

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 边缘计算，全球低延迟 |
| 框架 | Hono | 轻量高性能 |
| 数据库 | Turso (libSQL) | SQLite 兼容，Free 9GB |
| ORM | Drizzle ORM | 类型安全 |
| 共享内核 | @eforge/cf-core | 统一基础设施 |
| 前端 | 原生 HTML/JS（API 文档）+ Vue 3 + Element Plus（管理后台） | — |

## 冒烟测试

```bash
BASE_URL=https://your-worker.workers.dev npm run smoke:readonly
```
