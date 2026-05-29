# 免费平台组合选型与 new-api 部署分析

日期：2026-05-24

## 结论

对个人开发者、低负载、低流量、尽量免费这一类场景，最佳策略不是“把所有东西塞进一个平台”，而是按职责组合：

```text
静态前端 / 文档 / 小工具
-> Cloudflare Pages 或 Workers Static Assets

Next.js / React 全栈前端体验
-> Vercel Hobby，或 Cloudflare Workers + OpenNext 生态

轻量边缘 API / webhook / BFF
-> Cloudflare Workers

Postgres / Auth / Storage / Realtime
-> Supabase Free

SQLite 风格业务库 / 低成本 SQL / 多小项目数据库
-> Turso / libSQL

对象存储 / 文件 / 备份
-> Cloudflare R2

Docker 长驻服务，例如 new-api
-> 必须使用能跑 Docker 的 VPS / 容器平台；Cloudflare、Vercel、Supabase、Turso 只能作为配套组件
```

`new-api` 这种项目的最小可落地方案：

```text
Cloudflare DNS + HTTPS + WAF
-> 一台能跑 Docker 的机器运行 new-api
-> SQLite 挂载数据卷，或 Supabase Postgres
-> Redis 可选
-> R2 做备份
-> GitHub 保存部署配置
```

如果目标是尽可能零成本，优先顺序是：

1. 能接受自己运维：免费/低价 VPS + Docker Compose + SQLite。
2. 想减少数据库运维：Docker 主机 + Supabase Postgres Free。
3. 想完全无服务器：不适合部署 new-api，除非重写为 serverless/edge 架构。

## 平台定位

| 平台 | 最适合 | 不适合 | 个人开发者建议 |
| --- | --- | --- | --- |
| Cloudflare Workers | 边缘 API、webhook、代理、轻量 BFF、静态资源配 Worker | Docker、长驻后端、大内存任务、本地文件写入 | 免费额度强，优先作为边缘层和正式域名入口 |
| Cloudflare Pages | 纯静态站点、文档站、前端预览 | 需要传统后端进程的项目 | 纯静态优先 Pages；本项目已是 Workers 则不要再迁 |
| Cloudflare R2 | 文件、图片、导出包、备份、日志归档 | 高频小对象读写且没有缓存设计 | 个人项目非常适合做低成本对象存储和备份 |
| Cloudflare D1 | 小型 SQLite 风格 serverless 数据库 | 复杂事务、大连接数、传统长连接应用 | 适合 Workers 原生应用，不适合直接接 new-api |
| Vercel | Next.js、前端全栈、预览部署、产品 Demo | Docker 镜像、长驻进程、传统服务端应用 | 做 Next.js 体验很好；不要用来跑 new-api |
| Supabase | Postgres、Auth、Storage、Realtime、后台管理 | 需要运行应用进程 | 可作为数据库/Auth 后端，不负责跑应用服务 |
| Turso / libSQL | SQLite 兼容、低成本 SQL、多小项目、多租户小库 | 需要原生 Postgres/MySQL 特性的项目 | 适合新写小工具；new-api 不应默认接 Turso |

## 官方限制核查

### Cloudflare Workers

官方 Free 限制包括：

- Workers Free 每天 100,000 请求。
- CPU time 10ms。
- 内存 128MB。
- 单 Worker 静态资源文件数和大小有限制。

这说明 Workers 适合短生命周期、轻量、无状态或绑定 Cloudflare 存储的边缘逻辑。

不适合：

- Docker。
- 常驻 Go/Node 服务。
- 需要本地 SQLite 文件持久写入的传统后端。
- 长时间 CPU 任务。

### Cloudflare R2

官方 Free Tier 包括：

- 10GB-month 标准存储。
- 每月 100 万 Class A 操作。
- 每月 1000 万 Class B 操作。
- 出站流量免费。

适合：

- 用户上传文件。
- 图片、导出包、模型配置备份。
- SQLite 备份归档。
- 应用日志冷存储。

注意：

- R2 是对象存储，不是数据库。
- 不要用 R2 当在线 SQLite 文件系统。

### Cloudflare D1

D1 是 Cloudflare serverless SQL 数据库，适合 Workers 原生应用。

