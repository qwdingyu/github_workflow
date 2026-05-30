# eForge Monorepo 项目上下文

## 项目结构
```
/eforge/
├── packages/
│   └── cf-core/          ← 共享基础设施层（5 张公共表 + 工具函数）
├── templates/
│   ├── cf-shop/          ← 发卡商城模板
│   ├── cf-tools/         ← 在线工具集模板
│   ├── cf-api/           ← API 中间层模板
│   ├── cf-form/          ← 动态表单模板
│   └── cf-static/        ← SEO 静态站点模板
├── dtc/                  ← DTC 故障码查询（独立项目）
├── eshop/                ← 子模块（旧版商城）
├── scripts/              ← 工具脚本
└── docs/                 ← 文档
```

## 核心架构规则

### cf-core 职责
cf-core 只包含**基础设施**，不含任何业务逻辑：
- 5 张公共表：systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys, apiKeys
- http 工具、安全、缓存、限流、幂等、审计、日志、加解密、认证、中间件
- `bootstrap()` 工厂函数

### 业务项目职责
业务项目从 cf-core 导入公共表，添加自己的业务表：
- `export { systemConfig, ... } from "@eforge/cf-core/db/schema"`
- 业务表（如 products, orders, users, tools, dtcCodes）只定义在本项目中

### 安装依赖
所有安装必须使用 `pnpm`，禁止 npm/yarn。

## 已知遗留问题
- dtc 项目使用了 cf-core 的 bootstrap 但未导入 5 张公共表（架构偏离）
- eshop 子模块未拉取代码，待检查 schema.ts 合规性

## 关键文档
- `docs/ARCHITECTURE_ENFORCEMENT.md` — 完整架构规则
- `AGENTS.md` — AI 工作规范
