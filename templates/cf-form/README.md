# cf-form — JSON 驱动动态表单系统

> 部署模式：**workers**（Cloudflare Workers + Turso）
> 集成 `@eforge/cf-core` 共享内核，管理后台可视化编辑表单定义，用户端动态渲染。
> 详细文档：[产品模板使用指南](../docs/002_产品模板使用指南.md) | [踩坑记录](../docs/003_端到端部署踩坑记录.md) | [架构设计](../docs/006_cf-form架构设计_JSON驱动动态表单.md)

## 快速开始

```bash
cp -r templates/cf-form your-form-project
cd your-form-project
npm install
npm run db:migrate
npm run dev                    # http://localhost:8787 | 管理后台 /admin.html
```

一键部署：

```bash
CLOUDFLARE_API_TOKEN="cfat_xxx" TURSO_API_TOKEN="turso_xxx" bash .deploy/one-click.sh
```

## 项目结构

```
cf-form/
├── src/
│   ├── index.ts              # Worker 入口（bootstrap 工厂）
│   ├── bindings.ts           # 环境变量类型（FormBindings）
│   ├── config/forms.ts       # 字段类型定义 + 验证逻辑
│   ├── db/
│   │   ├── client.ts         # Turso + Drizzle ORM
│   │   └── schema.ts         # DB Schema（forms + submissions + 公共表）
│   └── routes/
│       ├── health.ts         # 健康检查
│       ├── forms.ts          # 表单获取 + 提交（限流 + Turnstile + 幂等）
│       └── admin.ts          # 管理端（表单 CRUD + 提交记录）
├── public/
│   ├── index.html            # 用户端（动态渲染表单）
│   ├── admin.html            # 管理后台（Vue 3 + Element Plus）
│   ├── app.js                # 表单渲染器（支持 12 种字段类型）
│   ├── styles.css            # 样式
│   └── _headers              # Cloudflare 响应头
├── migrations/0001_init.sql  # 数据库初始化
├── seed.sql                  # 种子数据（联系表单示例）
├── scripts/                  # check / smoke / deploy 脚本
├── .deploy/                  # one-click.sh 部署脚本体系
├── .deploy-mode              # "workers"
├── package.json / tsconfig.json / wrangler.jsonc
└── .gitignore
```

## API 接口

**公开**：`GET /api/forms/:slug` · `POST /api/forms/:slug/submissions`

**管理（ADMIN_TOKEN）**：表单 CRUD · 提交记录 · CSV 导出

## 表单定义 JSON Schema

```json
{
  "type": "text",
  "key": "name",
  "label": "姓名",
  "placeholder": "请输入姓名",
  "required": true,
  "validation": { "min": 2, "max": 50 }
}
```

支持字段类型：text / email / textarea / select / radio / checkbox / number / date / hidden / divider / heading

## 环境变量

| 变量 | 必须 | 说明 |
|------|:----:|------|
| `TURSO_URL` | ✅ | Turso 数据库 URL |
| `TURSO_TOKEN` | ✅ | Turso 认证 Token |
| `ADMIN_TOKEN` | ✅ | 管理后台访问令牌 |
| `TURNSTILE_SECRET_KEY` | 可选 | Turnstile 人机验证 |
| `RATE_LIMIT_SALT` | 可选 | 限流盐值 |

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 边缘计算 |
| 框架 | Hono | 轻量高性能 |
| 数据库 | Turso (libSQL) | SQLite 兼容，Free 9GB |
| ORM | Drizzle ORM | 类型安全 |
| 共享内核 | @eforge/cf-core | 统一基础设施 |
| 管理后台 | Vue 3 + Element Plus CDN | 表单编辑器 |

## 冒烟测试

```bash
BASE_URL=https://your-worker.workers.dev npm run smoke:readonly
BASE_URL=https://your-worker.workers.dev npm run smoke:write
```
