# 带存储 Cloudflare 应用开发最佳实践

## 背景

`acctbox` 和普通静态项目的差异非常大。

普通项目：

```text
HTML/CSS/JS
部署到 Pages 或 Workers Static Assets
验证首页 200 和安全响应头
```

带存储项目：

```text
静态资源
Worker API
D1/KV/R2
migration
seed
数据一致性
限流
幂等
备份
管理入口
线上 smoke
```

因此带存储项目不能只按“页面上线”看待，必须按“可运营的小系统”看待。

## 结合 AcctBox 的现状

当前 `acctbox` 已经具备：

```text
1. Cloudflare Workers + Static Assets。
2. D1 数据库绑定。
3. migration 管表结构。
4. seed.sql 演示数据。
5. prepared statement + bind，避免 SQL 拼接。
6. cards / orders 状态约束。
7. issued_order_id UNIQUE。
8. UPDATE ... RETURNING 原子领取库存。
9. 失败后回滚卡密状态。
10. verify / smoke / deploy:full 脚本。
11. WAF 基础防护已生效。
```

仍缺：

```text
1. Turnstile。
2. 应用内限流。
3. idempotency_key。
4. request_logs / audit_logs。
5. 管理接口 ADMIN_TOKEN。
6. 只读 smoke。
7. D1 备份导出脚本。
8. R2 私有下载示例。
9. 更清晰的 service/repository 分层。
```

## 带存储项目和普通项目的核心区别

### 1. 数据有生命周期

普通页面改坏了，可以回滚文件。

带存储项目改坏了，可能已经写坏数据：

```text
订单重复
库存被扣
卡密泄露
表结构不可逆
历史数据不兼容
```

所以必须有：

```text
migrations
backup/export
只读 verify
写入 smoke
数据回滚预案
```

### 2. 部署不等于上线完成

普通项目：

```text
首页 200 基本可接受
```

带存储项目至少要验证：

```text
GET /api/health
GET /api/products
写接口输入校验
写接口限流
写接口幂等
数据库约束
库存不足分支
管理接口鉴权
```

### 3. 测试会改变数据

`acctbox` 的 `smoke` 会真实消耗库存。这是带存储项目的典型差异。

最佳实践：

```text
1. verify：只读，日常巡检用。
2. smoke:write：写入，部署后低频使用。
3. smoke:readonly：后续必须补，避免巡检消耗库存。
4. staging D1：有真实业务后，写入测试不要直接打生产库。
```

### 4. 安全边界更复杂

普通静态站主要是：

```text
CSP
HTTPS
WAF
缓存
```

带存储项目还要：

```text
Turnstile
rate limit
admin auth
idempotency
audit log
secret 管理
数据备份
最小权限 token
```

## 行业成熟轮子

### 1. Cloudflare D1 + Wrangler migrations

定位：

```text
Cloudflare 原生 SQL 存储和迁移工具。
```

适合：

```text
表单
订单
库存
邀请
短链
轻量后台
低流量工具
```

继续保留。

原因：

```text
1. 已经跑通。
2. 和 Workers 部署闭环最短。
3. 免费额度友好。
4. 不需要额外数据库账号。
```

### 2. Hono

定位：

```text
轻量 Web 框架，适合 Cloudflare Workers。
```

适合解决：

```text
路由
中间件
错误处理
请求上下文
鉴权中间件
验证中间件
```

建议：

```text
新项目可以默认用 Hono。
当前 acctbox 暂不强行重构，避免为了框架重构已经跑通的核心链路。
```

### 3. Zod / Valibot

定位：

```text
请求体和环境变量校验。
```

适合解决：

```text
字段类型
长度限制
枚举值
email/contact
环境变量缺失
```

建议：

```text
小项目可以手写校验。
表单字段变多、API 超过 3 个后，引入 Zod 或 Valibot。
```

### 4. Drizzle ORM

定位：

```text
TypeScript SQL ORM，官方支持 Cloudflare D1。
```

适合解决：

```text
schema 类型
查询类型
迁移组织
减少手写 SQL 错误
```

建议：

```text
有 5 张以上表，或多人维护，或业务开始复杂后，引入 Drizzle。
当前 acctbox 表少，手写 SQL 更直接。
```

### 5. Kysely

定位：

```text
类型安全 SQL Query Builder。
```

适合：

```text
想保留 SQL 思维，但希望减少字符串错误。
```

建议：

```text
优先级低于 Drizzle。除非明确不想使用 ORM，只想 query builder。
```

### 6. Cloudflare KV / R2 / Durable Objects

KV：

```text
配置、缓存、短链接、低一致性计数。
不适合作为订单/库存主库。
```

R2：

```text
虚拟资料、文件下载、私有素材。
必须默认私有，下载走 Worker 鉴权或短期签名。
```

Durable Objects：

```text
需要强串行化、房间状态、队列协调、实时协作时再用。
发卡库存量低时，D1 UPDATE ... RETURNING 已足够。
```

