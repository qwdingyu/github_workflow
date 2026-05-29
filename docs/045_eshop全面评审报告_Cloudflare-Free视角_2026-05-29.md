# eshop 全面评审报告 — Cloudflare Free 视角

> 日期：2026-05-29
> 范围：eshop 项目全量代码（~11,890 行 TypeScript）
> 约束：**Cloudflare Workers Free 套餐**

---

## 一、Cloudflare Free 套餐核心约束

| 指标 | Free 限制 | 影响 |
|------|-----------|------|
| 请求配额 | **100,000 次/天**（~1.16 QPS 平均） | 每个请求都必须精打细算 |
| CPU 时间 | **10ms / 请求**（累计） | 邮件重试、复杂查询会吃掉配额 |
| 并发 | 无明确限制，但受 CPU 总量约束 | 突发流量可能触发限流 |
| Bundle 大小 | **1MB**（压缩后） | 依赖包必须精简 |
| Durable Objects | ❌ 不可用 | 不能用 DO 做分布式锁 |
| Analytics Engine | ❌ 不可用 | 不能用 AE 做实时分析 |
| Tail Workers | ❌ 不可用 | 不能用 Tail 做日志聚合 |
| Cache API | ✅ **完全免费，不计入 10 万请求** | **最重要的免费优化手段** |
| Cron Triggers | ❌ **Free 不支持** | `scheduled` handler 在 Free 部署中永远不会被调用 |
| Static Assets | ✅ 免费 | 但 `run_worker_first: true` 每次仍消耗 Worker 请求 |

**关键洞察**：Cache API 不计入请求配额，这是 Free 套餐下**唯一能免费扩容的手段**。Static Assets 的 `run_worker_first: true` 意味着每个静态文件请求也消耗 1 次 Worker 请求——这是最大的隐形消耗。

---

## 二、架构评审

### 2.1 技术栈选择

| 组件 | 选择 | Free 适配度 | 评价 |
|------|------|-------------|------|
| 运行时 | Cloudflare Workers | ✅ 原生 | — |
| 框架 | Hono | ✅ 极佳 | 冷启动 ~5ms，远优于 Express/Fastify |
| ORM | Drizzle ORM | ✅ 良好 | 轻量，编译时类型安全 |
| 数据库 | Turso (libSQL) | ✅ 优秀 | Free 9GB/月，无行读取限制，优于 D1 Free（5GB） |
| 前端 | Vue 3 + Vite | ✅ 良好 | 构建产物哈希化，利于缓存 |
| 支付 | 支付宝当面付 | ✅ 良好 | 个人可用，0.6% 费率 |
| 邮件 | Resend | ✅ 良好 | Free 3K 封/月，满足初期需求 |
| 验证 | Cloudflare Turnstile | ✅ 良好 | 免费，替代 reCAPTCHA |

**评分：8.5/10** — 技术栈选择非常契合 Free 套餐，Hono + Turso 是最佳组合。

### 2.2 架构模式

```
用户请求 → Workers (run_worker_first)
                ├── /api/* → Hono 路由 → Turso DB
                ├── /admin/* → Static Assets
                ├── /_app/* → Static Assets (Vue3)
                └── /* → Static Assets (SPA fallback)
```

**优点**：
- 路由分层清晰，API / 管理 / 前端分离
- 中间件链短（DB 初始化 → 请求体限制 → 路由）
- 错误处理统一（onError + notFound）

**问题**：
1. **`run_worker_first: true` 导致所有静态请求消耗 Worker 配额**
   - 一个用户访问页面 = 1 HTML + 5-8 JS/CSS assets = **6-9 次 Worker 请求**
   - 100 个日活用户 = 600-900 次请求仅用于静态文件
   - **优化方案**：对 `/_app/assets/*` 设置 `Cache-Control: immutable`，让 Cloudflare Edge Cache 拦截，不再到达 Worker

2. **CSP 头在每个请求中动态拼接**
   - 每次请求都执行字符串模板拼接
   - **优化方案**：预计算两个 CSP 字符串（admin / non-admin），直接选择

---

## 三、资源效率评审（核心关注点）

### 3.1 已完成的优化 ✅

| 优化 | 状态 | 效果 |
|------|------|------|
| Cache API 封装（`src/lib/cache.ts`） | ✅ 完成 | 商品列表/详情/系统配置缓存 |
| 商品列表 Cache API 缓存（5 分钟） | ✅ 完成 | 减少 ~60% 商品查询的 DB 请求 |
| 系统配置 Cache API 缓存（30 分钟） | ✅ 完成 | 几乎消除重复配置查询 |
| 数据库连接复用（isolate 级别） | ✅ 完成 | 节省 ~1ms CPU/请求 |
| 健康检查合并查询（3→1） | ✅ 完成 | 减少 2 次网络往返 |
| 静态资源长缓存（`/_app/assets/*`） | ✅ 完成 | 浏览器缓存 1 年 |

