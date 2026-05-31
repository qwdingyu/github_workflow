# eshop → cf-shop 迁移指南

> 版本：v1.0
> 日期：2026-06-05
> 状态：eshop 迁移完成，220 个测试全部通过

---

## 一、迁移目标

将已有业务项目（eshop/xtools/vcode）迁移到 eForge Monorepo 的 `templates/` 体系，同时：
1. 保留全部业务逻辑不变
2. 继承 cf-core 的 5 张公共基础设施表
3. 获得 monorepo 的统一构建、测试、部署能力
4. 为后续项目迁移建立可复用的标准流程

---

## 二、cf-core 模块清单与使用决策

### 2.1 cf-core 导出模块一览

| 导出路径 | 模块 | 功能 |
|---------|------|------|
| `@eforge/cf-core` | 主入口 | Hono 类型、通用类型 |
| `@eforge/cf-core/db` | 数据库 | `createDb(client)` — Drizzle ORM 工厂 |
| `@eforge/cf-core/db/schema` | Schema | 5 张公共表（systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys, apiKeys） |
| `@eforge/cf-core/db/expressions` | SQL 表达式 | `dateTimeNow`, `timeAgo`, `jsonExtract` 等 |
| `@eforge/cf-core/http` | HTTP 工具 | `ok()`, `fail()`, `failRateLimit()`, `getOrigin()`, `safeJsonBody()` |
| `@eforge/cf-core/security` | 安全工具 | `sha256()`, `constantTimeEqual()`, `getIpHash()`, `getBearerToken()`, `verifyTurnstile()`, `buildSecurityHeaders()` |
| `@eforge/cf-core/rate-limit` | 限流 | `MemoryRateLimiter`, `KvRateLimiter`, `DbRateLimiter` 三种后端 |
| `@eforge/cf-core/cache` | Cache API | `createCache(namespace)` 工厂函数 |
| `@eforge/cf-core/idempotency` | 幂等性 | `checkIdempotency()`, `saveIdempotentResponse()` |
| `@eforge/cf-core/audit` | 审计日志 | `writeAdminAudit()` |
| `@eforge/cf-core/config` | 系统配置 | `SystemConfig` 类（带内存缓存的 KV） |
| `@eforge/cf-core/bootstrap` | App 启动 | `createApp()` — 完整路由+中间件+静态文件+安全头 |
| `@eforge/cf-core/middleware/admin-auth` | 管理认证 | `adminAuthMiddleware()` |
| `@eforge/cf-core/auth/jwt` | JWT | `createJwtSigner()`, `createJwtVerifier()` |
| `@eforge/cf-core/crypto` | 加密 | AES-256-GCM 加密/解密 |
| `@eforge/cf-core/logger` | 日志 | `createLogger()` |
| `@eforge/cf-core/error` | 错误 | `AppError`, `NotFoundError` 等 |
| `@eforge/cf-core/types` | 类型 | `RateLimitResult`, `TurnstileResult` 等 |

### 2.2 eshop 各模块 vs cf-core 对比

