# @usethink/cf-core 共享内核实施记录

> 日期：2026-05-29
> 状态：Phase 1 完成（共享内核全部模块 + 测试通过）
> 依赖文档：046_批量产品标准化架构方案

---

## 一、实施成果

### 1.1 交付物

| 文件 | 行数 | 功能 |
|------|------|------|
| `src/types.ts` | 70 | 公共类型约束（CoreBindings/CoreEnv/TurnstileResult/RateLimitResult） |
| `src/http.ts` | 98 | ok/fail 响应、maskContact、csvEscape、toCsv、safeJsonBody |
| `src/security.ts` | 212 | sha256、constantTimeEqual、getIpHash、verifyTurnstile、buildSecurityHeaders |
| `src/db/schema.ts` | 83 | 5 张公共表（systemConfig/adminAuditLogs/rateLimitWindows/idempotencyKeys/apiKeys） |
| `src/db/connection.ts` | 98 | Isolate 级 libSQL 连接复用 + Drizzle 实例工厂 |
| `src/rate-limit.ts` | 180 | 三后端统一限流（MemoryRateLimiter/KvRateLimiter/DbRateLimiter） |
| `src/cache.ts` | 85 | Workers Cache API 命名空间封装 |
| `src/idempotency.ts` | 128 | 原子 UPSERT + 哨兵值幂等保护 |
| `src/audit.ts` | 70 | fire-and-forget 审计日志 + 概率清理 |
| `src/config.ts` | 130 | SystemConfig 类（运行时 KV 配置，热生效 + 内存缓存） |
| `src/bootstrap.ts` | 175 | Worker 入口工厂（DB 中间件 + 安全头 + API/静态分流） |
| `src/auth/jwt.ts` | 112 | JWT 签发/验证（HMAC-SHA256，纯 Web Crypto） |
| `src/auth/password.ts` | 80 | PBKDF2 密码哈希（100K 迭代） |
| `src/middleware/admin-auth.ts` | 72 | 管理员认证中间件（Bearer + X-Admin-Token 双模式） |
| `src/middleware/api-key-auth.ts` | 165 | API Key 认证中间件（SHA256 + 原子配额递增） |
| `src/error.ts` | 110 | 错误分类 + 指数退避重试 |
| `src/logger.ts` | 60 | 结构化 JSON 日志 |
| `src/crypto.ts` | 110 | AES-256-GCM 加解密 + generateUUID |
| `src/index.ts` | 65 | 统一导出 |
| **合计** | **~2,103** | **19 个源文件** |

### 1.2 测试覆盖

| 测试文件 | 用例数 | 状态 |
|---------|--------|------|
| `tests/http.test.ts` | 11 | ✅ |
| `tests/security.test.ts` | 10 | ✅ |
| `tests/error.test.ts` | 8 | ✅ |
| `tests/auth.test.ts` | 12 | ✅ |
| `tests/rate-limit.test.ts` | 4 | ✅ |
| `tests/crypto.test.ts` | 8 | ✅ |
| **合计** | **53** | **全部通过** |

---

## 二、关键设计决策

### 2.1 泛型 > 特定类型

**问题**：三项目的 `AppEnv` 类型各不相同，cf-core 的 `ok()`/`fail()` 等函数如何兼容？

**方案**：所有 Context 参数使用泛型约束而非固定类型：

```ts
// ❌ 绑定特定 AppEnv
export function ok(c: Context<AppEnv>, ...) { ... }

// ✅ 泛型约束，兼容任意项目
export function ok<E extends { Bindings: Record<string, unknown> }>(c: Context<E>, ...) { ... }
```

### 2.2 constantTimeEqual — XOR 而非 timingSafeEqual

**问题**：`crypto.subtle.timingSafeEqual` 是 Workers 专属 API，Node.js 测试环境不存在。

**方案**：统一使用手写 XOR 比较（xtools 的做法），兼容 Node.js 和 Workers：