### 3.2 待优化的资源浪费点

#### P0 — 邮件发送占用 CPU 时间

**现状**：`email-service.ts` 的重试逻辑（500ms + 1000ms + 2000ms = 最多 3.5 秒）在请求上下文中执行。虽然使用了 `.catch()` fire-and-forget 模式（不 await），但 **Worker 的 CPU 计时在响应返回后仍然继续**，直到所有 promise 完成。

**影响**：每封邮件最多消耗 3.5 秒 CPU，Free 套餐每天 100 万秒 CPU。如果每天 10 封邮件都重试 3 次 = 35 秒，看似不多，但**单次请求的 10ms CPU 限制**意味着邮件发送期间的请求可能超时。

**优化方案**：使用 `ctx.waitUntil()` 将邮件发送放到响应返回后异步执行：
```typescript
// 当前（浪费 CPU）：
sendEmail(...).catch(console.warn);

// 优化后（异步，不占请求 CPU）：
c.get("executionCtx").waitUntil(sendEmail(...));
```

**邮件发送位置（5 处）**：
| 文件 | 行号 | 场景 |
|------|------|------|
| `order-service.ts` | ~39 | 订单过期通知 |
| `order-service.ts` | ~247 | manual 下单通知 |
| `order-service.ts` | ~332 | direct 发卡通知 |
| `order-service.ts` | ~510 | 管理员确认发卡通知 |
| `pay.ts` | ~128 | 线下支付下单通知 |

#### P0 — 管理后台缓存未失效

**现状**：`products.ts` 和 `system-config.ts` 已使用 Cache API，但 `admin.ts` 中修改商品/配置后**没有清除缓存**，导致用户看到过期数据。

**优化方案**：在 admin 写操作后调用 `cacheDelete()`：
```typescript
// admin.ts 中修改商品后：
await cacheDelete(cacheKey("/products"));
await cacheDelete(cacheKey(`/products/${slug}`));
```

#### P1 — Static Assets `run_worker_first` 优化

**现状**：`wrangler.jsonc` 中 `run_worker_first: true`，所有静态文件请求都经过 Worker。

**优化方案**：对纯静态资源路径（`/_app/assets/*`）直接 `env.ASSETS.fetch()` 并设置长缓存头，利用 Cloudflare Edge Cache。当前代码已设置 `Cache-Control: immutable`，但 Worker 仍然执行了——可以考虑在 `wrangler.jsonc` 中设置 `asset_config` 规则，让部分路径绕过 Worker。

#### P0 — Cron Trigger 不可用导致日志无限增长（已修复）

**现状**：`wrangler.jsonc` 中配置了 `*/5 * * * *` Cron，但 **Cloudflare Free 完全不支持 Cron Triggers**（官方 limits 页面明确说明）。这意味着 `scheduled` handler 永远不会被调用。

**影响**：
1. **过期订单和僵尸卡密无法自动清理** — `cleanup-service.ts` 依赖 Cron 执行，Free 部署中永远不会运行
2. **5 张日志表无限增长** — `request_logs`、`card_logs`、`admin_audit_logs`、`email_logs`、`order_events` 没有任何清理机制，最终耗尽 Turso Free 9GB 存储

**修复方案**：内联 TTL 清理（Inline TTL Cleanup）
- 每次写入日志时，以 5% 概率异步清理超期旧记录
- TTL 策略：`request_logs` 30 天，`email_logs` 30 天，`card_logs`/`admin_audit_logs`/`order_events` 90 天
- 使用 `db.$client.execute()` 执行原始 SQL DELETE，fire-and-forget 不阻塞主流程
- 移除 `wrangler.jsonc` 中无效的 Cron 配置
- `index.ts` 中 `scheduled` handler 添加注释说明 Free 不支持

---

## 四、业务逻辑评审

### 4.1 发卡流程

```
下单 → 软锁定卡密 → 创建 pending 订单 → 支付/确认 → 原子发卡 → 发邮件
                                           ↓ 过期
                                      内联 checkAndExpire → 释放卡密
```

**优点**：
- 软锁定防超卖（`lock_expires_at` 兜底）
- 原子发卡（`UPDATE...RETURNING`）
- 恢复路径处理崩溃场景
- 并发安全（订单状态机：pending → paid → issued）
- **Free 适配**：过期检查改为内联触发（每次查询订单状态时执行 checkAndExpire），不依赖 Cron

**评分：9/10** — 发卡逻辑是项目最强的部分，考虑了各种边界情况。

### 4.2 支付集成

