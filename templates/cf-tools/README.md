# cf-tools — 在线工具集模板

> 部署模式：**workers**（Cloudflare Workers + Static Assets）
> 集成 `@eforge/cf-core` 共享内核，复制后改配置即可上线。
> 详细文档：[产品模板使用指南](../docs/002_产品模板使用指南.md) | [踩坑记录](../docs/003_端到端部署踩坑记录.md) | [深度审计](../docs/004_五大模板深度审计与优化方案.md)

## 快速开始

```bash
cp -r templates/cf-tools your-project-name
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
cf-tools/
├── src/
│   ├── index.ts              # Worker 入口（bootstrap 工厂）
│   ├── bindings.ts           # 环境变量类型（extends CoreBindings）
│   ├── config.ts             # ★ 业务配置（站点/认证/限流/工具列表）
│   ├── db/schema.ts          # 数据库 Schema（5 公共表 + 3 业务表）
│   ├── routes/               # health / auth / tools / admin
│   └── services/
│       ├── auth-service.ts   # JWT 认证
│       └── tools/            # ToolDriver 接口 + registry + 示例工具
├── public/                   # index.html（工具卡片 Hub）+ admin.html + _headers
├── migrations/0001_init.sql
├── scripts/                  # migrate.mjs + smoke 测试
├── .deploy/                  # one-click.sh 部署脚本体系（8 个脚本 + 3 个 workflow）
├── .deploy-mode              # "workers"
├── package.json / tsconfig.json / wrangler.jsonc
└── .gitignore
```

## API 接口

**公共**：`GET /api/health` · `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`

**工具**：`GET /api/tools` · `POST /api/tools/:slug/run`（可选 JWT 认证）

**管理（ADMIN_TOKEN）**：用户管理 · 工具 CRUD · 统计概览 · 使用日志

## 添加新工具（3 步）

```typescript
// 1. 实现 ToolDriver 接口（src/services/tools/your-tool.ts）
export const yourTool: ToolDriver = {
  name: "your-tool",
  description: "你的工具描述",
  async run(input, ctx) { /* ... */ return { result: "..." }; }
};

// 2. 注册到 registry.ts
import { yourTool } from "./your-tool";
toolRegistry.register(yourTool);

// 3. 通过管理后台或 SQL 添加工具元数据
```

## 环境变量

| 变量 | 必须 | 说明 |
|------|:----:|------|
| `TURSO_URL` | ✅ | Turso 数据库 URL |
| `TURSO_TOKEN` | ✅ | Turso 认证 Token |
| `JWT_SECRET` | ✅ | JWT 签名密钥（至少 32 字符） |
| `ADMIN_TOKEN` | ✅ | 管理端 API 认证 Token |
| `TURNSTILE_SECRET_KEY` | 可选 | Turnstile 人机验证 |
| `RATE_LIMIT_SALT` | 可选 | 限流盐值 |
| `ENCRYPTION_KEY` | 可选 | AES-256 加密密钥（64 hex） |

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 边缘计算，全球低延迟 |
| 框架 | Hono | 轻量高性能 |
| 数据库 | Turso (libSQL) | SQLite 兼容，Free 9GB |
| ORM | Drizzle ORM | 类型安全 |
| 共享内核 | @eforge/cf-core | 认证/安全/限流/缓存/日志 |
| 前端 | 原生 HTML/JS（工具卡片）+ Vue 3 + Element Plus（管理后台） | — |

## 冒烟测试

```bash
BASE_URL=https://your-worker.workers.dev npm run smoke:readonly
```