| eshop 本地模块 | cf-core 对应模块 | 能否直接替换 | 原因 |
|---------------|-----------------|-------------|------|
| `lib/http.ts` | `@eforge/cf-core/http` | ❌ 不能 | eshop 版含 `getDb(c)` 和 `safeJsonBody(c)` 绑定 `AppEnv`/`DbType`；cf-core 版用泛型 `Context<any>` |
| `lib/security.ts` | `@eforge/cf-core/security` | ❌ 不能 | eshop 版 `requireAdmin` 依赖本地 `fail()` 和 `AppEnv`；cf-core 版是中间件函数 |
| `lib/rate-limit.ts` | `@eforge/cf-core/rate-limit` | ❌ 不能 | eshop 版直接操作 schema + 本地 `getDb`/`getIpHash` + 业务日志 `writeRequestLog`；cf-core 版是三种后端类 |
| `lib/cache.ts` | `@eforge/cf-core/cache` | ⚠️ 可替换但收益小 | API 不同：eshop 函数式 (`cacheGet`/`cachePut`) vs cf-core 工厂模式 (`createCache(ns)`)；需改所有调用方 |
| `lib/idempotency.ts` | `@eforge/cf-core/idempotency` | ❌ 不能 | cf-core 版直接 import schema 表，与项目本地 schema 耦合 |
| `lib/token.ts` | — | N/A | 业务专属（订单号/Token 生成），cf-core 无对应 |
| `lib/alipay-sign.ts` | — | N/A | 业务专属（支付宝签名），cf-core 无对应 |
| `db/database.ts` | `@eforge/cf-core/db` | ✅ 可替换 | 但 eshop 版含 `initDatabase` 完整初始化逻辑（含错误处理），替换需重写 |
| `db/client.ts` | — | N/A | 项目专属类型定义 |
| `db/expressions.ts` | `@eforge/cf-core/db/expressions` | ✅ 可替换 | 但 eshop 版含业务表达式（`jsonExtractText`），需合并 |
| `db/schema.ts` | `@eforge/cf-core/db/schema` | ✅ 部分替换 | 4 张公共表从 cf-core 导入，业务表保留本地 |
| `services/audit-service.ts` | `@eforge/cf-core/audit` | ❌ 不能 | eshop 版含业务逻辑（`writeAudit` 带 `getIpHash`/`getDb`），cf-core 版是纯函数 |
| `index.ts` | `@eforge/cf-core/bootstrap` | ❌ 不能 | eshop 版含业务路由注册 + 前端路由逻辑，cf-core `createApp` 是通用框架 |

### 2.3 核心结论

**eshop 的本地 lib 层深度绑定 `AppEnv`/`DbType`/schema，cf-core 设计为泛型（`Context<any>`）。两者定位不同：**

- **cf-core** = 泛型基础设施库（无业务类型依赖）
- **项目 lib** = 适配层（将 cf-core 泛型能力 + 项目类型绑定为可用工具）

**因此 eshop 迁移时，本地 lib 层保留不动是正确的。** 只替换 schema 中的公共表导入。

---

## 三、迁移步骤（适用于后续 xtools/vcode 迁移）

### Step 0：前置准备

```bash
# 1. 确保 cf-core 已构建
cd /Users/dingyuwang/0-X/github_workflow
pnpm -w packages/cf-core run build

# 2. 创建新项目目录（使用脚手架）
node scripts/create-project.mjs <project-name> --template eshop
# 这会生成 templates/<project-name>/ 带基本结构
```

### Step 1：Schema 迁移

```bash
# 1a. 拷贝原始项目的 schema.ts
cp <source>/src/db/schema.ts templates/<project-name>/src/db/schema.ts

# 1b. 修改 schema.ts：
#    - 保留所有业务表定义
#    - 删除 4 张公共表定义（systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys）
#    - 在文件顶部添加：
#      export {
#        systemConfig, adminAuditLogs, rateLimitWindows, idempotencyKeys
#      } from "@eforge/cf-core/db/schema";
```

**验证**：`npx tsc --noEmit` 编译通过

### Step 2：业务源码拷贝

```bash
# 拷贝所有非 schema 源文件
cp -r <source>/src/bindings.ts templates/<project-name>/src/
cp -r <source>/src/lib/ templates/<project-name>/src/
cp -r <source>/src/routes/ templates/<project-name>/src/
cp -r <source>/src/services/ templates/<project-name>/src/
cp -r <source>/src/db/database.ts templates/<project-name>/src/db/
cp -r <source>/src/db/client.ts templates/<project-name>/src/db/
cp -r <source>/src/db/expressions.ts templates/<project-name>/src/db/
cp <source>/src/index.ts templates/<project-name>/src/
```

**注意**：业务源码保持原样，不改导入路径，不动业务逻辑。

### Step 3：前端拷贝

```bash
cp -r <source>/frontend templates/<project-name>/
```

前端直接拷贝，不修改。如果后端 API 接口没变，前端无需适配。

### Step 4：测试基础设施

```bash
# 拷贝测试文件
cp <source>/src/lib/*.test.ts templates/<project-name>/src/lib/
cp <source>/src/routes/*.test.ts templates/<project-name>/src/routes/
cp <source>/src/services/*.test.ts templates/<project-name>/src/services/
# 递归拷贝子目录测试
find <source>/src -name "*.test.ts" -exec dirname {} \; | sort -u | while read dir; do
  rel=${dir#<source>/src/}
  mkdir -p templates/<project-name>/src/$rel
  cp $dir/*.test.ts templates/<project-name>/src/$rel/ 2>/dev/null
done

# 拷贝测试工具
mkdir -p templates/<project-name>/src/test-utils
cp -r <source>/src/test-utils/* templates/<project-name>/src/test-utils/

# 拷贝 vitest 配置
cp <source>/vitest.config.ts templates/<project-name>/
```