```ts
let diff = 0;
for (let i = 0; i < aBuf.byteLength; i++) {
  diff |= aBuf[i] ^ bBuf[i];
}
return diff === 0;
```

### 2.3 限流三后端统一接口

**问题**：eshop 用 DB、xtools 用 KV、vcode 用内存，三套实现各有所长。

**方案**：定义 `RateLimiter` 接口，三个实现类：

| 类 | 存储 | 适用场景 |
|---|------|---------|
| `MemoryRateLimiter` | Map（实例级） | 轻量项目、vcode 类 |
| `KvRateLimiter` | Cloudflare KV | 跨实例共享、xtools 类 |
| `DbRateLimiter` | Turso/libSQL | 最可靠、eshop 类 |

### 2.4 Admin Auth 双模式

**问题**：eshop 用 `Authorization: Bearer`，xtools 用 `X-Admin-Token` Header。

**方案**：`createAdminAuth({ mode: "both" })` 默认两种都尝试，可按需指定。

### 2.5 DB Schema 共享策略

**问题**：三项目的 systemConfig / adminAuditLogs 表结构完全一致，但各项目 Schema 文件独立。

**方案**：cf-core 导出公共表定义，各项目 import 后扩展：

```ts
// 项目的 schema.ts
import { systemConfig, adminAuditLogs, apiKeys } from "@usethink/cf-core/db/schema";
// 项目自己的业务表
export const products = sqliteTable("products", { ... });
```

### 2.6 Bootstrap 工厂模式

**问题**：三项目的 `index.ts` 入口代码 80% 相同（DB 中间件 + 安全头 + 路由分流 + 错误处理）。

**方案**：`bootstrap()` 工厂函数，一个配置对象创建完整 Worker：

```ts
export default bootstrap({
  schema,
  registerRoutes: (api) => { api.route("/", myRoutes); },
  pageRoutes: { "/admin": "/admin.html" },
  spaRoutes: { fallback: "/_app/index.html", paths: ["/shop"] },
  immutablePrefixes: ["/_app/assets/"],
});
```

---

## 三、与文档 046 Phase 1 的对应关系

| Phase 1 任务 | 状态 | 对应模块 |
|-------------|------|---------|
| P0: http 合并 | ✅ | `src/http.ts` |
| P0: security 合并 | ✅ | `src/security.ts` |
| P0: db 合并 | ✅ | `src/db/` |
| P0: bootstrap 合并 | ✅ | `src/bootstrap.ts` |
| P1: rate-limit 合并 | ✅ | `src/rate-limit.ts`（三后端） |
| P1: cache 提取 | ✅ | `src/cache.ts` |
| P1: audit 合并 | ✅ | `src/audit.ts` |
| P1: config 合并 | ✅ | `src/config.ts` |
| P2: auth 提取 | ✅ | `src/auth/` |
| P2: crypto 提取 | ✅ | `src/crypto.ts` |
| P2: error 提取 | ✅ | `src/error.ts` |
| P2: logger 提取 | ✅ | `src/logger.ts` |

**Phase 1 完成度：12/12（100%）**

---

## 四、Phase 2 — 产品模板（已完成）

### 4.1 模板清单

| 模板 | 文件数 | 业务表 | 核心特性 |
|------|--------|--------|---------|
| **cf-shop** | 28 | 8 张（products/cards/orders/coupons 等） | 发卡商城、支付 Provider、卡密锁定/发放 |
| **cf-api** | 27 | 5 张（tokens/channels/service_logs 等） | API 中间层、ChannelAdapter、惰性清理 |
| **cf-tools** | 26 | 3 张（users/tools/tool_usage_logs） | 工具集、ToolDriver 注册表、JWT 用户系统 |

### 4.2 每个模板的文件结构