| 渠道 | 状态 | 评价 |
|------|------|------|
| 支付宝当面付 | ✅ 完整 | 签名/回调/轮询全链路，332 测试全通过 |
| PayJS | ⚠️ 已暴雷 | 代码保留但标注不推荐 |
| 线下支付 | ✅ 完整 | 备注码对账，管理员确认 |

**评分：8/10** — 支付宝集成质量高，但 PayJS 残留代码增加维护负担。

### 4.3 折扣码系统

- 支持百分比/固定金额折扣
- 支持商品绑定/通用码
- 支持使用次数限制
- 下单时报价，确认时消耗（防止回退问题）

**评分：8.5/10** — 设计合理，边界情况处理到位。

---

## 五、安全评审

| 项目 | 状态 | 评价 |
|------|------|------|
| CSP 头 | ✅ | 动态区分 admin/non-admin |
| X-Frame-Options | ✅ | DENY |
| X-Content-Type-Options | ✅ | nosniff |
| Admin Token 认证 | ✅ | Bearer token，不存 vars |
| 请求体限制 | ✅ | 100KB |
| SQL 注入防护 | ✅ | Drizzle ORM + 参数化 SQL |
| XSS 防护 | ✅ | 模板转义（`escapeHtml`） |
| IP 哈希 | ✅ | 不存明文 IP |
| 订单 Token | ✅ | SHA-256 哈希存储 |
| Turnstile | ✅ | 可选，防机器人 |
| 卡密可见性 | ✅ | 仅发卡后通过 token 查询 |

**评分：8.5/10** — 安全基线扎实。改进空间：admin token 轮换自动化、速率限制更精细。

---

## 六、测试评审

| 指标 | 数值 |
|------|------|
| 测试文件数 | 17 |
| 总测试数 | **332** |
| 通过率 | 100% |
| TypeScript 类型检查 | ✅ 零错误 |

**覆盖亮点**：
- 支付宝签名/回调全链路测试
- 订单状态机测试
- 并发场景测试
- 幂等性测试

**缺失**：
- Cache API 测试（新模块未测试）
- 端到端集成测试
- 性能基准测试

**评分：8/10** — 单元测试覆盖优秀，缺少集成和性能测试。

---

## 七、综合评分

| 维度 | 分数（/10） | 权重 | 加权分 |
|------|------------|------|--------|
| 技术栈适配 Free | 8.5 | 15% | 1.28 |
| **资源效率** | **6.0** | **25%** | **1.50** |
| 业务逻辑正确性 | 9.0 | 20% | 1.80 |
| 安全性 | 8.5 | 15% | 1.28 |
| 测试覆盖 | 8.0 | 10% | 0.80 |
| 代码可维护性 | 7.5 | 10% | 0.75 |
| **总计** | | | **7.41/10** |

**资源效率是最大短板**（6.0/10），主要因为：
1. 邮件发送同步占用 CPU（待优化）
2. 管理后台缓存未失效（待优化）
3. Static Assets 每次经过 Worker

**优化后预期**：资源效率 → 8.5/10，总分 → **8.0/10**

---

## 八、优化优先级路线图

### P0 — 立即执行（本次）

| # | 优化 | 影响 | 工作量 |
|---|------|------|--------|
| 1 | `ctx.waitUntil()` 邮件异步化 | 节省 ~3.5s CPU/邮件 | 中 |
| 2 | Admin 写操作后清除 Cache API | 数据一致性 | 小 |
| 3 | CSP 头预计算 | 节省 ~0.1ms CPU/请求 | 小 |

### P1 — 近期执行

| # | 优化 | 影响 | 工作量 |
|---|------|------|--------|
| 4 | Cache API 单元测试 | 质量保障 | 中 |
| 5 | 删除 PayJS 残留代码 | 减少维护负担 | 中 |

### P2 — 长期考虑

| # | 优化 | 影响 | 工作量 |
|---|------|------|--------|
| 7 | Static Assets 绕过 Worker | 大幅减少请求消耗 | 大 |
| 8 | 监控告警（请求配额使用率） | 运营安全 | 中 |
| 9 | 前端 SSR/SSG | 减少 API 调用 | 大 |

---

## 九、Free vs Paid 决策参考

**继续使用 Free 的条件**：
- 日活 < 500 用户
- 日订单 < 100 笔
- 商品数 < 50 个
- 不需要实时数据分析

**升级到 Pro ($20/月) 的触发条件**：
- 日请求 > 10 万（Free 上限）
- 需要 Durable Objects（分布式锁/会话）
- 需要 Cron Triggers（定期清理/定时任务）
- 需要 Tail Workers（日志聚合）

**当前状态**：完全适合 Free 套餐，优化后可持续支撑 ~500 DAU。

---

*报告结束。开始执行 P0 优化。*
