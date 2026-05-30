# eForge 架构强制体系 — 完整文档

> 所有 AI 代理（Claude / Cursor / Qwen / Codex）在操作本项目之前必须阅读本文档。
> 本文档是架构规则的**唯一权威来源**。

---

## 1. 为什么需要架构强制？

在 AI 辅助开发中，**AI 没有「架构记忆」**。每次会话都是全新的上下文。如果不强制加载规则，AI 会：
- 在 cf-core 中随意添加业务表
- 新项目从零写 schema.ts，忽略公共表
- 用 npm 而非 pnpm 安装依赖
- 逐步腐蚀初始的架构设计

dtc 项目就是活生生的例子：用了 cf-core 的 bootstrap 但没导入 5 张公共表。

---

## 2. 五层强制体系

```
┌──────────────────────────────────────────────────┐
│  Layer 1: AI Boot-Load（会话启动时自动加载）       │
│  ├── CLAUDE.md        → Claude Code               │
│  ├── CONTEXT.md       → 所有 AI 代理              │
│  ├── AGENTS.md        → 通用 AI 指令              │
│  └── .cursorrules     → Cursor IDE                │
├──────────────────────────────────────────────────┤
│  Layer 2: 程序化验证（每次操作前强制运行）           │
│  ├── scripts/validate-architecture.mjs             │
│  └── CLAUDE.md 中写死：必须先运行验证再写代码       │
├──────────────────────────────────────────────────┤
│  Layer 3: Git Pre-commit Hook（提交时阻断违规）     │
│  ├── .githooks/pre-commit                          │
│  └── 配置：git config core.hooksPath .githooks     │
├──────────────────────────────────────────────────┤
│  Layer 4: CI 流水线（PR/Merge 时阻断）              │
│  └── .github/workflows/architecture-check.yml      │
├──────────────────────────────────────────────────┤
│  Layer 5: 创建流程（从源头杜绝）                      │
│  └── scripts/create-project.mjs （模板继承规则）     │
└──────────────────────────────────────────────────┘
```

---

## 3. 核心规则（源代码）

### 规则 1：cf-core 基础设施隔离

**文件**：`packages/cf-core/src/db/schema.ts`

**允许的表（且仅允许这 5 张）**：
| 表名 | 用途 | 所属项目 |
|------|------|---------|
| `systemConfig` | 全局系统配置（KV 键值对） | cf-core |
| `adminAuditLogs` | 管理员操作审计日志 | cf-core |
| `rateLimitWindows` | 限流计数窗口 | cf-core |
| `idempotencyKeys` | 幂等去重键 | cf-core |
| `apiKeys` | API Key 管理与认证 | cf-core |

**禁止行为**：
- ❌ 在 cf-core 中新增业务表（products, orders, users, tools, dtcCodes 等）
- ❌ 在 cf-core 中新增业务相关字段到公共表
- ❌ 在 cf-core 中新增业务路由或业务服务

### 规则 2：业务项目必须导入 cf-core 公共表

**所有使用 `@eforge/cf-core` 且需要数据库的项目**，其 `src/db/schema.ts` 必须包含：

```typescript
export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "@eforge/cf-core/db/schema";
```

**禁止行为**：
- ❌ 在业务项目中重新定义 system_config 表
- ❌ 在业务项目中重新定义 api_keys 表
- ❌ 使用 cf-core 的 bootstrap 但不导入公共表（dtc 的教训）

**例外规则**：
- 不使用数据库的项目（如 cf-static）不需要导入
- 不使用 cf-core 的独立项目可以不导入

### 规则 3：依赖管理

```bash
# ✅ 正确
pnpm install
pnpm install --frozen-lockfile

# ❌ 错误 — 已被 package.json 的 preinstall 脚本硬性阻断
npm install
yarn install
```

### 规则 4：新产品创建

所有新产品**必须**通过 `scripts/create-project.mjs` 从模板创建：
```bash
node scripts/create-project.mjs my-new-shop --template cf-shop
```

模板自动继承架构规则（schema.ts 已有 cf-core 导入）。

**禁止从零写 schema.ts**。

### 规则 5：新增模板

在 `templates/` 下新增模板时，如果有数据库需求，必须在 `src/db/schema.ts` 中包含：
```typescript
export { systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys, apiKeys } from "@eforge/cf-core/db/schema";
```

---

## 4. 验证脚本

```bash
# 运行完整架构验证
node scripts/validate-architecture.mjs

# 预期输出：
# ✅ cf-core schema 检查通过
# ✅ cf-shop schema 检查通过
# ✅ cf-tools schema 检查通过
# ✅ cf-api schema 检查通过
# ✅ cf-form schema 检查通过
# ✅ dtc schema 检查（预期：⚠️ 未导入公共表）
# ✅ pnpm lock 检查通过
```

---

## 5. 修复已知偏离（dtc）

dtc 项目当前状态：
- ✅ 使用了 `@eforge/cf-core/bootstrap`
- ❌ 未导入 5 张公共表
- 影响：无法使用审计日志、限流、幂等、系统配置、API Key

修复步骤：
1. 在 `dtc/src/db/schema.ts` 中添加 `export { ... } from "@eforge/cf-core/db/schema"`
2. 运行 `pnpm install && pnpm run type-check`
3. 确认编译通过
4. 提交修复

---

## 6. 审核流程

| 场景 | 谁审核 | 审核内容 |
|------|--------|---------|
| 新增业务表 | AI 自动检查 | 是否放对了项目 |
| 修改 cf-core schema | 人工 | 是否混入业务字段 |
| 新增模板 | 人工 | schema.ts 是否符合规范 |
| PR 提交 | CI 自动 + 人工 | 架构验证脚本通过 |

---

## 7. 紧急联系

如果发现架构偏离，立即：
1. 回滚修改
2. 运行 `node scripts/validate-architecture.mjs` 查看违规详情
3. 按验证脚本提示修复
4. 提交修复并注明「架构修复」