```
templates/cf-{shop,api,tools}/
├── package.json           # 依赖 @usethink/cf-core
├── tsconfig.json          # paths alias → cf-core
├── wrangler.jsonc         # Workers 配置
├── README.md              # 中文使用说明
├── .gitignore
├── src/
│   ├── index.ts           # bootstrap() 入口 ✅
│   ├── bindings.ts        # 扩展 CoreBindings ✅
│   ├── config.ts          # 业务配置（用户主改）
│   ├── db/schema.ts       # 导入公共表 + 业务表 ✅
│   ├── routes/            # 业务路由
│   └── services/          # 业务服务
├── public/
│   ├── index.html         # 用户端页面
│   ├── admin.html         # 管理后台（Vue3+EP CDN）
│   └── _headers           # 安全响应头
├── migrations/
│   └── 0001_init.sql      # 幂等初始化 SQL
├── scripts/
│   ├── deploy.sh          # 一键部署 ✅
│   ├── migrate.mjs        # 数据库迁移 ✅
│   ├── smoke-readonly.mjs # 只读冒烟测试 ✅
│   └── smoke-admin.mjs    # 管理端冒烟测试 ✅
└── .github/workflows/
    └── deploy.yml         # CI/CD 流水线 ✅
```

### 4.3 关键设计验证

| 检查项 | cf-shop | cf-api | cf-tools |
|--------|---------|--------|----------|
| 使用 `bootstrap()` 工厂 | ✅ | ✅ | ✅ |
| 导入 `@usethink/cf-core` | ✅ | ✅ | ✅ |
| 扩展 `CoreBindings` | ✅ | ✅ | ✅ |
| 导入公共 Schema | ✅ | ✅ | ✅ |
| 完整 SQL 迁移 | ✅ | ✅ | ✅ |
| CI/CD 流水线 | ✅ | ✅ | ✅ |
| 冒烟测试 | ✅ | ✅ | ✅ |
| 中文 README | ✅ | ✅ | ✅ |

### 4.4 共享基础设施

| 文件 | 位置 | 说明 |
|------|------|------|
| `templates/.shared/deploy.sh` | 共享 | 一键部署脚本 |
| `templates/.shared/migrate.mjs` | 共享 | Turso HTTP 迁移 |
| `templates/.shared/smoke-readonly.mjs` | 共享 | 只读冒烟 |
| `templates/.shared/smoke-admin.mjs` | 共享 | 管理端冒烟 |
| `templates/.shared/github-actions-deploy.yml` | 共享 | CI/CD 模板 |

### 4.5 新项目创建流程（30 分钟上线）

```bash
# 1. 选择模板并复制
cp -R templates/cf-shop ../my-new-shop
cd ../my-new-shop && git init

# 2. 安装依赖
npm install

# 3. 修改配置（5 分钟）
# - package.json name
# - wrangler.jsonc name + APP_ORIGIN
# - src/config.ts 业务配置
# - public/index.html 品牌元素

# 4. 创建数据库
npx turso db create my-new-shop

# 5. 初始化数据库
TURSO_URL=... TURSO_TOKEN=... node scripts/migrate.mjs

# 6. 配置 Secrets
npx wrangler secret put ADMIN_TOKEN

# 7. 部署
npm run deploy
```

**Phase 2 完成度：5/5（100%）**

---

## 五、Phase 3 — 插件体系（已完成）

### 5.1 插件清单

| 插件 | 类型 | 来源 | 核心功能 | 测试数 |
|------|------|------|---------|--------|
| **payment-core** | 抽象层 | eshop | PaymentProvider 接口 + ProviderRegistry 工厂 | - |
| **payment-alipay** | 支付渠道 | eshop | 支付宝当面付（RSA2 签名/回调验签/订单查询） | - |
| **email-resend** | 邮件服务 | eshop | Resend API 发送 + 模板插值 + 3 次重试 | 7 |
| **webhook** | 通知服务 | xtools | 多 URL 通知 + HMAC 签名 + 超时重试 | 3 |
| **thompson-router** | 智能路由 | vcode | Thompson Sampling 多臂老虎机 + Wilson Score | 11 |
| **anti-abuse** | 防刷检测 | vcode | 多IP/高频/扫描/快速连续 4 类异常检测 | 6 |
| **telegram-miniapp** | 前端集成 | eshop | 平台检测 + 主题映射 + WebApp SDK 初始化 | 1 |

