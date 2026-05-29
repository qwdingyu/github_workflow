# cf-tools — 在线工具集模板

> 基于 Cloudflare Workers + Hono + Turso + Drizzle ORM 的在线工具集模板。
> 集成 `@eforge/cf-core` 共享内核，复制后改配置即可上线。

## 快速开始（30 分钟从模板到生产）

### 1. 复制模板

```bash
cp -r templates/cf-tools your-project-name
cd your-project-name
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

创建 `.dev.vars` 文件（本地开发）：

```env
TURSO_URL=libsql://your-db.turso.io
TURSO_TOKEN=your-turso-token
JWT_SECRET=your-jwt-secret-at-least-32-chars-long
ADMIN_TOKEN=your-admin-token
```

### 4. 初始化数据库

```bash
# 创建 Turso 数据库（如尚未创建）
turso db create your-tools-db

# 执行迁移（含管理员用户创建）
npm run db:migrate
```

### 5. 本地开发

```bash
npm run dev
# 访问 http://localhost:8787
```

### 6. 部署

```bash
# 设置 Cloudflare Secrets
wrangler secret put JWT_SECRET
wrangler secret put ADMIN_TOKEN
wrangler secret put TURSO_URL
wrangler secret put TURSO_TOKEN

# 部署
npm run deploy
```

## 项目结构

```
cf-tools/
├── src/
│   ├── index.ts              # Worker 入口（bootstrap 工厂）
│   ├── bindings.ts           # 环境变量绑定 & 类型定义
│   ├── config.ts             # 项目配置（用户主要修改此文件）
│   ├── db/
│   │   └── schema.ts         # 数据库 Schema（Drizzle ORM）
│   ├── routes/
│   │   ├── health.ts         # 健康检查
│   │   ├── auth.ts           # 用户认证（注册/登录/JWT）
│   │   ├── tools.ts          # 工具路由（列表/执行）
│   │   └── admin.ts          # 管理端 API
│   └── services/
│       ├── auth-service.ts   # 认证服务
│       └── tools/
│           ├── types.ts      # ToolDriver 接口
│           ├── registry.ts   # 工具注册表
│           └── example-tool.ts  # 示例工具（文本哈希）
├── public/
│   ├── index.html            # 工具卡片 Hub 首页
│   ├── admin.html            # 管理后台（Vue 3 + Element Plus）
│   └── _headers              # 静态资源响应头
├── migrations/
│   └── 0001_init.sql         # 初始化迁移
├── scripts/
│   ├── deploy.sh             # 一键部署脚本
│   ├── migrate.mjs           # 数据库迁移脚本
│   └── smoke-readonly.mjs    # 冒烟测试
└── wrangler.jsonc            # Cloudflare Workers 配置
```

## 如何添加新工具

添加一个新工具只需 **3 步**：

### 步骤 1：实现 ToolDriver 接口

在 `src/services/tools/` 下创建新文件，例如 `json-formatter.ts`：

```typescript
import type { ToolDriver, ToolContext } from "./types";

export const jsonFormatter: ToolDriver = {
  name: "json-formatter", // 必须与数据库 slug 一致
  description: "JSON 格式化工具",

  async run(input, ctx) {
    const text = input.text as string;
    if (!text) throw new Error("请输入 JSON 文本");

    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      return { formatted, valid: true };
    } catch (err) {
      throw new Error(`JSON 解析失败: ${(err as Error).message}`);
    }
  },
};
```

### 步骤 2：在注册表中注册

编辑 `src/services/tools/registry.ts`：

```typescript
import { jsonFormatter } from "./json-formatter";
toolRegistry.register(jsonFormatter);
```

### 步骤 3：添加工具元数据

两种方式任选其一：

**方式 A**：通过管理后台添加（推荐）

访问 `/admin`，在"工具管理"Tab 中点击"创建工具"。

**方式 B**：在迁移 SQL 中添加

```sql
INSERT INTO tools (id, name, slug, description, icon, category, enabled, sort_order, created_at, updated_at)
VALUES (
  '生成一个UUID',
  'JSON 格式化',
  'json-formatter',
  '格式化、压缩、校验 JSON 数据',
  '{}',
  '格式化',
  1,
  90,
  datetime('now'),
  datetime('now')
);
```

同时更新 `src/config.ts` 的 `registeredTools` 数组（用于前端展示配置）。

## API 接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | 无 |
| POST | `/api/auth/register` | 用户注册 | 无 |
| POST | `/api/auth/login` | 用户登录 | 无 |
| GET | `/api/auth/me` | 获取当前用户 | JWT |
| GET | `/api/tools` | 工具列表 | 可选 |
| POST | `/api/tools/:slug/run` | 执行工具 | 可选 |
| GET | `/api/admin/users` | 用户列表 | ADMIN_TOKEN |
| PATCH | `/api/admin/users/:id` | 更新用户 | ADMIN_TOKEN |
| DELETE | `/api/admin/users/:id` | 删除用户 | ADMIN_TOKEN |
| GET | `/api/admin/tools` | 工具列表（含禁用） | ADMIN_TOKEN |
| POST | `/api/admin/tools` | 创建工具 | ADMIN_TOKEN |
| PATCH | `/api/admin/tools/:id` | 更新工具 | ADMIN_TOKEN |
| GET | `/api/admin/stats` | 统计概览 | ADMIN_TOKEN |
| GET | `/api/admin/stats/usage` | 使用日志 | ADMIN_TOKEN |

## 配置说明

### 环境变量（Secrets）

| 变量 | 必须 | 说明 |
|------|------|------|
| `TURSO_URL` | 是 | Turso 数据库连接 URL |
| `TURSO_TOKEN` | 是 | Turso 认证 Token |
| `JWT_SECRET` | 是 | JWT 签名密钥（至少 32 字符） |
| `ADMIN_TOKEN` | 是 | 管理端 API 认证 Token |
| `TURNSTILE_SECRET_KEY` | 否 | Cloudflare Turnstile 人机验证 |
| `RATE_LIMIT_SALT` | 否 | 限流 IP 哈希盐值 |
| `APP_ORIGIN` | 否 | 站点域名 |
| `ENCRYPTION_KEY` | 否 | AES-256-GCM 加密密钥 |

### 项目配置（src/config.ts）

- `siteConfig` — 站点名称、描述、Logo
- `authConfig` — JWT 过期时间、密码策略、是否开放注册
- `rateLimitConfig` — 各接口限流策略
- `registeredTools` — 已注册工具元数据列表

## 技术栈

- **运行时**: Cloudflare Workers（V8 Isolate）
- **框架**: Hono（超轻量 Web 框架）
- **数据库**: Turso（libSQL，SQLite 兼容）
- **ORM**: Drizzle ORM + drizzle-zod
- **共享内核**: @eforge/cf-core（认证/安全/限流/缓存/日志）
- **前端**: 原生 HTML/JS + Vue 3 + Element Plus（管理后台）
- **部署**: Wrangler + GitHub Actions

## CI/CD

推送到 `main` 分支自动部署：

```
install → type-check → test → migrate → deploy → smoke
```

需要配置的 GitHub Secrets：
- `CLOUDFLARE_API_TOKEN`
- `TURSO_URL`
- `TURSO_TOKEN`
- `WRANGLER_SECRETS_JSON`（可选，批量设置 Secrets）

## 许可证

Private — 内部使用
