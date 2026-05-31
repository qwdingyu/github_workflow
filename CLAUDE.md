# Claude Code 项目规则 — eForge Monorepo

> 本文件在每次 Claude Code 会话启动时自动加载，**必须严格遵守**。

---

## ⚠️ 读我！读我！读我！

在写任何代码之前，**必须先执行**：
```bash
node scripts/validate-architecture.mjs
```

如果架构验证失败，**必须先修复才能继续编码**。

---

## 📐 核心架构铁律（不可违反）

### 铁律 1：cf-core 不得包含任何业务代码

`packages/cf-core/src/db/schema.ts` 只允许 5 张**基础设施表**：
- `systemConfig` — 系统配置
- `adminAuditLogs` — 管理员审计日志
- `rateLimitWindows` — 限流计数窗口
- `idempotencyKeys` — 幂等键
- `apiKeys` — API Key 认证

**严禁**：
- ❌ 添加业务表（products, orders, users, cards, dtcCodes 等）
- ❌ 添加业务路由、业务服务、业务中间件
- ❌ 添加业务相关的字段到公共表中

### 铁律 2：业务项目必须从 cf-core 导入公共表

所有使用 `@eforge/cf-core` 的项目（`templates/*/`），其 `schema.ts` 必须包含：
```typescript
export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "@eforge/cf-core/db/schema";
```

**严禁本地重复定义这 5 张表**。

### 铁律 3：安装依赖必须使用 pnpm

- ✅ `pnpm install`（首次安装）
- ✅ `pnpm install --frozen-lockfile`（CI 环境）
- ❌ 禁止使用 `npm install` 或 `yarn`

### 铁律 4：新产品必须以模板为基础

- 不允许从零写 schema.ts
- 必须使用 `node scripts/create-project.mjs <name> --template <tpl>`

### 铁律 5：修改 schema.ts 必须经过架构评审

- 新增表必须确认是业务表（放在业务项目）还是基础设施表（放在 cf-core）
- 任何时候都不允许在 cf-core 中新增业务表

---

## 📋 提交前检查清单

每次提交前 AI 必须自动验证：
1. [ ] 运行 `node scripts/validate-architecture.mjs` — 架构规则检查
2. [ ] 检查 `cf-core/schema.ts` 是否混入业务表
3. [ ] 检查所有 `templates/*/schema.ts` 是否从 cf-core 导入了公共表
4. [ ] 检查是否存在 `package-lock.json`（npm/yarn 违规标志）
5. [ ] `pnpm-lock.yaml` 必须与 `package.json` 同步

---

## 🔧 实用命令

| 命令 | 用途 |
|------|------|
| `pnpm install` | 安装依赖 |
| `node scripts/validate-architecture.mjs` | 架构验证 |
| `node scripts/create-project.mjs <name> --template <tpl>` | 创建新产品 |
| `pnpm -w packages/cf-core run build` | 构建 cf-core |
| `cd dtc && node scripts/smoke-readonly.mjs` | 验证 dtc 只读接口 |

---

## 🚨 发现架构偏离怎么办？

如果发现某项目未从 cf-core 导入公共表：
1. 在 `src/db/schema.ts` 中添加：

完整架构规则详见：`docs/ARCHITECTURE_ENFORCEMENT.md`