### 5.2 插件接口标准

```ts
// 所有插件实现的基础接口
interface PluginBase {
  readonly name: string;
  readonly version: string;
  readonly type: "service" | "route" | "frontend";
}

// 服务插件：提供可调用的业务逻辑
interface ServicePlugin<TConfig> extends PluginBase {
  create(config: TConfig): unknown;
  healthCheck?(config: TConfig): Promise<boolean>;
}

// 路由插件：注册 Hono 路由
interface RoutePlugin<TConfig> extends PluginBase {
  registerRoutes(app: Hono, config: TConfig): void;
}
```

### 5.3 插件使用示例

```ts
// 支付：选择渠道 + 创建支付
import { createProviderRegistry } from "@usethink/cf-core/plugins/payment-core";
import { alipayFactory } from "@usethink/cf-core/plugins/payment-alipay";

const registry = createProviderRegistry(env, [alipayFactory]);
const provider = registry.selectOnline();
const result = await provider.createPayment({ orderNo, amountCents, currency, notifyUrl });

// 邮件：发送模板邮件
import { EmailService } from "@usethink/cf-core/plugins/email-resend";
const email = new EmailService({ apiKey: env.RESEND_API_KEY });
await email.sendWithTemplate("buyer@email.com", template, { orderNo, cardData });

// Webhook：通知下游系统
import { WebhookService } from "@usethink/cf-core/plugins/webhook";
const hook = new WebhookService({ urls: "https://hooks.example.com/a", secret: "key" });
await hook.notify("order.paid", { orderId, amount });

// 智能路由：Thompson Sampling 选渠道
import { ThompsonRouter } from "@usethink/cf-core/plugins/thompson-router";
const router = new ThompsonRouter();
const decision = router.select(candidates);
router.recordSuccess(candidates, decision.channelId);

// 防刷检测：记录访问 + 检测异常
import { AntiAbuseService } from "@usethink/cf-core/plugins/anti-abuse";
const abuse = new AntiAbuseService({ maxRequestsPerIp: 30 });
const events = abuse.record(resourceId, ipHash);
```

### 5.4 测试覆盖

| 测试文件 | 用例数 | 状态 |
|---------|--------|------|
| `plugins/tests/email-resend.test.ts` | 7 | ✅ |
| `plugins/tests/webhook.test.ts` | 3 | ✅ |
| `plugins/tests/thompson-router.test.ts` | 11 | ✅ |
| `plugins/tests/anti-abuse.test.ts` | 6 | ✅ |
| `plugins/tests/telegram-miniapp.test.ts` | 1 | ✅ |
| **合计** | **81** (含 Phase 1 的 53) | **全部通过** |

**Phase 3 完成度：8/8（100%）**

---

## 七、文件索引

```
packages/cf-core/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/                          # 核心（19 个模块）
│   ├── index.ts
│   ├── types.ts
│   ├── http.ts / security.ts / rate-limit.ts / cache.ts
│   ├── idempotency.ts / audit.ts / config.ts / bootstrap.ts
│   ├── error.ts / logger.ts / crypto.ts
│   ├── db/ (schema.ts + connection.ts)
│   ├── auth/ (jwt.ts + password.ts)
│   └── middleware/ (admin-auth.ts + api-key-auth.ts)
├── features/                     # 功能模块（6 个）
│   ├── payment/index.ts          # 支付（含支付宝 RSA2）
│   ├── email/index.ts            # Resend 邮件
│   ├── webhook/index.ts          # Webhook 通知
│   ├── thompson-router/index.ts  # Thompson Sampling 路由
│   ├── anti-abuse/index.ts       # 防刷检测
│   └── telegram-miniapp/index.ts # Telegram 前端集成
├── tests/                        # 核心测试（53 个）
├── features/*/tests/             # 功能测试（28 个）
└── docs/                         # 文档（11 篇）
    ├── 001_架构总览.md
    ├── 002_快速开始.md
    ├── 010~012_核心模块_*.md
    ├── 050~055_功能模块_*.md
    └── 060_自动化部署体系.md

templates/.deploy/                # 统一部署脚本（12 个文件）
├── shared.sh                     # 公共函数库
├── one-click.sh                  # 一键入口
├── 00~06_*.sh                    # 7 个步骤脚本
└── workflows/                    # 3 个 CI/CD 模板
```

