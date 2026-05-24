# Cloudflare 脚本变量与核心逻辑契约

## 目的

这份文档是给后续 AI 和人工操作者看的“不可猜测契约”。

目标不是再解释 Cloudflare 的概念，而是把当前仓库中脚本的核心变量、推导逻辑、API 依赖、幂等边界和禁止误判点写死，避免下次继续重新探索、猜测、调试半天。

涉及脚本：

```text
scripts/cloudflare/pages_github_domain_workflow.mjs
scripts/cloudflare/workers_custom_domain_bind.mjs
scripts/cloudflare/capability_probe.mjs
```

## 总原则

### 只允许从事实源获取的值

以下值不要猜：

```text
Cloudflare account id
Cloudflare zone id
Cloudflare Pages project.subdomain
Cloudflare Worker service
Cloudflare Workers custom domain id
DNS record id
```

来源必须是：

```text
Cloudflare API
git remote.origin.url
用户显式传入的环境变量
```

### 禁止再犯的错误

```text
1. 不要把 Pages 和 Workers 当成同一套域名流程。
2. 不要拼接 <project>.pages.dev。
3. 不要把 Global API Key 当 Bearer token。
4. 不要看到 Workers 的 AAAA 100:: 就认为 DNS 错了。
5. 不要直接删除旧域名来完成“更换域名”。
6. 不要在 Pages 项目上执行 wrangler deploy。
7. 不要为了省事跳过 curl 和 Cloudflare API 验证。
```

## 鉴权变量契约

### 两种鉴权方式

方式 A：Bearer Token

```text
CF_API_TOKEN
```

脚本会发送：

```text
Authorization: Bearer <CF_API_TOKEN>
```

方式 B：Global API Key

```text
CF_AUTH_EMAIL
CF_GLOBAL_API_KEY
```

脚本会发送：

```text
X-Auth-Email: <CF_AUTH_EMAIL>
X-Auth-Key: <CF_GLOBAL_API_KEY>
```

### 关键区别

```text
cfat_... 通常是 API Token，按 Bearer 使用。
cfk_... 是 Global API Key，必须配合 X-Auth-Email + X-Auth-Key 使用。
```

错误用法：

```text
Authorization: Bearer cfk_...
```

正确用法：

```text
X-Auth-Email: <cloudflare-email>
X-Auth-Key: cfk_...
```

### DNS 单独鉴权

`pages_github_domain_workflow.mjs` 支持 DNS 使用独立凭据：

```text
CF_DNS_API_TOKEN
CF_DNS_AUTH_EMAIL
CF_DNS_GLOBAL_API_KEY
```

优先级：

```text
DNS 请求优先 CF_DNS_API_TOKEN
其次 CF_DNS_AUTH_EMAIL + CF_DNS_GLOBAL_API_KEY
再退回 CF_AUTH_EMAIL + CF_GLOBAL_API_KEY
最后才尝试 CF_API_TOKEN
```

原因：Pages 管理权限和 DNS 写入权限经常不在同一个 token 上。

## Pages 脚本契约

脚本：

```text
scripts/cloudflare/pages_github_domain_workflow.mjs
```

适用项目：

```text
Cloudflare Pages 静态站点
Pages Functions 项目
落地页、展示页、工具页、资料页
```

不适用：

```text
Cloudflare Workers 项目
需要 Workers Custom Domains 的项目
VPS 服务
Vercel 项目
```

### 最小变量

当前推荐最小配置：

```bash
CF_AUTH_EMAIL="<cloudflare-email>" \
CF_GLOBAL_API_KEY="<global-api-key>" \
CF_CUSTOM_DOMAIN="tool.eforge.xyz" \
node ../scripts/cloudflare/pages_github_domain_workflow.mjs
```

实际只有 `CF_CUSTOM_DOMAIN` 是业务意图必填；鉴权必须通过 `CF_API_TOKEN` 或 `CF_AUTH_EMAIL + CF_GLOBAL_API_KEY` 提供。

### 核心变量表

