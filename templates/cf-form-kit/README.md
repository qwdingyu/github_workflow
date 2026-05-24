# CF Form Kit

Cloudflare Workers + D1 的表单、信息收集、轻交互微型模板。

目标：

```text
后续新项目只改业务配置、页面文案和少量样式。
部署、D1、校验、限流、幂等、安全头、验证脚本复用。
```

## 技术栈

```text
Runtime: Cloudflare Workers + Static Assets
Routing: Hono
Validation: Zod + @hono/zod-validator
Storage: Cloudflare D1
Schema: Drizzle ORM schema
Migration: Wrangler D1 migrations
Security: Turnstile 可选、D1 限流、幂等键、ADMIN_TOKEN
```

## 业务修改入口

优先改：

```text
src/config/forms.ts
public/index.html
public/styles.css
wrangler.jsonc 的 name/database_name/vars
```

不要优先改：

```text
src/lib/*
scripts/*
migrations/0001_init.sql
```

除非业务确实需要扩展底层能力。

## 本地启动

```bash
rtk npm install
rtk npm run db:migrate:local
rtk npm run db:seed:local
rtk npm run dev
```

另一个终端：

```bash
rtk npm run smoke:readonly
rtk npm run smoke:write
```

注意：`smoke:write` 会写入一条 submission。

## 新项目复制步骤

```bash
rtk cp -R templates/cf-form-kit ../my-form-app
cd ../my-form-app
rtk git init
rtk npm install
```

然后修改：

```text
package.json name
wrangler.jsonc name
wrangler.jsonc d1_databases[0].database_name
src/config/forms.ts
public/index.html
```

创建 D1：

```bash
CLOUDFLARE_API_TOKEN="<token>" rtk npx wrangler d1 create my-form-app-db
```

把输出里的 `database_id` 写入 `wrangler.jsonc`。

远程部署：

```bash
CLOUDFLARE_API_TOKEN="<token>" \
FORMKIT_SEED_REMOTE=false \
BASE_URL="https://<worker-subdomain>.workers.dev" \
rtk npm run deploy:full
```

绑定域名后：

```bash
BASE_URL="https://your-subdomain.eforge.xyz" rtk npm run smoke:readonly
```

## API

```text
GET  /api/health
GET  /api/forms/:slug
POST /api/forms/:slug/submissions
GET  /api/admin/submissions
```

管理接口：

```bash
Authorization: Bearer <ADMIN_TOKEN>
```

生产设置：

```bash
rtk npx wrangler secret put ADMIN_TOKEN
rtk npx wrangler secret put TURNSTILE_SECRET_KEY
rtk npx wrangler secret put RATE_LIMIT_SALT
```

## 安全默认值

```text
1. POST 提交走 Zod 校验。
2. 业务字段在 src/config/forms.ts 二次校验。
3. 如果配置 TURNSTILE_SECRET_KEY，则提交必须通过 Turnstile。
4. 每 IP 每表单每分钟默认最多 5 次提交。
5. 支持 Idempotency-Key，避免重复提交。
6. 管理接口必须 ADMIN_TOKEN。
7. public/_headers 提供基础安全响应头。
```

## 何时引入更多能力

```text
需要文件下载：加 R2 私有下载。
需要支付：加支付回调签名和订单幂等。
需要复杂后台：先加只读 admin API，不急着上大后台。
表超过 5 张：再评估是否引入 drizzle-kit 生成迁移。
```

说明：模板默认不安装 `drizzle-kit`。当前迁移主线是 Wrangler migrations，`drizzle-orm` 用于 schema 和查询类型。表结构复杂后，再按需引入 `drizzle-kit`，避免默认模板带来不必要的开发依赖审计噪音。

注意：`wrangler.jsonc` 的 `compatibility_date` 不能写未来日期。模板默认使用已验证可被 Wrangler 4.94.0 接受的 `2026-05-24`。

## 关于 drizzle-kit 和 SQL

模板默认不安装 `drizzle-kit`，但保留 `drizzle-orm`。

区别：

```text
drizzle-orm：运行时 ORM / query builder，用于类型化查询。
drizzle-kit：开发期迁移工具，用于生成 migration。
Wrangler migrations：当前模板默认 D1 迁移执行方式。
```

SQL 安全规则：

```text
1. 用户输入先过 Zod。
2. 业务字段再过 src/config/forms.ts 校验。
3. Raw SQL 必须 prepare().bind()。
4. 常规 CRUD 优先使用 drizzle-orm。
5. 禁止拼接用户输入到 SQL 字符串。
```

引入 `drizzle-kit` 的时机：

```text
表超过 5 张，schema 变化频繁，或多人协作需要从 schema 自动生成 migration。
```
