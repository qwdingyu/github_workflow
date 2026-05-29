# cf-shop — 发卡商城模板

基于 Cloudflare Workers + Turso + Hono 的自动发卡商城模板。集成 `@eforge/cf-core` 共享内核，复制后改配置即可上线。

## 快速开始

### 1. 复制模板

```bash
# 从模板复制到新项目
cp -r templates/cf-shop your-project/
cd your-project
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
ADMIN_TOKEN=your-admin-token
TURNSTILE_SECRET_KEY=your-turnstile-secret
RATE_LIMIT_SALT=random-salt-string
ENCRYPTION_KEY=32-byte-hex-key-for-encryption
```

### 4. 数据库迁移

```bash
npm run db:migrate
```

### 5. 本地开发

```bash
npm run dev
# 访问 http://localhost:8787
# 管理后台 http://localhost:8787/admin
```

### 6. 部署

```bash
# 一键部署
chmod +x scripts/deploy.sh
./scripts/deploy.sh

# 或手动部署
npm run deploy
```

部署后设置 Secret 变量：

```bash
wrangler secret put TURSO_URL
wrangler secret put TURSO_TOKEN
wrangler secret put ADMIN_TOKEN
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put RATE_LIMIT_SALT
```

## 配置清单

### 必须修改

| 配置项 | 位置 | 说明 |
|--------|------|------|
| `TURSO_URL` | Secret | Turso 数据库 URL |
| `TURSO_TOKEN` | Secret | Turso 认证 Token |
| `ADMIN_TOKEN` | Secret | 管理后台访问令牌 |
| `APP_ORIGIN` | wrangler.jsonc | 站点域名 |

### 可选配置

| 配置项 | 位置 | 说明 |
|--------|------|------|
| `TURNSTILE_SECRET_KEY` | Secret | Cloudflare Turnstile 人机验证 |
| `RATE_LIMIT_SALT` | Secret | 限流哈希盐值 |
| `ENCRYPTION_KEY` | Secret | 敏感数据加密密钥（32字节 hex） |
| `ALIPAY_APP_ID` | Secret | 支付宝应用 ID |
| `ALIPAY_PRIVATE_KEY` | Secret | 支付宝 RSA2 私钥 |
| `ALIPAY_PUBLIC_KEY` | Secret | 支付宝公钥 |
| `SMTP_HOST` | Secret | SMTP 服务器地址 |
| `SMTP_USER` | Secret | SMTP 用户名 |
| `SMTP_PASS` | Secret | SMTP 密码 |

### 业务配置

编辑 `src/config.ts` 修改：
- 商品分类
- 支付方式
- 邮件模板
- 缓存策略

## 项目结构

```
cf-shop/
├── src/
│   ├── index.ts            # Worker 入口（bootstrap 工厂）
│   ├── bindings.ts         # 环境变量类型
│   ├── config.ts           # 业务配置（用户主要修改此文件）
│   ├── db/
│   │   └── schema.ts       # 数据库表定义
│   ├── routes/
│   │   ├── health.ts       # 健康检查
│   │   ├── products.ts     # 商品列表/详情
│   │   ├── orders.ts       # 订单创建/查询
│   │   └── admin.ts        # 管理后台 API
│   └── services/
│       ├── product-service.ts  # 商品查询逻辑
│       ├── order-service.ts    # 订单创建/查询/过期
│       ├── issue-service.ts    # 卡密发放（原子操作）
│       └── payments/
│           ├── types.ts        # 支付接口定义
│           ├── registry.ts     # 支付提供者注册表
│           └── alipay.ts       # 支付宝实现
├── public/
│   ├── index.html          # 商城首页（暗色主题）
│   ├── admin.html          # 管理后台（Vue 3 + Element Plus）
│   └── _headers            # Cloudflare 响应头
├── migrations/
│   └── 0001_init.sql       # 初始化 SQL
├── scripts/
│   ├── deploy.sh           # 一键部署
│   ├── migrate.mjs         # 数据库迁移
│   └── smoke-readonly.mjs  # 冒烟测试
├── .github/workflows/
│   └── deploy.yml          # CI/CD 流水线
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── .gitignore
```

## API 接口

### 公共接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/products` | 商品列表 |
| GET | `/api/products/:slug` | 商品详情 |
| POST | `/api/orders` | 创建订单 |
| GET | `/api/orders/lookup` | 订单查询 |

### 管理接口（需 ADMIN_TOKEN）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/products` | 商品列表 |
| POST | `/api/admin/products` | 创建商品 |
| PUT | `/api/admin/products/:id` | 更新商品 |
| DELETE | `/api/admin/products/:id` | 删除商品 |
| GET | `/api/admin/cards` | 卡密列表 |
| POST | `/api/admin/cards/import` | 导入卡密 |
| GET | `/api/admin/orders` | 订单列表 |
| POST | `/api/admin/orders/:id/confirm` | 确认订单 |
| POST | `/api/admin/orders/:id/cancel` | 取消订单 |

## 冒烟测试

```bash
# 只读测试（安全在生产运行）
BASE_URL=https://your-worker.workers.dev npm run smoke:readonly

# 管理端测试（需 ADMIN_TOKEN）
BASE_URL=https://your-worker.workers.dev ADMIN_TOKEN=xxx npm run smoke:admin
```

## 技术栈

- **运行时**: Cloudflare Workers
- **框架**: Hono
- **数据库**: Turso (libSQL) + Drizzle ORM
- **前端**: 原生 HTML/JS（首页）+ Vue 3 + Element Plus（管理后台）
- **支付**: 支付宝当面付（RSA2 签名）
- **共享内核**: @eforge/cf-core

## License

MIT
