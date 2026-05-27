# AcctBox 发卡平台技术栈深度分析

> 分析时间: 2026-05-27
> 分析范围: github_workflow/docs(40篇)、acctbox源码、scripts/cloudflare
> 分析视角: 技术架构 + 踩坑经验 + D1/libSQL 双引擎设计

---

## 一、项目定位

AcctBox 是一个**虚拟账号发卡平台**，运行在 Cloudflare 免费层上，目标是：

```
零服务器成本
全自动发卡（用户付款 → 系统自动交付卡密）
可批量复制到其他数字商品场景
```

正式域名: https://eshop.eforge.xyz
回退域名: https://eshop.mailforwdy.workers.dev

---

## 二、当前技术栈全景

```
┌─────────────────────────────────────────────────────┐
│                    用户浏览器                         │
│         Vue3 + Element Plus（黑色科技感主题）          │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────┐
│              Cloudflare 边缘层（免费）                 │
│  WAF · Turnstile · DNS · TLS · Bot Management       │
│  Workers Custom Domains · 响应头安全策略              │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│           Cloudflare Workers（边缘计算）               │
│                                                      │
│  Hono（路由框架）                                     │
│  ├── Zod（输入校验）                                  │
│  ├── Drizzle ORM（SQL 查询）                          │
│  ├── 自定义 Database 抽象层                           │
│  │   ├── D1Adapter（默认）                            │
│  │   └── TursoAdapter（可选）                         │
│  ├── 限流中间件（rate-limit.ts）                      │
│  ├── 幂等中间件（idempotency.ts）                     │
│  ├── 安全中间件（security.ts）                        │
│  └── 审计日志（audit-service.ts）                     │
│                                                      │
│  路由分层:                                            │
│  /api/health        ← 公开                           │
│  /api/products      ← 公开（商品列表）                 │
│  /api/orders        ← 公开（下单）                    │
│  /api/orders/lookup ← 公开（用户查询）                 │
│  /api/pay/*         ← 公开（支付回调）                 │
│  /api/system-config ← 公开（白名单参数）               │
│  /api/admin/*       ← Bearer Token 保护              │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│               数据层（二选一，配置切换）                │
│                                                      │
│  Cloudflare D1（默认）         Turso / libSQL（备选）  │
│  ├── 免费额度: 5M读/天         ├── 免费额度: 更大       │
│  ├── 写入限制: 72-150单/天     ├── 无严格写入限制       │
│  ├── Workers 原生绑定          ├── 需要 URL + Token    │
│  └── wrangler migrations      └── 脚本迁移            │
│                                                      │
│  共用 Schema: Drizzle ORM + SQLite 语法               │
│  6张核心表: products / cards / card_batches /          │
│            orders / coupons / campaigns               │
└─────────────────────────────────────────────────────┘
```

### 核心依赖

| 组件 | 技术选型 | 作用 |
|------|----------|------|
| 运行时 | Cloudflare Workers | 边缘计算，零服务器 |
| 路由 | Hono | 轻量路由框架，类 Express |
| 校验 | Zod | 输入边界校验 |
| ORM | Drizzle ORM | 类型安全的 SQL 查询 |
| 数据库 | D1 / Turso(libSQL) | SQLite 兼容，配置切换 |
| 前端 | Vue3 + Element Plus | 管理端 + 用户端 |
| 邮件 | Resend | 订单发卡通知 |
| 验证码 | Cloudflare Turnstile | 防机器人 |
| 部署 | Wrangler + GitHub Builds | 自动部署 |
| 测试 | Vitest | 单元测试 |

---

## 三、D1 与 libSQL 双引擎切换设计

这是本项目**最有价值的架构设计**。

### 3.1 设计动机

```
D1 免费层限制:
  - 日均写入上限 72-150 单（混合场景）
  - 超出需付费 $0.75/百万行读 + $1.00/百万行写

Turso/libSQL 免费层:
  - 更大的读写配额
  - 适合商业化扩张
```

因此项目设计了**配置级切换**，只需改环境变量即可换数据库后端。

### 3.2 架构实现（三层抽象）

```
第一层: Database 接口（database.ts）
├── prepare(sql): PreparedStatement
├── batch(stmts): BatchStatement[]
├── toD1(): D1Database
└── toLibSql?(): LibSQLClient

第二层: 适配器
├── D1Adapter（database.ts 内）
│   └── 包装 Cloudflare D1 binding
└── TursoAdapter（turso-adapter.ts）
    └── 包装 @libsql/client/web
    └── 自动转换 ?1,?2 → ? 占位符

第三层: Drizzle ORM 工厂（client.ts）
├── 检测 db.toLibSql() 是否可用
├── 可用 → libsqlDrizzle(client)
└── 不可用 → d1Drizzle(db.toD1())
```

### 3.3 切换方式