| 变量 | 必填 | 默认/推导 | 说明 |
| --- | --- | --- | --- |
| `CF_CUSTOM_DOMAIN` | 是 | 无 | 要绑定的正式域名，例如 `tool.eforge.xyz` |
| `CF_API_TOKEN` | 鉴权二选一 | 无 | Bearer Token，用于 Pages/Cloudflare API |
| `CF_AUTH_EMAIL` | 鉴权二选一 | 无 | Global API Key 模式下的账号邮箱 |
| `CF_GLOBAL_API_KEY` | 鉴权二选一 | 无 | Global API Key，不是 Bearer token |
| `CF_ACCOUNT_ID` | 否 | 如果账号列表只有一个则自动推导 | 多账号时必须传 |
| `CF_ZONE_ID` | 否 | 由 `CF_ZONE_NAME` 或域名后两段查询 | 多 zone 或特殊域名时建议传 |
| `CF_ZONE_NAME` | 否 | 从 `CF_CUSTOM_DOMAIN` 取最后两段 | 例如 `tool.eforge.xyz` 推导为 `eforge.xyz` |
| `CF_PAGES_PROJECT` | 否 | GitHub repo name | Cloudflare Pages project 名称 |
| `CF_GITHUB_OWNER` | 否 | 从 `git remote.origin.url` 解析 | GitHub owner |
| `CF_GITHUB_REPO` | 否 | 从 `git remote.origin.url` 解析 | GitHub repo |
| `CF_PRODUCTION_BRANCH` | 否 | `main` | Pages production branch |
| `CF_BUILD_COMMAND` | 否 | 空字符串 | 静态项目通常为空 |
| `CF_DESTINATION_DIR` | 否 | `src` | Pages 输出目录；当前静态项目用 `src` |
| `CF_ROOT_DIR` | 否 | 空字符串 | GitHub repo 内项目根目录 |
| `CF_CNAME_TARGET` | 否 | Pages API 返回的 `project.subdomain` | 只在特殊情况下覆盖 |
| `CF_DNS_PROXIED` | 否 | `false` | Pages CNAME 默认 DNS only |
| `CF_WAIT_ACTIVE` | 否 | `true` | 是否等待 custom domain active |
| `CF_WAIT_ATTEMPTS` | 否 | `24` | active 轮询次数 |
| `CF_WAIT_INTERVAL_MS` | 否 | `5000` | active 轮询间隔 |
| `CF_REQUEST_RETRIES` | 否 | `3` | Cloudflare API 瞬时错误重试次数 |
| `CF_REQUEST_RETRY_DELAY_MS` | 否 | `1000` | 重试间隔 |

### 推导顺序

GitHub owner/repo：

```text
优先使用 CF_GITHUB_OWNER + CF_GITHUB_REPO。
如果没传，从 git config --get remote.origin.url 解析。
支持 https://github.com/<owner>/<repo>.git
支持 git@github.com:<owner>/<repo>.git
```

Pages project：

```text
优先使用 CF_PAGES_PROJECT。
如果没传，使用 GitHub repo name。
```

Account：

```text
优先使用 CF_ACCOUNT_ID。
如果没传，调用 GET /client/v4/accounts。
如果只返回一个账号，自动使用该账号。
如果返回 0 个或多个账号，停止并要求传 CF_ACCOUNT_ID。
```

Zone：

```text
优先使用 CF_ZONE_ID。
如果没传，优先使用 CF_ZONE_NAME。
如果 CF_ZONE_NAME 也没传，从 CF_CUSTOM_DOMAIN 最后两段推导。
例如 tool.eforge.xyz -> eforge.xyz。
然后调用 GET /client/v4/zones?name=<zone_name>。
如果不是唯一结果，停止并要求传 CF_ZONE_ID。
```

CNAME target：

```text
优先使用 CF_CNAME_TARGET。
如果没传，调用 Pages project API，读取 result.subdomain。
```

绝对不要这样做：

```text
CF_CNAME_TARGET=<CF_PAGES_PROJECT>.pages.dev
```

因为 `xtools` 的真实值是：

```text
xtools-7nq.pages.dev
```

不是：

```text
xtools.pages.dev
```

### 执行步骤

脚本按这个顺序执行：

