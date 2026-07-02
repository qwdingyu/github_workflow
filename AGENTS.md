# AGENTS.md — eForge Monorepo AI 开发规约

> 本文件在每次 AI 编码会话启动时自动加载，**所有规则必须严格遵守**。
> 本规约的目的是：**防止 AI 跑偏、重复造轮子、过度设计、闭门造车**，确保每次会话都能高效、安全、一致地推进项目。

---

## 一、📌 项目身份卡

| 项 | 值 |
|---|---|
| 项目名称 | eForge Monorepo — Cloudflare Workers 工具链与模板 |
| 项目类型 | **pnpm monorepo**（workspace 模式） |
| 核心包 | `@usethink/cf-core` — 共享基础设施库（Hono + Drizzle + Turso） |
| 业务项目 | `templates/cf-shop`（电商）、`templates/dtc`（汽车故障码）、`templates/cf-static`（开发者工具站）、`templates/cf-form`（表单）、`templates/cf-api`（通用 API）、`templates/cf-tools`（工具集）、`templates/cf-calculators`（计算器） |
| 语言 | **TypeScript**（全部项目） |
| 框架 | **Hono**（Workers 项目）、**Eleventy**（静态站点） |
| ORM | **Drizzle ORM** + **Turso**（SQLite） |
| 校验 | **Zod**（配合 drizzle-zod 自动生成 Insert Schema） |
| 包管理器 | **pnpm**（硬性要求，preinstall 脚本阻断 npm/yarn） |
| 部署平台 | Cloudflare Workers / Pages |
| 测试 | Vitest |
| 文档目录 | `docs/`（所有分析、采坑、规范均存放于此） |

---

## 二、🔒 核心铁律（不可违反）

### 铁律 1：每次代码变更必须提交

- commit message **必须使用中文**
- 格式：`git commit -m "<中文描述>"`
- **不要积压，改完即提** — 每个功能模块完成后立即提交
- 提交前确保 `git add` 包含所有变更文件（含文档）
- 提交类型前缀：`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` / `test:`

### 铁律 2：代码修改必须同步文档

- 改了 schema 表结构 → 更新对应项目的 schema 注释 + `docs/` 中相关架构文档
- 改了 API 路由 → 更新路由设计说明
- 改了业务逻辑 → 更新对应的服务层说明
- **代码和文档不一致 = Bug**

### 铁律 3：全局视野，顶层思路

- 动手前**先读全量上下文**：本文件 → `CLAUDE.md` → `docs/` 相关文档 → 已有代码
- 不要看到局部问题就局部打补丁
- 每次改动前自问：**这个改动会影响哪些上下游项目？**（尤其是 cf-core 变更会波及所有 templates）

### 铁律 4：小而美，拒绝过度设计

- 只做当前需求明确要求的功能
- 不预构建"未来可能用到"的抽象层
- 能用一个函数解决的，不要建一个类
- 能一个模块搞定的，不要拆三个文件
- **cf-core 的 exports 不是越多越好**，每个导出必须有至少两个项目实际使用才能留在核心

### 铁律 5：改动前必须分析全局，确保闭环

- 改一个字段 → 检查 schema / 路由 / 服务 / 测试 / 文档 是否全部同步
- 每个功能必须有对应的**单元测试**
- 不允许"先跑通再说"，必须一次到位

### 铁律 6：问题与规范必须沉淀到 docs

- 采坑记录格式：**背景 → 原因 → 排查过程 → 解决方案 → 建议**
- 命名规范：`序号_中文文件名_日期.md`（不含空格）
- 示例：`055_cf-static产品与工具整合分析_2026-05-30.md`

### 铁律 7：一切从落地出发

- 不要写"理论上完美但实际用不上"的代码
- 不要为了炫技引入复杂模式
- 每个函数、每个表字段都必须有**明确的业务场景**支撑

### 铁律 8：围绕核心功能，细节记入 todolist

- 核心链路优先
- 非核心细节记入 `docs/todolist.md`，后续迭代

### 铁律 9：技术选型遵循行业最佳实践