```typescript
// index.ts 中间件
const provider = c.env.DATABASE_PROVIDER || "d1";
if (provider === "turso") {
  const client = createClient({ url: c.env.TURSO_URL, authToken: c.env.TURSO_TOKEN });
  c.set("db", new TursoAdapter(client));
} else {
  c.set("db", new D1Adapter(c.env.DB));
}
```

切换只需在 wrangler.jsonc 或环境变量中设置：

```json
{
  "vars": {
    "DATABASE_PROVIDER": "turso",
    "TURSO_URL": "libsql://xxx.turso.io",
    "TURSO_TOKEN": "..."
  }
}
```

### 3.4 关键踩坑：占位符差异

```
D1 支持编号参数:  ?1, ?2, ?3（可重复引用）
libSQL 只支持:    ?（位置参数，按顺序消费）

TursoAdapter 中的 normalizePlaceholders() 函数:
  ?1 → ?  (args[0])
  ?2 → ?  (args[1])
  ?1 → ?  (args[0] 再次复制到新位置)
```

这是**最容易出 bug 的地方**，已在 TursoAdapter 中解决。

---

## 四、已踩过的坑（按严重程度排序）

### 🔴 P0 级（致命）

#### 4.1 PayJS 爆雷

```
问题: PayJS（推荐的支付方案）已爆雷，无法继续使用
影响: 在线支付链路完全断裂
状态: 已在 bindings.ts 中标注 "⚠️ PayJS 已爆雷"
解决: 需替换为虎皮椒或 Stripe
```

#### 4.2 线下支付无库存锁定

```
问题: 用户创建线下订单后，管理员确认前不锁定卡密
场景: A 下单 → B 扫码购买抢走库存 → A 付款 → 管理员发卡时库存不足
影响: "用户已付款，商家却没货" 的商业灾难
解决: 需实现 Soft Lock 机制（创建订单时预锁定卡密）
```

### 🟡 P1 级（严重）

#### 4.3 单文件 Worker 架构

```
问题: V1 是单文件 JavaScript Worker，扩展困难
V2 改进: TypeScript + Hono 路由分层 + 服务层分离
状态: 已完成重构
```

#### 4.4 概念混乱："兑换码" vs "折扣码"

```
问题: 早期把 coupons 叫"兑换码"，导致概念二义性
影响: 前后端字段、UI 文案、文档全部混乱
解决: 铁律级文档 033 强制统一叫"折扣码"
教训: 业务术语必须在项目第一天就定死
```

#### 4.5 require_email 参数设计缺陷

```
问题: 允许不填邮箱导致历史订单 buyer_email=null
影响: 订单不可溯源，查询链路必须兼容"没邮箱"的边界 case
解决: 邮箱强制必填，历史数据保留不动
```

### 🟢 P2 级（重要）

#### 4.6 D1 免费额度天花板

```
问题: D1 Free Plan 日均写入上限仅 72-150 单
影响: 商业化扩张受限
解决: 已实现 Turso/libSQL 双引擎切换
```

#### 4.7 占位符语法差异

```
问题: D1 支持 ?1,?2 编号参数，libSQL 只支持 ? 位置参数
影响: 直接迁移会 SQL 报错
解决: TursoAdapter.normalizePlaceholders() 自动转换
```

#### 4.8 邮件模板字段错误

```
问题: email-service.ts 中 order_no 用了内部 ID 而非 orderNo
影响: 用户收到的邮件显示错误的订单号
状态: 已发现，待修复
```

#### 4.9 域名生效异常

```
问题: Workers Custom Domains 绑定后需要等待证书签发
踩坑: 不是即时生效，需要轮询等待
解决: workers_custom_domain_bind.mjs 脚本内置等待逻辑
```

---

## 五、已实现的安全加固

```
三层防线:
├── 第一层: Cloudflare 边缘
│   ├── WAF Custom Rules（阻断危险路径）
│   ├── Bot Management（防爬虫）
│   ├── Turnstile（人机验证）
│   └── TLS / HTTPS / 安全响应头
│
├── 第二层: Worker 应用层
│   ├── Zod 输入校验（所有接口）
│   ├── 限流（rate-limit.ts）
│   ├── 幂等（idempotency.ts）
│   ├── ADMIN_TOKEN 鉴权（管理接口）
│   └── 请求体大小限制（100KB）
│
└── 第三层: 数据层
    ├── Prepared Statements（防 SQL 注入）
    ├── IP 哈希化（RATE_LIMIT_SALT）
    ├── 审计日志（audit-service.ts）
    └── D1 最小权限绑定
```

---

## 六、部署与运维体系

### 自动化脚本