适合：

- Workers 小工具。
- 轻量业务表。
- 读多写少配置表。

不适合：

- 传统 Docker 应用直接连接。
- new-api 这类已经声明 SQLite/MySQL/PostgreSQL 的服务，除非改造数据访问层。

### Vercel

Vercel 官方说明：不支持直接部署 Docker 镜像。Vercel Functions 是 serverless 运行模型，有执行时长、bundle、内存等限制。

适合：

- Next.js。
- 静态站点。
- 前端产品 Demo。
- 少量 API routes。

不适合：

- `docker run calciumion/new-api:latest`。
- 长驻服务。
- 需要本地数据卷的 SQLite。
- 需要 Redis/MySQL 同机编排的 Docker Compose。

### Supabase

Supabase Free 官方定位是 passion projects / simple websites，包含：

- 500MB database size。
- 50,000 monthly active users。
- 5GB egress。
- 1GB file storage。
- 2 个 active projects。
- Free project 会在 1 周不活跃后暂停。

适合：

- Postgres 数据库。
- 用户登录。
- 后台 API。
- 小型 SaaS 原型。

注意：

- Supabase 不负责运行你的 Go/Docker 应用。
- Free 适合低负载，但不能当高可用生产数据库。
- `new-api` 可以考虑接 Supabase Postgres，但要控制连接数、日志体积和数据库大小。

### Turso / libSQL

Turso Free 官方额度非常适合个人小项目：

- 100 databases。
- 5GB total storage。
- 每月 500M rows read。
- 每月 10M rows written。

适合：

- SQLite 风格业务数据。
- 多个小工具共用低成本数据库。
- 边缘读多写少应用。
- Drizzle / SQL-first 的新项目。

注意：

- Turso/libSQL 不是 PostgreSQL。
- `new-api` 官方要求 SQLite 本地文件、MySQL >= 5.7.8 或 PostgreSQL >= 9.6。
- 除非 new-api 明确支持 libSQL/Turso driver，否则不要把 Turso 当作它的远程数据库。

## new-api 项目要求

根据 `QuantumNous/new-api` 官方 README，部署要求是：

```text
本地数据库：SQLite，并且 Docker 需要挂载 /data
远程数据库：MySQL >= 5.7.8 或 PostgreSQL >= 9.6
容器引擎：Docker / Docker Compose
```

常见环境变量：

```text
SQL_DSN
REDIS_CONN_STRING
SESSION_SECRET
CRYPTO_SECRET
STREAMING_TIMEOUT
STREAM_SCANNER_MAX_BUFFER_MB
```

官方推荐 Docker Compose。单机 SQLite 示例需要：

```bash
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  calciumion/new-api:latest
```

这意味着 new-api 不是静态站，也不是纯 serverless function。

它需要：

- 一个长驻 HTTP 服务。
- Docker 或 Docker Compose。
- 持久化数据目录 `/data`，或远程 MySQL/PostgreSQL。
- 可选 Redis。
- 域名反代和 HTTPS。
- 备份策略。
- 日志和健康检查。

## new-api 不能直接部署在哪里

### 不能直接部署到 Cloudflare Workers

原因：

- Workers 不是 Docker 运行时。
- Workers 没有传统本地文件系统给 SQLite 持久写 `/data`。
- Workers 更适合短生命周期边缘代码。

Cloudflare 可以做：

- DNS。
- HTTPS。
- WAF。
- 反代。
- Zero Trust/Tunnel。
- R2 备份。

但不负责直接运行 new-api Docker 容器。

### 不能直接部署到 Vercel

原因：

- Vercel 官方不支持直接运行 Docker 实例。
- Vercel Functions 是 serverless，不是长驻容器服务。
- new-api 需要端口服务、持久化数据卷、可选 Redis。

Vercel 可以做：

- 前端管理站。
- 文档站。
- Demo 页面。

但不适合跑 new-api 后端本体。

### 不能直接部署到 Supabase

原因：

- Supabase 是数据库/Auth/Storage 平台，不是应用容器平台。

Supabase 可以做：

- new-api 的 PostgreSQL 数据库。
- 低负载个人项目的数据层。

但不运行 new-api 服务。