---

## 八、Phase 4 — 自动化部署体系（已完成）

### 8.1 设计目标

**两个 Token 搞定一切**：只需 `CLOUDFLARE_API_TOKEN` + `TURSO_API_TOKEN`，其余全部自动生成。

### 8.2 脚本清单

| 脚本 | 功能 | 依赖 |
|------|------|------|
| `shared.sh` | 公共函数库（日志/API 封装/凭证管理） | - |
| `one-click.sh` | 一键入口（编排 7 个步骤） | CF Token + Turso Token |
| `00-init-project.sh` | Git init + GitHub 仓库创建 + 推送 | gh CLI |
| `01-setup-turso.sh` | Turso DB 创建 + Token + 迁移 | Turso API |
| `02-setup-secrets.sh` | 自动生成所有 Secrets（幂等复用） | openssl |
| `03-deploy-worker.sh` | 构建 + `wrangler deploy --secrets-file` + 冒烟 | CF Token |
| `04-bind-domain.sh` | Workers Custom Domain + HTTPS 等待 | CF API |
| `05-setup-turnstile.sh` | Turnstile Widget 创建 + DB 写入 + Secret | CF API |
| `06-setup-github.sh` | Workflows + Secrets + Variables + 首次触发 | gh CLI |

### 8.3 CI/CD Workflows

| Workflow | 触发条件 | 功能 |
|----------|---------|------|
| `deploy.yml` | push main / dispatch | type-check → test → migrate → deploy → smoke |
| `cleanup-schedule.yml` | 每 2 小时 cron | POST /api/admin/cleanup |
| `backup-daily.yml` | 每日 03:00 UTC | Turso 导出 → GitHub Artifacts (7天) |

### 8.4 关键特性

| 特性 | 说明 |
|------|------|
| **幂等重跑** | `.credentials/.deploy-progress` 跟踪进度，已完成步骤自动跳过 |
| **凭证复用** | 已有凭证自动从 `.credentials/` 读取，不会重复生成 |
| **Secret 命名统一** | 所有项目使用相同的 Secret 名称 |
| **断点续传** | `ONLY=03` 只跑特定步骤 |
| **自动推导** | Account ID / Zone ID / Turso 组织名全部自动获取 |

### 8.5 与三项目对比

| 维度 | 原来（各项目独立） | 现在（统一脚本） |
|------|-------------------|-----------------|
| 脚本数量 | 14 + 10 + 8 = 32 | **8 + 3 workflows** |
| 手动操作 | wrangler login / turso auth | **零手动** |
| Secret 命名 | 各项目不一致 | **统一** |
| GitHub Actions | 手动配置 | **全自动** |

**Phase 4 完成度：8/8（100%）**

---

## 九、总体完成度

| Phase | 内容 | 状态 | 交付物 |
|-------|------|------|--------|
| Phase 1 | 共享内核（19 个模块） | ✅ 100% | `packages/cf-core/src/` |
| Phase 2 | 产品模板（3 个） | ✅ 100% | `templates/cf-{shop,api,tools}/` |
| Phase 3 | 功能模块（6 个） | ✅ 100% | `packages/cf-core/features/` |
| Phase 4 | 自动化部署（8 脚本 + 3 workflows） | ✅ 100% | `templates/.deploy/` |

**全部 4 个 Phase 完成。总测试 81 个，全部通过。**