- 语言：TypeScript（全部项目），**严格模式**
- 框架：Hono（Workers）、Eleventy（静态站点）
- ORM：Drizzle ORM + Turso（SQLite），**绝不在业务代码中写原生 SQL**
- 校验：Zod + drizzle-zod 自动生成 Insert Schema，**绝不信任外部传入的数据**
- 包管理：pnpm，**绝不用 npm install 或 yarn**
- 日志：结构化日志，**绝不用 console.log 上线**
- **不要重复造轮子**，能用 cf-core 或成熟库解决的绝不自己写

### 铁律 10：测试脚本必须正式化

- 测试写到项目 `tests/` 目录或内联 `*.test.ts`，**不要写了删、删了写**
- 即使调试失败，脚本也要保留（加注释说明问题），作为知识沉淀
- 核心业务逻辑必须有单元测试

### 铁律 11：核心代码必须有中文注释

- 变量/常量：说明业务含义
- 函数：说明输入、输出、副作用
- 业务流程：说明每一步的业务目的
- 复杂逻辑：**必须逐行注释**

### 铁律 12：能用 ORM 绝不用 SQL

- 所有数据库操作通过 Drizzle ORM 执行
- 防止 SQL 注入
- 方便数据库迁移
- **例外**：极复杂的分析查询，经架构评审后可用 Turso client 直接执行

### 铁律 13：金额精度铁律（cf-shop 项目）

- 数据库存储：`integer`（**整数分**，cents）
- 应用层计算：**整数（分）**
- 展示层：除以 100 转元
- **任何场景下禁止使用 JavaScript 原生浮点数做金额加减乘除**
- 前端传递金额时使用 `amountCents`（整数分），后端接收后直接入库

---

## 三、🏗️ 架构铁律（不可违反）

### 铁律 A：cf-core 不得包含任何业务代码

`@usethink/cf-core` npm 包的职责边界：