### 不建议直接用 Turso 接 new-api

原因：

- new-api 官方远程数据库是 MySQL/PostgreSQL。
- Turso/libSQL 是 SQLite 兼容方向，不等于 MySQL/PostgreSQL。
- 除非项目代码明确支持 libSQL driver，否则不要硬接。

## new-api 的推荐部署架构

### 方案 A：最低成本单机方案

适合：

- 个人使用。
- 低并发。
- 不公开大规模服务。
- 能接受自己维护机器。

架构：

```text
Cloudflare DNS / HTTPS / WAF
-> VPS / 免费云主机
-> Docker Compose
-> new-api
-> SQLite volume: /data
-> 定时备份到 Cloudflare R2
```

优点：

- 成本最低。
- 架构最简单。
- new-api 官方 Docker 路径完全匹配。

缺点：

- VPS 需要自己维护。
- SQLite 文件必须备份。
- 单机故障会中断服务。

建议：

- 只开放 HTTPS。
- 后台管理入口不要公开给所有人。
- 设置强密码和 `SESSION_SECRET`。
- 每天备份 `/data` 到 R2。
- 不要一开始上 MySQL/Redis，除非确实需要。

### 方案 B：单机服务 + Supabase Postgres

适合：

- 不想把数据库只放在 VPS 本地。
- 数据比服务更重要。
- 低负载但希望数据库有托管能力。

架构：

```text
Cloudflare DNS / HTTPS / WAF
-> VPS / 容器平台
-> Docker new-api
-> Supabase Postgres Free
-> R2 备份导出
```

优点：

- 应用和数据库分离。
- 数据库有 Supabase 管理界面。
- 迁移服务机器更容易。

缺点：

- Supabase Free 500MB 数据库限制。
- Free project 可能因不活跃暂停。
- 网络延迟比本地 SQLite 高。
- 连接数和连接池需要控制。

建议：

- 日志、请求记录、用量统计要定期清理。
- 使用连接池地址而不是大量直连。
- 低负载可以用；公开服务或商业服务建议升级或自管 Postgres。

### 方案 C：单机服务 + MySQL/PostgreSQL 容器

适合：

- 需要数据库能力强于 SQLite。
- 想保持所有东西在一台机器上。
- 愿意维护数据库备份。

架构：

```text
Cloudflare
-> VPS
-> Docker Compose
   -> new-api
   -> PostgreSQL/MySQL
   -> Redis 可选
-> R2 备份
```

优点：

- 完全符合官方 Docker Compose 思路。
- 延迟低。
- 可控。

缺点：

- 运维责任最大。
- 备份必须认真做。
- 机器资源太小时数据库和应用会互相抢资源。

建议：

- 个人低负载优先 SQLite。
- 确认 SQLite 不够再升级到 Postgres/MySQL。

### 方案 D：容器 PaaS

适合：

- 不想维护 VPS。
- 愿意接受免费额度不稳定或休眠。
- 能接受后续每月小额费用。

可考虑的方向：

- Render / Fly.io / Railway / Northflank / Koyeb 等能跑 Docker 的平台。

注意：

- 免费额度政策变化频繁。
- 很多平台免费服务会休眠。
- 数据卷、出站、日志、构建分钟可能收费。
- 不要把数据库也放在无保障的临时磁盘里。

结论：

```text
new-api 的关键是 Docker 长驻服务；只要平台不能稳定跑容器和持久卷，就不是合适主机。
```

## 免费额度最大化组合

### 纯静态或前端工具

```text
Cloudflare Pages / Workers Static Assets
-> Cloudflare Custom Domain
-> R2 可选
```

适合：

- 文档站。
- 单页工具。
- 营销页。
- 无服务端状态的小应用。

### 有少量动态逻辑的小工具

```text
Cloudflare Workers
-> D1 / KV / R2
-> Custom Domain
```

适合：

- webhook。
- 表单收集。
- 小型 API。
- URL 短链。
- 轻量代理。

不适合：

- 长驻 Docker 服务。
- 重 CPU。
- 大型 ORM 后端。

### Next.js 产品原型

```text
Vercel Hobby
-> Supabase Free
-> Cloudflare DNS
```

适合：