```text
1. 解析 GitHub remote 和配置。
2. 解析 Cloudflare account。
3. 查询或创建 Pages project。
4. 从 Pages project 读取真实 subdomain。
5. 查询或创建 Pages custom domain。
6. 解析 Cloudflare zone。
7. 查询 DNS record。
8. 如果没有 DNS CNAME，则创建。
9. 如果 CNAME 指向错误，则更新到 project.subdomain。
10. 如果存在非 CNAME 记录，则停止，不覆盖。
11. 轮询 Pages custom domain，直到 status/verification/validation 都 active。
```

### 幂等边界

会创建或更新：

```text
Pages project
Pages custom domain
DNS CNAME
```

不会删除：

```text
Pages project
Pages custom domain
DNS record
GitHub repo
```

### 成功判定

脚本成功输出不代表最终业务完全可用，必须继续验证：

```bash
rtk curl -sS -I https://<project-subdomain>
rtk curl -sS -I https://<custom-domain>
rtk curl -sS https://<custom-domain> | rtk rg "<页面关键标识>"
```

Pages custom domain 成功状态必须是：

```text
status=active
verification=active
validation=active
```

### 常见失败解释

`CNAME record not set`：

```text
DNS CNAME 缺失或指向错误。
优先检查 CNAME 是否指向 project.subdomain。
```

`socket hang up`：

```text
通常是 Cloudflare API 瞬时连接中断。
脚本已经内置重试。
如果 Pages project、custom domain、DNS 已正确，不要误判为配置错误。
```

`Conflicting DNS record exists`：

```text
同名域名已有非 CNAME 记录。
脚本不会覆盖，必须人工确认该记录是否可删除或迁移。
```

## Workers 域名脚本契约

脚本：

```text
scripts/cloudflare/workers_custom_domain_bind.mjs
```

适用项目：

```text
Cloudflare Workers
Workers Static Assets
Worker API
需要 Workers Custom Domains 的项目
```

不适用：

```text
Cloudflare Pages 项目
普通 DNS CNAME 项目
VPS A 记录项目
```

### 最小变量

新增域名并保留旧域名：

```bash
CF_AUTH_EMAIL="<cloudflare-email>" \
CF_GLOBAL_API_KEY="<global-api-key>" \
CF_SOURCE_CUSTOM_DOMAIN="ai.eforge.xyz" \
CF_CUSTOM_DOMAIN="auth.eforge.xyz" \
node scripts/cloudflare/workers_custom_domain_bind.mjs
```

### 核心变量表

| 变量 | 必填 | 默认/推导 | 说明 |
| --- | --- | --- | --- |
| `CF_CUSTOM_DOMAIN` | 是 | 无 | 要绑定的目标域名，例如 `auth.eforge.xyz` |
| `CF_API_TOKEN` | 鉴权二选一 | 无 | Bearer Token |
| `CF_AUTH_EMAIL` | 鉴权二选一 | 无 | Global API Key 模式账号邮箱 |
| `CF_GLOBAL_API_KEY` | 鉴权二选一 | 无 | Global API Key |
| `CF_SOURCE_CUSTOM_DOMAIN` | 条件必填 | 无 | 如果不传 `CF_WORKER_SERVICE`，用它从已有绑定推导 Worker |
| `CF_WORKER_SERVICE` | 条件必填 | 从 `CF_SOURCE_CUSTOM_DOMAIN` 推导 | Worker script/service 名称 |
| `CF_WORKER_ENVIRONMENT` | 否 | `production`，或从源域名推导 | Worker environment |
| `CF_ACCOUNT_ID` | 否 | 单账号自动推导 | 多账号必须传 |
| `CF_ZONE_ID` | 否 | 从目标域名 zone name 查询，或从源域名推导 | zone id |
| `CF_ZONE_NAME` | 否 | 从 `CF_CUSTOM_DOMAIN` 最后两段推导 | 例如 `auth.eforge.xyz` -> `eforge.xyz` |
| `CF_DELETE_SOURCE_CUSTOM_DOMAIN` | 否 | `false` | 是否删除源域名 |
| `CF_REPLACE_CONFIRM` | 删除时必填 | 无 | 必须等于 `<源域名>-><目标域名>` |

### 推导顺序

Account：

```text
优先使用 CF_ACCOUNT_ID。
否则 GET /client/v4/accounts。
只有一个账号时自动推导。
```