**src/** — 纯基础设施工具（HTTP、缓存、限流、幂等、审计、日志、加密、配置、错误处理）
**features/** — 可复用业务特性模块（payment、email、webhook、anti-abuse、telegram-miniapp 等）
**@usethink/cf-core/db/schema** — 只允许导出 5 张基础设施表：

- `systemConfig` — 系统配置
- `adminAuditLogs` — 管理员审计日志
- `rateLimitWindows` — 限流计数窗口
- `idempotencyKeys` — 幂等键
- `apiKeys` — API Key 认证

**严禁**：
- ❌ 在 cf-core schema 中添加业务表（products, orders, users, cards, dtcCodes 等）
- ❌ 在 cf-core 中添加业务路由、业务服务
- ❌ 在 cf-core 的 features/ 中添加只被单个项目使用的特性
- ❌ 添加业务相关的字段到公共表中

### 铁律 B：业务项目必须从 cf-core 导入公共表

所有使用 `@usethink/cf-core` 的项目（`templates/*/`），其 `schema.ts` **必须**包含：

```typescript
import {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "@usethink/cf-core/db/schema";
export { systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys, apiKeys };
```

**严禁本地重复定义这 5 张表。**

### 铁律 C：业务项目不得互相依赖

- `templates/cf-shop/` ❌ 不能 import `templates/dtc/`
- `templates/dtc/` ❌ 不能 import `templates/cf-static/`
- 所有跨项目共享代码必须上提到独立 npm 包（如 `@usethink/cf-core` 或其他 `@usethink/*` 包），不要恢复本地 `packages/cf-core` 源码依赖

### 铁律 D：目录结构不可随意变更

```
@usethink/cf-core/src/        # 基础设施工具（npm 包源码仓库维护）
@usethink/cf-core/features/   # 可复用业务特性（npm 包源码仓库维护）
templates/<project>/src/       # 业务项目源码
  ├── index.ts                 # Worker 入口（Hono app）
  ├── bindings.ts              # Cloudflare Bindings 类型定义
  ├── db/                      # 数据库（schema.ts + client）
  ├── routes/                  # API 路由
  ├── services/                # 业务逻辑
  ├── middleware/              # 中间件（如需要）
  └── lib/                     # 项目级工具函数
templates/<project>/scripts/   # 部署/运维脚本
templates/<project>/tests/     # 测试文件
```

- **routes 层只做参数校验 + 调用 service + 返回响应**，不写业务逻辑
- **services 层承载所有业务逻辑**
- **禁止在 routes 中直接操作数据库**

### 铁律 E：修改 schema.ts 必须经过架构评审

- 新增表必须确认是业务表（放在业务项目）还是基础设施表（放在 cf-core）
- 任何时候都不允许在 cf-core 中新增业务表
- 修改 schema 后必须运行 `node scripts/validate-architecture.mjs` 验证

### 铁律 F：cf-core 变更必须 bump 版本号

- 修改 `@usethink/cf-core` 源码仓库的 `package.json` 版本并发布 npm 包
- 向下兼容的修复 → patch（0.2.0 → 0.2.1）
- 新增导出功能 → minor（0.2.0 → 0.3.0）
- 破坏性变更 → major（1.0.0 → 2.0.0）

---

## 四、📋 AI 启动自检流程

**每次会话开始，在写任何代码之前，必须按顺序执行：**

### Step 1：读取上下文

```
必读文件（按优先级）：
1. 本文件（AGENTS.md）
2. CLAUDE.md（架构铁律）
3. docs/ 下与当前任务相关的分析文档
4. packages/cf-core/package.json（确认 exports 和版本）
5. 当前正在开发的源码文件
```

### Step 2：确认任务边界

- 用户要做什么？
- 涉及哪些项目？（cf-core / cf-shop / dtc / cf-static / ...）
- 涉及哪些表？哪些服务？哪些路由？
- 有没有上下游依赖？

### Step 3：检查已有实现

- 相关功能是否已经部分实现？
- 现有代码的风格和模式是什么？
- 有没有相关的单元测试？
- cf-core 是否已有可复用的模块？

### Step 4：制定计划（一句话）

- 修改哪些文件？
- 新增哪些文件？
- 需要更新哪些文档？

### Step 5：执行 + 验证

- 写代码
- 写/更新测试
- 更新文档
- 提交代码（中文 commit，改完即提）
- 运行 `node scripts/validate-architecture.mjs` 验证架构合规

---

## 五、🚫 禁止行为清单

| # | 禁止行为 | 后果 |
|---|---------|------|
| 1 | 在 routes 中写业务逻辑 | 逻辑分散，难以维护 |
| 2 | 在 cf-core 中添加业务表 | 破坏基础设施隔离 |
| 3 | 业务项目重复定义 cf-core 公共表 | 数据不一致 |
| 4 | 业务项目互相依赖 | 循环依赖，无法独立部署 |
| 5 | 用原生 SQL 操作数据库 | SQL 注入风险 |
| 6 | 用浮点数计算金额 | 精度丢失 |
| 7 | 不做输入校验 | 脏数据入库 |
| 8 | 使用 npm install 或 yarn | 包管理器混乱 |
| 9 | 改了代码不更新文档 | 代码文档不一致 |
| 10 | 改了代码不提交 | 变更丢失 |
| 11 | 写临时测试脚本然后删除 | 知识流失，重复劳动 |
| 12 | 不看全局直接改局部 | 引入隐性 Bug |
| 13 | 重复造轮子 | 维护成本高，Bug 多 |
| 14 | 过度设计、预构建未来功能 | 浪费开发时间，增加复杂度 |
| 15 | 修改 schema 不运行架构验证 | 架构偏离无法及时发现 |
| 16 | 修改 cf-core 不 bump 版本号 | 下游项目无法感知变更 |
| 17 | 在 repos/ 下直接提交嵌入式 git 仓库 | 嵌套 git 问题，应使用 submodule 或 gitignore |

---

## 六、✅ 提交前检查清单

每次提交前必须确认：

- [ ] 代码变更已完整（schema + routes + services + types）
- [ ] 金额计算使用整数分（cents），无原生浮点
- [ ] 输入参数有 Zod 校验
- [ ] 核心逻辑有中文注释
- [ ] 单元测试已编写/更新
- [ ] 文档已同步更新
- [ ] 运行 `node scripts/validate-architecture.mjs` 通过
- [ ] git commit message 使用中文
- [ ] cf-core 变更已 bump 版本号
- [ ] 没有 `package-lock.json` 或 `yarn.lock` 混入

---

## 七、📐 核心业务流程速查

### 7.1 cf-shop 下单流程

```
用户选择商品 → 校验库存 → 创建订单（pending）→ 支付（支付宝/Stripe/TRC20）
→ 支付回调确认 → 事务：扣减卡密库存 + 发货 + 记流水 → 发送通知邮件
```

### 7.2 cf-shop 卡密发行流程

```
管理员导入卡密批次 → 校验格式 → 事务：批量写入 cards + cardBatches
→ 更新商品库存统计
```

### 7.3 cf-shop 充值流程

```
管理员生成充值码 → 站外收款 → 用户兑换充值码 → 事务：余额增加 + 记流水
→ 下单时可选余额支付
```

### 7.4 DTC 故障码查询流程

```
用户输入故障码 → 查 dtcCodes 表 → 返回故障描述、可能原因、解决方案
→ 按 manufacturer/category 分类聚合
```

### 7.5 cf-static 静态站点流程

```
Eleventy 构建 → 读取 _data/*.json → 渲染 njk 模板 → 输出静态 HTML
→ Cloudflare Pages 部署 → CDN 分发
```

---

## 八、🔧 常用命令速查

| 命令 | 用途 |
|------|------|
| `pnpm install` | 安装全部依赖 |
| `pnpm build` | 构建 cf-core |
| `pnpm test` | 运行 cf-core 测试 |
| `pnpm type-check` | TypeScript 类型检查 |
| `node scripts/validate-architecture.mjs` | 架构合规验证 |
| `node scripts/create-project.mjs <name>` | 创建新产品 |
| `cd templates/cf-shop && pnpm test` | 运行 cf-shop 测试 |
| `cd templates/cf-static && npx @11ty/eleventy` | 构建静态站点 |
| `wrangler dev` | 本地开发 Workers |
| `wrangler deploy` | 部署 Workers |

---

## 九、⚠️ 高频采坑预警

### 坑 1：Drizzle ORM 的 SQLite 类型映射

- Turso 是 SQLite，没有原生 `DECIMAL` / `TIMESTAMP` 类型
- 金额用 `integer()`（存储分），时间用 `text()`（存储 ISO 字符串）
- 不要用 `decimal()` 或 `timestamp()` — SQLite 不支持

### 坑 2：Cloudflare Workers 无文件系统

- Workers 环境没有 `fs` 模块
- 不能读写本地文件，所有状态必须存在 D1/Turso/R2/KV 中
- 静态文件通过 Assets 绑定或 Pages 提供

### 坑 3：Workers 冷启动

- 模块级变量在每次冷启动时重新初始化
- 数据库连接应延迟创建（首次请求时），不要放在模块顶层
- cf-core 的 `bootstrap.ts` 已处理此问题

### 坑 4：pnpm workspace 依赖解析

- 子项目引用 cf-core 用 npm 版本号，例如 `"@usethink/cf-core": "^0.3.4"`
- 修改 cf-core 后需 `pnpm install` 重新链接
- 不要在各子项目中单独 `npm install`

### 坑 5：嵌入式 git 仓库

- `repos/` 目录下各子项目是独立 git 仓库
- **不要**直接用 `git add repos/` — 会产生嵌套 git 警告
- 应加入 `.gitignore` 或改用 `git submodule`

---

## 十、📚 参考文档索引

| 文档 | 说明 |
|------|------|
| `CLAUDE.md` | 架构铁律（cf-core 隔离、公共表导入、pnpm 强制） |
| `docs/ARCHITECTURE_ENFORCEMENT.md` | 完整架构规则 |
| `docs/900_产品架构全景_...` | 产品架构全景分析 |
| `docs/970_支付体系全局整合方案.md` | 支付体系整合方案 |
| `docs/950_域名策略_...` | 域名与部署策略 |
| `docs/960_变现路径_...` | 变现与商业化路径 |
| `@usethink/cf-core` npm 包 README | cf-core 使用说明 |
| `templates/cf-shop/scripts/DEPLOY-GUIDE.md` | cf-shop 部署指南 |

---

## 十一、🔄 会话结束清单

**每次会话结束前，必须执行：**

1. [ ] `git status` — 确认没有遗漏的未提交变更
2. [ ] `git log --oneline -5` — 确认本次变更已完整提交
3. [ ] 如果有未完成的分析文档，保存到 `docs/` 目录
4. [ ] 总结本次会话完成的工作和遗留问题

> **铁律：会话结束 = 工作区干净。** 不允许带着未提交的代码结束会话。
