# {{TEMPLATE_NAME}} — {{TEMPLATE_DESCRIPTION}}

> 部署模式：**{{DEPLOY_MODE}}**（{{DEPLOY_MODE_DESCRIPTION}}）
> 集成 `@usethink/cf-core` 共享内核，复制后改配置即可上线

## 快速开始（30 分钟从模板到生产）

### 1. 复制模板

```bash
cp -r templates/{{TEMPLATE_DIR}} your-project-name
cd your-project-name
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

创建 `.dev.vars` 文件（本地开发）：

```env
{{ENV_VARS_LOCAL}}
```

### 4. 初始化数据库

```bash
{{DB_INIT_COMMAND}}
```

### 5. 本地开发

```bash
npm run dev
# 访问 http://localhost:8787
{{DEV_EXTRA_INFO}}
```

### 6. 部署

```bash
# 一键部署（推荐）
CLOUDFLARE_API_TOKEN="cfat_xxx" {{ONE_CLICK_EXTRA}}bash .deploy/one-click.sh

# 或手动部署
{{MANUAL_DEPLOY_STEPS}}
```

## 项目结构

```
{{TEMPLATE_DIR}}/
├── src/
│   ├── index.ts              # Worker 入口（bootstrap 工厂）
│   ├── bindings.ts           # 环境变量类型定义
│   ├── config.ts             # 业务配置（用户主要修改此文件）
│   ├── db/
│   │   └── schema.ts         # 数据库 Schema（公共表 + 业务表）
│   ├── routes/
{{ROUTES_LIST}}
│   └── services/
{{SERVICES_LIST}}
├── public/
{{PUBLIC_FILES}}
├── migrations/
│   └── 0001_init.sql         # 数据库初始化 SQL
├── scripts/
│   ├── migrate.mjs           # 数据库迁移
│   └── smoke-readonly.mjs    # 冒烟测试
├── .deploy/                  # 部署脚本（one-click.sh 等）
├── .deploy-mode              # 部署模式标识（{{DEPLOY_MODE}}）
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── .gitignore
```

## API 接口

### 公共接口

| 方法 | 路径 | 说明 |
|------|------|------|
{{PUBLIC_API_LIST}}

### 管理接口（需 ADMIN_TOKEN）

| 方法 | 路径 | 说明 |
|------|------|------|
{{ADMIN_API_LIST}}

## 配置说明

### 环境变量（Secrets）

| 变量 | 必须 | 说明 |
|------|------|------|
{{ENV_VARS_TABLE}}

### 业务配置（src/config.ts）

{{CONFIG_DESCRIPTION}}

## 自定义指南

{{CUSTOMIZATION_GUIDE}}

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 边缘计算，全球低延迟 |
| 框架 | Hono | 轻量高性能 Web 框架 |
| 数据库 | {{DB_TYPE}} | {{DB_DESCRIPTION}} |
| ORM | Drizzle ORM | 类型安全，零运行时开销 |
| 共享内核 | @usethink/cf-core | 统一基础设施 |
| 前端 | {{FRONTEND_STACK}} | {{FRONTEND_DESCRIPTION}} |

## CI/CD

推送到 `main` 分支自动部署：

```
install → type-check → test → migrate → deploy → smoke
```

需要配置的 GitHub Secrets：
- `CLOUDFLARE_API_TOKEN`
{{CI_SECRETS_LIST}}

## 冒烟测试

```bash
# 只读测试（安全在生产运行）
BASE_URL=https://your-worker.workers.dev npm run smoke:readonly

{{SMOKE_EXTRA}}
```

## 许可证

Private — 内部使用