Worker service：

```text
优先使用 CF_WORKER_SERVICE。
否则必须传 CF_SOURCE_CUSTOM_DOMAIN。
脚本调用 GET /client/v4/accounts/<account_id>/workers/domains。
从 source hostname 找到 service、environment、zone_id、zone_name。
```

Zone：

```text
如果源域名绑定里有 zone_id，优先使用。
否则从 CF_CUSTOM_DOMAIN 或 CF_ZONE_NAME 查询 zones。
```

### 执行步骤

```text
1. 读取 Workers custom domains 列表。
2. 解析或推导 Worker service。
3. 解析 zone。
4. 如果目标域名已绑定到同一个 service/environment，则直接成功。
5. 如果目标域名不存在，则 PUT 绑定 Workers custom domain。
6. 默认不删除源域名。
7. 只有显式确认时才 DELETE 源域名 custom domain。
```

### 幂等边界

会创建或更新：

```text
Workers custom domain
```

默认不会删除：

```text
源 custom domain
DNS record
Worker script
```

显式开启时会删除：

```text
CF_DELETE_SOURCE_CUSTOM_DOMAIN=true
CF_REPLACE_CONFIRM="<源域名>-><目标域名>"
```

删除只删除 Workers custom domain，不删除 Worker script。

### 成功判定

新增或更换域名后必须验证：

```bash
rtk curl -sS -I https://<target-domain>/
rtk curl -sS https://<target-domain>/ | rtk rg "<页面关键标识>"
```

如果是替换域名，还要确认：

```text
旧域名没有 OAuth callback。
旧域名没有 webhook。
旧域名没有第三方平台配置。
旧域名没有公开文档或用户入口依赖。
```

## 权限探针脚本契约

脚本：

```text
scripts/cloudflare/capability_probe.mjs
```

用途：

```text
快速确认当前凭据是否能读 Pages、Workers custom domains、DNS records。
```

必填：

```text
CF_ACCOUNT_ID
CF_ZONE_ID
```

可选：

```text
CF_PAGES_PROJECT
```

鉴权：

```text
CF_API_TOKEN
或 CF_AUTH_EMAIL + CF_GLOBAL_API_KEY
```

输出含义：

```text
OK Pages projects list
OK Pages deployments list
OK Workers custom domains list
OK Zone DNS records list
```

全部 OK 才能说明当前凭据覆盖 Pages、Workers 和 DNS 的基础读取能力。

## 固定事实记录

截至 2026-05-24，已验证事实：

```text
Cloudflare account id: f4c2f5b7c4134455ba93f1ebc0233664
Zone: eforge.xyz
Zone id: b1df754ff171d8b748d831b04a69aac2

Worker:
gptsession2cpaandsub2api
ai.eforge.xyz -> gptsession2cpaandsub2api
ai.eforge.xyz DNS -> AAAA 100:: read_only=true

Pages:
vibox-shop -> vibox-shop.pages.dev
shop.eforge.xyz -> vibox-shop.pages.dev

xtools -> xtools-7nq.pages.dev
tool.eforge.xyz -> xtools-7nq.pages.dev
```

这些事实可以作为排障起点，但脚本仍应从 API 读取当前状态，不应把这些值硬编码到新项目流程里。

## 下次执行前检查清单

Pages 项目：

```text
1. 当前目录是否是独立项目 Git repo。
2. git remote.origin.url 是否指向正确 GitHub repo。
3. CF_CUSTOM_DOMAIN 是否是目标正式域名。
4. 是否确认为 Pages 项目，而不是 Worker 项目。
5. 脚本输出的 CNAME target 是否来自 project.subdomain。
6. curl 是否验证 pages.dev 和正式域名都 200。
```

Workers 项目：

```text
1. 是否确认为 Worker 项目，而不是 Pages 项目。
2. CF_SOURCE_CUSTOM_DOMAIN 是否真实存在。
3. 推导出的 Worker service 是否符合预期。
4. 是否只是新增域名，还是要删除旧域名。
5. 删除旧域名前是否完成外部依赖排查。
6. curl 是否验证目标正式域名 200。
```

如果任何一项不确定，先查询 Cloudflare API，不要凭截图或记忆判断。