### Step 5：部署脚本

```bash
# 备份脚手架生成的 scripts
mkdir -p templates/<project-name>/scripts_backup
cp templates/<project-name>/scripts/* templates/<project-name>/scripts_backup/

# 拷贝业务项目的部署脚本
cp <source>/scripts/* templates/<project-name>/scripts/
```

### Step 6：配置文件

```bash
# wrangler.jsonc — 从脚手架保留，根据业务需求调整 vars/secrets
# package.json — 确保依赖版本对齐：
#   vitest: ^4.1.7
#   vite: ^6.0.0
#   vitest-environment-miniflare: ^2.14.4
#   wrangler: ^4.94.0

pnpm install --dir templates/<project-name>
```

### Step 7：验证

```bash
cd templates/<project-name>

# 7a. TypeScript 编译
npx tsc --noEmit

# 7b. 单元测试
npx vitest run
# 期望：全部通过

# 7c. Wrangler 构建
npx wrangler deploy --dry-run
# 期望：构建成功

# 7d. 架构验证
node scripts/validate-architecture.mjs
# 期望：全部通过
```

---

## 四、cf-core 使用策略（后续项目指南）

### 4.1 何时使用 cf-core

| 场景 | 建议 |
|------|------|
| 公共基础设施表 | ✅ 必须从 cf-core 导入 |
| 新项目从零开始 | ✅ 优先使用 cf-core 的 `createApp()` + 中间件 + 工具 |
| 已有项目迁移 | ⚠️ 仅替换 schema 公共表，lib 层保留本地 |
| 需要多后端限流 | ✅ 使用 cf-core 的 `MemoryRateLimiter`/`KvRateLimiter`/`DbRateLimiter` |
| 需要 JWT 认证 | ✅ 使用 cf-core 的 `createJwtSigner()`/`createJwtVerifier()` |
| 需要 AES 加密 | ✅ 使用 cf-core 的 `encryptData()`/`decryptData()` |

### 4.2 何时保留本地实现

| 场景 | 建议 |
|------|------|
| 已深度绑定 `AppEnv` 的 lib 层 | 保留本地，不要强行替换 |
| 业务专属逻辑（支付签名、订单号生成） | 保留本地 |
| 业务服务层（order-service, product-service） | 保留本地 |
| 业务路由（routes/） | 保留本地 |

### 4.3 新项目最佳实践

如果是**全新项目**（非迁移），推荐架构：

```
templates/<new-project>/src/
├── bindings.ts          # 项目 Bindings/AppEnv 类型定义
├── db/
│   ├── schema.ts        # 从 cf-core 导入公共表 + 定义业务表
│   └── client.ts        # 用 cf-core 的 createDb()
├── lib/
│   └── <business>.ts    # 仅放业务专属工具（如支付签名）
├── routes/              # 业务路由
├── services/            # 业务服务
└── index.ts             # 用 cf-core 的 createApp() 或手写
```

---

## 五、eshop 迁移结果验证

### 5.1 文件清单

| 类别 | 文件数 |
|------|--------|
| 业务源码（src/） | 39 |
| 测试文件（*.test.ts） | 12 |
| 前端文件（frontend/） | 31 |
| 部署脚本（scripts/） | 10+ |
| **总计** | **92+** |

### 5.2 测试结果

```
Test Files  12 passed (12)
Tests       220 passed (220)
Duration    ~34s
```

### 5.3 构建结果

```
wrangler deploy --dry-run: ✅ 构建成功
tsc --noEmit:              ✅ 零错误
validate-architecture:     ✅ 全部通过
```

### 5.4 cf-core 使用情况