## 是否要自己封装

要封装，但不能上来做“大而全平台”。

推荐做一个小型模板包或复制模板：

```text
cf-miniapp-template
```

2026-05-25 已落地为：

```text
templates/cf-form-kit
```

详细方案见：

```text
docs/028_CFFormKit微型框架落地方案_2026-05-25.md
```

只封装重复且已经验证过的内容：

```text
src/lib/http.js
src/lib/validate.js
src/lib/security.js
src/lib/d1.js
src/lib/rate-limit.js
src/lib/idempotency.js
src/lib/admin-auth.js
scripts/check.mjs
scripts/verify-domain.mjs
scripts/smoke-readonly.mjs
scripts/deploy-full.mjs
public/_headers
migrations/0001_init.sql
```

不要封装：

```text
复杂后台
多租户
插件系统
复杂权限模型
自研 ORM
自研迁移系统
自研支付系统
```

## 推荐目录结构

适合后续带存储项目：

```text
project/
  wrangler.jsonc
  package.json
  public/
    index.html
    app.js
    styles.css
    _headers
  src/
    index.js
    routes/
      health.js
      products.js
      orders.js
      admin.js
    lib/
      http.js
      validate.js
      security.js
      d1.js
      rate-limit.js
      idempotency.js
      admin-auth.js
  migrations/
    0001_init.sql
  scripts/
    check.mjs
    verify-domain.mjs
    smoke-readonly.mjs
    smoke-write.mjs
    deploy-full.mjs
  docs/
    001_项目闭环记录_日期.md
```

当前 `acctbox` 还很小，暂时可以不拆这么细。等补 Turnstile、限流、幂等、管理接口时，再按这个结构演进。

## AcctBox 下一步最优改造顺序

不要先引入框架。先补业务安全闭环：

```text
1. 增加只读 smoke，避免每次消耗库存。
2. 增加 request_logs 表，记录 IP、路径、动作、状态。
3. 增加 rate_limits 表或 KV 辅助限流。
4. 给 POST /api/orders 增加 idempotency_key。
5. 接 Turnstile。
6. 增加 ADMIN_TOKEN 保护的管理导入接口。
7. 增加 D1 export/backup 脚本。
8. API 超过 5 个后，引入 Hono。
9. 表超过 5 张或 SQL 开始复杂后，引入 Drizzle。
```

## 标准数据表基线

带存储项目建议默认考虑：

```sql
request_logs(
  id,
  ip_hash,
  method,
  path,
  action,
  status_code,
  created_at
)

idempotency_keys(
  key,
  action,
  resource_id,
  response_json,
  created_at
)

admin_audit_logs(
  id,
  actor,
  action,
  target,
  detail_json,
  created_at
)
```

表单项目可加：

```sql
submissions(
  id,
  form_id,
  contact,
  payload_json,
  status,
  created_at
)
```

发卡项目可加：

```sql
products
cards
orders
delivery_logs
```

## 标准验证闭环

普通项目：

```text
npm run check
curl -I /
curl -I /.env
curl -I /admin
```

带存储项目：

```text
npm run check
npm run db:migrate:local
npm run db:seed:local
npm run verify
npm run smoke:readonly
必要时 npm run smoke:write
Cloudflare WAF 验证
D1 backup/export 验证
```

## 当前推荐栈

### 今天就用

```text
Cloudflare Workers + Static Assets
D1
Wrangler migrations
手写少量 SQL
手写少量校验
根目录 Cloudflare 脚本
WAF 合并规则
```

### 下一批项目默认用

```text
Hono
Zod 或 Valibot
D1
Drizzle（表多时）
Turnstile
R2（虚拟资料下载）
```

### 暂时不要用

```text
大型后台框架
复杂微服务
自研 ORM
自研迁移工具
重型队列系统
多租户平台化抽象
```

## 官方资料

```text
Cloudflare D1 migrations:
https://developers.cloudflare.com/d1/reference/migrations/

Cloudflare D1 query:
https://developers.cloudflare.com/d1/best-practices/query-d1/

Cloudflare D1 indexes:
https://developers.cloudflare.com/d1/best-practices/use-indexes/

Cloudflare D1 import/export:
https://developers.cloudflare.com/d1/best-practices/import-export-data/

Drizzle Cloudflare D1:
https://orm.drizzle.team/docs/connect-cloudflare-d1

Hono Cloudflare Workers:
https://hono.dev/docs/getting-started/cloudflare-workers

Hono validation:
https://hono.dev/docs/guides/validation
```

## 结论

带存储项目的本质不是“多一个数据库”，而是多了数据生命周期、写入风险、权限边界和运维责任。

当前最优路线：

```text
继续以 acctbox 为模板。
先补只读 smoke、限流、幂等、Turnstile、管理鉴权、备份。
等 API 和表结构自然变复杂，再引入 Hono + Zod + Drizzle。
把每次跑通的脚本继续沉淀为模板，而不是抽象成大平台。
```
