# cf-form-kit — 表单收集微型模板

> 部署模式：**workers**（Cloudflare Workers + D1）
> 独立自包含模板，不依赖 `@eforge/cf-core`。
> 详细文档：[产品模板使用指南](../docs/002_产品模板使用指南.md) | [踩坑记录](../docs/003_端到端部署踩坑记录.md) | [深度审计](../docs/004_五大模板深度审计与优化方案.md)

## 适用场景

- 表单收集、信息收集、轻交互
- 落地页、邀请页、活动报名

## 快速开始

```bash
cp -r templates/cf-form-kit your-form-app
cd your-form-app
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev                    # http://localhost:8787
```

部署：

```bash
CLOUDFLARE_API_TOKEN="<token>" npm run deploy:full
```

## 项目结构

```
cf-form-kit/
├── src/
│   ├── index.ts              # Worker 入口
│   ├── bindings.ts           # 环境变量类型
│   ├── config/forms.ts       # ★ 表单配置（用户主要修改此文件）
│   ├── db/
│   │   ├── client.ts         # D1 客户端
│   │   └── schema.ts         # Drizzle Schema
│   ├── lib/                  # 独立实现的基础设施（http/security/rate-limit/idempotency）
│   └── routes/               # health / forms / admin
├── public/                   # index.html + styles.css + app.js + _headers
├── migrations/0001_init.sql
├── scripts/                  # check / deploy-full / smoke 测试
├── package.json / tsconfig.json / wrangler.jsonc
└── .gitignore
```

## API 接口

**公共**：`GET /api/health` · `GET /api/forms/:slug` · `POST /api/forms/:slug/submissions`

**管理（ADMIN_TOKEN）**：`GET /api/admin/submissions`

## 环境变量

| 变量 | 必须 | 说明 |
|------|:----:|------|
| `ADMIN_TOKEN` | ✅ | 管理端 API 认证 Token |
| `TURNSTILE_SECRET_KEY` | 可选 | Turnstile 人机验证 |
| `RATE_LIMIT_SALT` | 可选 | 限流盐值 |

## 业务修改入口

优先改：

```text
src/config/forms.ts       ← 表单字段定义
public/index.html         ← 页面结构
public/styles.css         ← 样式
wrangler.jsonc            ← name / database_name / vars
```

不要优先改 `src/lib/*`、`scripts/*`、`migrations/`，除非业务确实需要扩展底层能力。

## 安全默认值

1. POST 提交走 Zod 校验 + `src/config/forms.ts` 二次校验
2. 如果配置 `TURNSTILE_SECRET_KEY`，则提交必须通过 Turnstile
3. 每 IP 每表单每分钟默认最多 5 次提交
4. 支持 `Idempotency-Key`，避免重复提交
5. 管理接口必须 `ADMIN_TOKEN`
6. `public/_headers` 提供基础安全响应头

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 边缘计算 |
| 框架 | Hono | 轻量高性能 |
| 数据库 | Cloudflare D1 | SQLite 兼容，Free 500MB |
| ORM | Drizzle ORM | 类型安全 |
| 校验 | Zod + @hono/zod-validator | 类型安全校验 |
| 前端 | 原生 HTML/JS/CSS | 无框架依赖 |

## 何时引入更多能力

```text
需要文件下载  → 加 R2 私有下载
需要支付      → 加支付回调签名和订单幂等
需要复杂后台  → 先加只读 admin API
表超过 5 张   → 引入 drizzle-kit 生成迁移
```

## 冒烟测试

```bash
BASE_URL=https://your-worker.workers.dev npm run smoke:readonly
BASE_URL=https://your-worker.workers.dev npm run smoke:write    # 会写入一条 submission
```