- 快速做产品原型。
- 需要预览部署。
- 主要是前端和少量 API。

注意：

- 不要在 Vercel 上跑长任务。
- 不要用 serverless function 做大批量后台消费。
- 超出 Hobby 限制时要及时迁移或升级。

### SQL-first 小应用

```text
Cloudflare Workers / Vercel
-> Turso
```

适合：

- 低成本 CRUD。
- 多个小库。
- SQLite 友好的数据模型。

注意：

- 不要把 Turso 当 MySQL/PostgreSQL。
- 先确认框架和 ORM 支持 libSQL/Turso。

### AI 网关类应用

```text
Cloudflare DNS/WAF
-> Docker 主机跑网关
-> SQLite / PostgreSQL
-> R2 备份
```

适合：

- new-api。
- one-api 类项目。
- 需要长驻服务和管理后台的代理网关。

## 个人低负载推荐决策

### 如果只是自己用 new-api

推荐：

```text
低价/免费 VPS + Docker + SQLite + Cloudflare 域名 + R2 备份
```

理由：

- 最贴合官方部署方式。
- 成本最低。
- 低负载下 SQLite 足够。
- 运维复杂度最低。

### 如果有少量朋友或内部团队使用

推荐：

```text
VPS + Docker new-api + Supabase Postgres Free/Pro + Redis 可选
```

理由：

- 数据库更容易迁移和观察。
- 后续升级路径清晰。
- Redis 可提升缓存和多实例稳定性。

### 如果要公开对外提供服务

不建议只依赖免费额度。

至少需要：

- 付费 VPS 或容器平台。
- 托管 Postgres 或可靠备份。
- Cloudflare WAF / Rate Limit / Turnstile。
- 日志和告警。
- token 成本、滥用成本、法律合规策略。

## 成本控制建议

1. 默认关闭公开注册。
2. 管理后台强密码。
3. 不公开暴露上游 API key。
4. Cloudflare 开 WAF 基础规则。
5. 只开放必要路径。
6. 配置用量限制和模型白名单。
7. 清理请求日志、用量明细、错误记录。
8. SQLite 每天备份到 R2。
9. Supabase Free 注意 500MB 数据库上限和暂停规则。
10. Vercel 只跑前端，不跑 Docker 网关。
11. Turso 只用于明确支持 libSQL 的新项目。
12. 所有 token 放平台 secret，不进 Git。

## 不推荐的做法

- 把 new-api 硬改成 Cloudflare Workers 项目。
- 把 new-api 部署到 Vercel Functions。
- 以为 Supabase 能托管 Docker 应用。
- 以为 Turso 可以无缝替代 MySQL/PostgreSQL。
- 在没有备份的情况下用 SQLite 长期保存关键业务数据。
- 为了免费额度把系统拆成很多不稳定组件，最后运维成本超过服务器成本。
- 公开 AI 网关但不做限流、认证、审计。

## 最终建议

针对个人开发者低负载场景，最稳的路线是：

```text
前端和文档：Cloudflare Workers Static Assets / Pages
域名和 HTTPS：Cloudflare
小型边缘 API：Cloudflare Workers
Postgres/Auth：Supabase Free
SQLite 风格小库：Turso Free
文件和备份：Cloudflare R2
Docker 长驻服务：VPS / 容器主机
```

针对 `new-api`：

```text
不要优先考虑 Vercel、Cloudflare Workers、Supabase、Turso 直接部署。
优先找能跑 Docker 的主机。
Cloudflare 负责入口和防护。
SQLite 或 Supabase Postgres 负责数据。
R2 负责备份。
```

这是成本、稳定性、迁移能力和执行复杂度之间最均衡的方案。

## 官方参考

- Cloudflare Workers Pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Pages Limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare D1 Pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Vercel Pricing: https://vercel.com/pricing
- Vercel Docker support: https://vercel.com/kb/guide/does-vercel-support-docker-deployments
- Vercel Functions Limits: https://vercel.com/docs/functions/limitations
- Supabase Pricing: https://supabase.com/pricing
- Turso Pricing: https://turso.tech/pricing
- Turso libSQL: https://docs.turso.tech/libsql
- new-api README: https://github.com/QuantumNous/new-api/blob/main/README.md