| 使用项 | 状态 |
|--------|------|
| `@eforge/cf-core/db/schema`（4 张公共表） | ✅ 已使用 |
| `@eforge/cf-core/http` | ❌ 未使用（本地绑定 AppEnv） |
| `@eforge/cf-core/security` | ❌ 未使用（本地绑定 AppEnv） |
| `@eforge/cf-core/rate-limit` | ❌ 未使用（本地直接操作 schema） |
| `@eforge/cf-core/cache` | ❌ 未使用（API 不同） |
| `@eforge/cf-core/bootstrap` | ❌ 未使用（业务路由复杂） |

**这是正确的**：迁移项目保留本地 lib，cf-core 仅提供 schema 公共表。

---

## 六、后续迁移检查清单

迁移 xtools/vcode 时，逐项核对：

- [ ] Step 0：cf-core 已构建，脚手架生成项目目录
- [ ] Step 1：schema.ts 公共表从 cf-core 导入，业务表保留
- [ ] Step 2：业务源码完整拷贝（bindings, lib, routes, services, db）
- [ ] Step 3：前端完整拷贝
- [ ] Step 4：**测试文件完整拷贝**（这是 eshop 迁移中最初遗漏的）
- [ ] Step 4：vitest.config.ts 拷贝
- [ ] Step 4：test-utils 拷贝
- [ ] Step 5：部署脚本拷贝
- [ ] Step 6：package.json 依赖版本对齐（vitest 4.x, vite 6.x）
- [ ] Step 7a：`tsc --noEmit` 通过
- [ ] Step 7b：`vitest run` 全部通过
- [ ] Step 7c：`wrangler deploy --dry-run` 构建成功
- [ ] Step 7d：`validate-architecture.mjs` 通过

---

## 七、常见问题

### Q: 为什么 cf-shop 没有使用 cf-core 的 http/security/cache 模块？

A: eshop 的 lib 层深度绑定了 `AppEnv` 类型（项目的 Hono 泛型参数），而 cf-core 使用 `Context<any>` 保持通用。强行替换需要改动所有路由和服务的导入和类型签名，风险远大于收益。

### Q: 后续新项目应该用哪个？

A: **全新项目**优先使用 cf-core 的完整能力（createApp + 中间件 + 工具）。**迁移项目**只替换 schema 公共表，lib 层保留本地。

### Q: 测试脚本为什么要单独拷贝？

A: 没有测试就无法验证迁移是否正确。eshop 有 12 个测试文件、220 个测试用例，覆盖了 lib 层和 service 层的核心逻辑。迁移后第一时间跑测试，是确认"代码没丢、逻辑没变"的唯一可靠手段。

### Q: vitest 版本为什么要从 2.x 升级到 4.x？

A: eshop 使用 vitest 4.x，测试文件依赖 4.x 的 API。cf-shop 脚手架生成时是 2.x，必须对齐版本。同时 vitest 4.x 要求 vite 6.x，需一并升级。

---

## 八、快速变现建议

基于当前 cf-shop 的完整状态：

### 8.1 立即可做（今天）

1. **部署 cf-shop 到 Cloudflare Workers**
   - 已有完整业务代码 + 前端 + 220 测试通过
   - 配置 TURSO_URL/TURSO_TOKEN/ADMIN_TOKEN 即可上线
   - 数字商品售卖闭环：商品 → 下单 → 支付宝/USDT 支付 → 自动发卡

2. **配置支付宝当面付**
   - 个人可用，0.6% 费率，扫码支付
   - 只需配置 ALIPAY_APP_ID / PRIVATE_KEY / PUBLIC_KEY
   - 代码已就绪，无需开发

### 8.2 一周内

3. **迁移 xtools/vcode 到 monorepo**
   - 按本文档 Step 0-7 执行
   - 预计每个项目 1-2 小时
   - 三个项目统一在 cf-shop 域名下运营

4. **SEO 优化**
   - 参考 docs/801_程序化页面生成器深度分析
   - 为每个产品生成 SEO 落地页
   - 利用 Cloudflare Pages 免费额度做内容站

### 8.3 一个月内

5. **多支付通道上线**
   - 支付宝（已就绪）
   - USDT TRC20（已就绪，零资质全球收款）
   - Stripe（资质就绪后启用，代码框架已有）

6. **数据驱动运营**
   - 利用 admin 后台查看订单/收入
   - 分析转化率，优化落地页
   - 通过 GitHub Actions 定时清理过期订单

---

*文档维护者：AtomCode (skywork-ai/skyclaw-v1)*
*最后更新：2026-06-05*