| 脚本 | 作用 |
|------|------|
| `scripts/deploy-full.mjs` | 完整部署流程 |
| `scripts/smoke-readonly.mjs` | 只读冒烟测试 |
| `scripts/smoke-write.mjs` | 写入冒烟测试 |
| `scripts/smoke-admin.mjs` | 管理端冒烟测试 |
| `scripts/verify-domain.mjs` | 域名验证 |
| `scripts/check.mjs` | 配置检查 |
| `scripts/cloudflare/security_baseline.mjs` | 安全基线配置 |
| `scripts/cloudflare/workers_custom_domain_bind.mjs` | 域名绑定 |
| `scripts/cloudflare/write_security_headers.mjs` | 安全响应头 |

### 部署流程

```
git push main
  → GitHub Builds 自动触发
  → npx wrangler deploy
  → Workers Static Assets 更新
  → smoke 测试验证
```

### 数据库迁移

```bash
# D1 本地
npm run db:migrate:local

# D1 远程
npm run db:migrate:remote

# Turso
npm run db:migrate:turso
```

---

## 七、构建类似平台的路线图

### 第一步: 基础设施（1天）

```
1. 注册 Cloudflare 账号
2. 创建 D1 数据库: wrangler d1 create xxx-db
3. 创建 Workers 项目: npm create cloudflare@latest
4. 配置 wrangler.jsonc（D1 绑定、静态资源、域名）
5. 绑定自定义域名
```

### 第二步: 数据层（1天）

```
1. Drizzle ORM + SQLite schema 定义
2. D1Adapter / TursoAdapter 双引擎抽象
3. migration 文件管理
4. seed.sql 演示数据
```

### 第三步: 业务层（2-3天）

```
1. Hono 路由分层（公开 / 管理）
2. Zod 输入校验
3. 商品 CRUD
4. 卡密导入/导出
5. 下单 → 发卡原子操作（UPDATE ... RETURNING）
6. 订单查询（orderNo / orderToken / 邮箱）
```

### 第四步: 安全加固（1天）

```
1. ADMIN_TOKEN 管理鉴权
2. Turnstile 人机验证
3. 限流 + 幂等
4. WAF 基线配置
5. 安全响应头
```

### 第五步: 前端（2天）

```
1. 用户端: 商品展示 + 下单 + 查询
2. 管理端: 商品管理 + 卡密导入 + 订单管理
3. 黑色科技感主题
```

### 第六步: 支付接入（1天）

```
1. PayJS / 虎皮椒 / Stripe（三选一）
2. 支付回调处理
3. 自动发卡触发
```

### 第七步: 运维闭环（1天）

```
1. smoke 脚本（只读/写入/管理）
2. 域名验证脚本
3. 安全基线脚本
4. 文档固化
```

---

## 八、关键技术决策总结

| 决策 | 选择 | 原因 |
|------|------|------|
| 运行时 | Cloudflare Workers | 零成本、免运维、全球边缘 |
| 数据库 | D1 + Turso 双引擎 | D1 免费额度有限，Turso 做商业化备选 |
| ORM | Drizzle ORM | 类型安全、SQLite 兼容、轻量 |
| 路由 | Hono | 轻量、TypeScript 友好、类 Express |
| 校验 | Zod | 运行时类型校验、与 Drizzle 集成 |
| 安全 | 三层防线 | 边缘+应用+数据，不过度工程化 |
| 部署 | GitHub Builds + Wrangler | 自动化、零人工干预 |
| 前端 | Vue3 + Element Plus | 快速开发、组件丰富 |

---

## 九、与接码平台的技术关联

如果要构建类似 fivesim 的接码平台，可以复用 AcctBox 的：

```
✅ Cloudflare Workers + D1 基础架构
✅ Database 抽象层（D1/Turso 双引擎）
✅ Hono 路由 + Zod 校验 + Drizzle ORM
✅ 安全三层防线
✅ 部署与 smoke 脚本体系
✅ 管理端鉴权方案

⚠️ 需要新增:
  - 号码池管理（类似 cards 表）
  - 短信接收回调（Webhook）
  - 多渠道对接（5sim / GrizzlySMS API）
  - 实时库存同步
  - 用户余额/充值系统
```

---

## 十、核心文件索引

| 文件 | 作用 |
|------|------|
| `src/index.ts` | 入口，路由注册，数据库中间件 |
| `src/bindings.ts` | 环境变量类型定义 |
| `src/db/database.ts` | Database 接口 + D1Adapter |
| `src/db/turso-adapter.ts` | TursoAdapter + 占位符转换 |
| `src/db/client.ts` | Drizzle ORM 工厂 |
| `src/db/schema.ts` | 表结构定义 |
| `src/routes/*.ts` | 路由层 |
| `src/services/*.ts` | 业务服务层 |
| `src/lib/*.ts` | 工具库（安全/限流/幂等） |
| `wrangler.jsonc` | 部署配置 |
| `docs/033_*` | 业务术语铁律 |
| `docs/035_*` | 核心问题清单 |
| `docs/036_*` | 架构安全审核 |
