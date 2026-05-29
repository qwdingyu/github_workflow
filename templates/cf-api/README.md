# CF-API — API 中间层服务模板

基于 Cloudflare Workers + @eforge/cf-core 的标准化 API 中间层服务模板。
新项目复制此模板后，改配置即可上线，**30 分钟内从模板到生产**。

## 架构

```
┌─────────────────────────────────────────────┐
│              Cloudflare Workers              │
│  ┌────────────────────────────────────────┐  │
│  │  bootstrap()（@eforge/cf-core）         │  │
│  │  ├─ DB 初始化中间件                     │  │
│  │  ├─ 请求体限制                          │  │
│  │  ├─ 安全响应头                          │  │
│  │  └─ 全局错误处理                        │  │
│  ├────────────────────────────────────────┤  │
│  │  API 路由                              │  │
│  │  ├─ /api/health      健康检查           │  │
│  │  ├─ /api/tokens/*    凭证管理(API Key)  │  │
│  │  ├─ /api/user/*      公开用户端(限流)   │  │
│  │  └─ /api/admin/*     管理端(Admin Token)│  │
│  ├────────────────────────────────────────┤  │
│  │  业务层                                │  │
│  │  ├─ TokenService     凭证生命周期       │  │
│  │  ├─ ServiceHandler   服务处理器接口     │  │
│  │  └─ ChannelAdapter   渠道适配器接口     │  │
│  └────────────────────────────────────────┘  │
│                    │                         │
│              Turso (libSQL)                   │
└─────────────────────────────────────────────┘
```

## 快速开始

### 1. 复制模板

```bash
cp -r templates/cf-api your-project/
cd your-project
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

创建 `.dev.vars` 文件（本地开发用，不会提交到 Git）：

```env
TURSO_URL=libsql://your-db.turso.io
TURSO_TOKEN=your-turso-token
ADMIN_TOKEN=your-admin-token
CREDENTIALS_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

### 4. 初始化数据库

```bash
npm run db:migrate
```

### 5. 本地开发

```bash
npm run dev
# 访问 http://localhost:8787
```

### 6. 部署

```bash
# 配置 Secrets
wrangler secret put TURSO_URL
wrangler secret put TURSO_TOKEN
wrangler secret put ADMIN_TOKEN
wrangler secret put CREDENTIALS_ENCRYPTION_KEY

# 部署
npm run deploy
```

## 目录结构

```
cf-api/
├── src/
│   ├── index.ts              # Worker 入口（bootstrap 工厂）
│   ├── bindings.ts           # 环境变量类型定义
│   ├── config.ts             # 业务配置（服务类型/状态机/超时）
│   ├── db/
│   │   └── schema.ts         # 数据库 Schema（公共表 + 业务表）
│   ├── routes/
│   │   ├── health.ts         # 健康检查
│   │   ├── tokens.ts         # 凭证管理（需 API Key）
│   │   ├── user.ts           # 公开用户端
│   │   └── admin.ts          # 管理端
│   ├── services/
│   │   ├── token-service.ts  # 凭证生命周期管理
│   │   └── handlers/
│   │       ├── types.ts      # ServiceHandler 接口
│   │       └── registry.ts   # Handler 注册表
│   └── channels/
│       ├── types.ts          # ChannelAdapter 接口
│       └── manager.ts        # 渠道管理器（故障转移）
├── public/
│   ├── index.html            # API 文档页
│   ├── admin.html            # 管理后台（Vue 3 + Element Plus）
│   └── _headers              # 安全响应头
├── migrations/
│   └── 0001_init.sql         # 数据库初始化 SQL
├── scripts/
│   ├── deploy.sh             # 部署脚本
│   ├── migrate.mjs           # 数据库迁移
│   └── smoke-readonly.mjs    # 冒烟测试
├── .github/workflows/
│   └── deploy.yml            # CI/CD 流水线
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── .gitignore
```

## Token 状态机

```
  unused ──→ pending ──→ active ──→ completed
    │                        │
    │                        └──→ failed
    │
    └──→ expired（惰性清理）
    └──→ released（手动释放）
```

## 自定义指南

### 添加新服务类型

1. 在 `src/config.ts` 的 `SERVICE_TYPES` 数组中添加类型
2. 实现 `ServiceHandler` 接口（`src/services/handlers/`）
3. 在 `registry.ts` 中注册

### 添加新渠道

1. 实现 `ChannelAdapter` 接口（`src/channels/adapters/`）
2. 在 `manager.ts` 中注册
3. 通过管理后台添加渠道配置

### 修改认证方式

- API Key 前缀：`src/routes/tokens.ts` 中 `createApiKeyAuth({ prefix: "cfapi_" })`
- 管理员认证：`src/routes/admin.ts` 中 `createAdminAuth({ mode: "both" })`

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 边缘计算，全球低延迟 |
| 框架 | Hono | 轻量高性能 Web 框架 |
| 数据库 | Turso (libSQL) | SQLite 兼容，边缘复制 |
| ORM | Drizzle | 类型安全，零运行时开销 |
| 共享内核 | @eforge/cf-core | 统一基础设施 |

## 许可证

私有项目，未公开。
