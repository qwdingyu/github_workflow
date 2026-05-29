# Cloudflare 免费额度与产品组合最佳实践

## 背景

目标是明确 Cloudflare 免费版到底能承载多少项目、多少子域名、多少静态站、多少轻量数据存储，以及如何和 Supabase、Turso / libSQL 等线上数据库组合，形成适合个人开发者的低成本上线体系。

本文基于 2026-05-24 可查到的官方文档和当前实测流程整理。Cloudflare、Supabase、Turso 的免费额度会变化，真正执行前必须再查一次官方 pricing / limits 页面。

## 先给结论

Cloudflare 免费版不是无限资源池。

但对个人创业者、小工具、表单收集、落地页、邀请页、分享页、资料页、轻量 API 来说，免费额度非常够用。真正要避免的是：

```text
1. 把所有应用都塞进一个项目。
2. 把 Pages 和 Workers 域名流程混用。
3. 把 D1、KV、R2、Supabase、Turso 都当成同一种数据库。
4. 不记录项目、域名、存储、数据库之间的映射关系。
5. 不做预算边界和降级策略。
```

推荐主路径：

```text
静态站 / 落地页：
Cloudflare Pages

静态站 + 少量 API / 表单：
Cloudflare Workers + D1 / KV

文件、图片、资料下载：
Cloudflare R2 + Worker 鉴权 / 签名下载

需要后台管理、关系型查询、登录权限：
Supabase

全球边缘读写、SQLite/libSQL、轻量多租户：
Turso / libSQL

重型服务、长连接、复杂容器：
VPS / PaaS，不要强行塞进 Cloudflare 免费版
```

## 免费额度速查表

以下数字是 2026-05-24 按官方文档核对的结果。它们不是永久承诺，执行前要重新查官方 limits / pricing 页面。

| 产品 | 免费额度 / 限制 | 关键判断 |
| --- | --- | --- |
| DNS records | 新 Free zone 通常 200 条 / zone；2024-09-01 前创建的 Free zone 通常 1,000 条 / zone | 子域名不是无限，普通子域名会消耗 DNS record |
| Cloudflare Pages projects | 100 个 / account，soft limit | 不是无限项目；大量项目短时间创建可能触发风控 |
| Pages builds | 500 次 / 月；Free 同时 1 个 build；build timeout 20 分钟 | 小项目足够，大量 CI 推送要控制频率 |
| Pages custom domains | 100 个 / project | 单项目可挂很多域名，但不建议混乱复用 |
| Pages files | Free 每站 20,000 个文件；单文件 25 MiB | 大文件放 R2，不要塞 Pages |
| Pages preview deployments | 官方写明单项目可有 unlimited active preview deployments | 这不是正式项目数量无限 |
| Workers scripts | 100 个 / account | 不是无限 Worker；小项目多时要规划 |
| Workers requests | Free 100,000 requests / day | 表单、轻 API 足够；公共 API 要监控 |
| Workers CPU | Free 每 HTTP 请求 10 ms CPU；内存 128 MB | 不适合重计算、SSR 重负载、复杂解析 |
| Workers subrequests | Free 50 / request | 调外部 API、D1、KV、R2 都要计入设计 |
| Workers cron | Free 5 个 cron triggers / account | 定时任务要集中规划 |
| Workers custom domains | 100 个 / zone | Worker 子域名也不是无限 |
| Workers routes | 1,000 条 / zone | 路由很多时用 wildcard route 或重新架构 |
| Workers Static Assets | Free 每 Worker version 20,000 文件；单文件 25 MiB | 和 Pages 类似，资料文件放 R2 |
| D1 databases | Free 10 个 / account | 小应用可共库分表；不要每个页面都建库 |
| D1 storage | Free 单库 500 MB；账号总计 5 GB | 表单/邀请/短链足够，重业务不够 |
| D1 reads/writes | 5M rows read / day；100k rows written / day | 必须建索引，避免全表扫描 |
| KV | 100k reads/day；1k writes/day；1 GB 存储 | 读多写少，配置/缓存/短链适合 |
| R2 | 10 GB-month/月；1M Class A/月；10M Class B/月；标准存储出站免费 | 文件资料首选，但大量下载读请求会超 |
| Queues | Free 10,000 operations/day；消息保留 24 小时 | 适合低频异步，不适合大规模任务队列 |
| Supabase Free | 2 active projects；500 MB database/project；50k MAU；5 GB egress；1 GB file storage；闲置项目会暂停 | 适合带 Auth/后台的小项目，不适合大量项目无限开 |
| Turso Free | 100 databases；5 GB total storage；500M monthly rows read；10M monthly rows written；3 GB monthly syncs | 轻量 SQL 额度很强，适合多小项目 |

### 直接回答“是不是无限”

```text
子域名：不是无限，受 DNS record、Pages custom domain、Workers custom domain 等限制影响。
Pages 项目：不是无限，Free 账号软限制 100 个项目。
Workers 项目：不是无限，Free 账号 100 个 Worker。
Pages 自定义域名：不是无限，每项目 100 个。
Workers 自定义域名：不是无限，每 zone 100 个。
D1：不是无限，Free 10 个数据库，总 5 GB。
KV：不是无限，读写和存储都有每日/总量限制。
R2：不是无限，免费 10 GB-month 和操作次数额度。
```

现实判断：

```text
对个人开发者来说，这些额度足以支撑大量低流量小项目。
但如果目标是“无限创建项目、无限子域名、无限存储”，Cloudflare Free 不是这个模型。
```

## Cloudflare 免费版关键限制

### 1. DNS 和子域名

Cloudflare 可以托管 DNS zone。子域名本质上对应 DNS records 或平台自动生成的托管记录。

关键点：

```text
子域名不是“无限无成本”的抽象能力。
普通子域名通常消耗 DNS record 数量。
Workers Custom Domain 会生成 Cloudflare 托管 DNS 记录。
Pages Custom Domain 通常需要一个 CNAME DNS record。
```

实践结论：

```text
低成本项目可以大量使用子域名，但要记录清楚：
子域名 -> Cloudflare 产品 -> 项目名 -> GitHub repo -> 存储/数据库
```

不要把子域名数量理解为无限。实际限制会受 DNS records、custom domain 限制、账号安全策略和产品限制影响。当前官方 DNS 文档显示，新 Free zone 通常是 200 条 DNS record，2024-09-01 前创建的 Free zone 通常是 1,000 条。

### 2. Cloudflare Pages

适合：

```text
静态站
落地页
资料展示页
下载说明页
营销页
前端 SPA
少量 Pages Functions
```

常见免费限制维度：

```text
项目数量：100 个 / account，soft limit。
custom domains：100 个 / project。
构建次数：500 次 / 月。
并发构建：Free 同时 1 个。
构建超时：20 分钟。
文件数量：20,000 files / site。
单文件大小：25 MiB。
```

最佳实践：

```text
一个独立应用 = 一个 GitHub repo = 一个 Pages project = 一个正式子域名
```

Pages 域名规则：

```text
正式域名 CNAME 必须指向 Cloudflare Pages API 返回的真实 project.subdomain。
不要拼 <project>.pages.dev。
```

当前已验证：

```text
vibox-shop -> vibox-shop.pages.dev
shop.eforge.xyz -> vibox-shop.pages.dev

xtools -> xtools-7nq.pages.dev
tool.eforge.xyz -> xtools-7nq.pages.dev
```

结论：

```text
Pages 项目适合大规模复制小而美的静态项目。
但不能把 Pages 理解为无限项目平台。
```

### 3. Cloudflare Workers

适合：

```text
轻量 API
表单提交
Webhook 接收
短链接
邀请系统
鉴权代理
R2 文件签名下载
D1/KV/R2 的业务入口
简单定时任务
```

常见免费限制维度：

```text
Worker scripts：100 个 / account。
请求：100,000 requests / day。
CPU：10 ms / HTTP request。
内存：128 MB。
subrequests：50 / request。
环境变量：64 / Worker。
Worker size：3 MB。
Cron Triggers：5 / account。
Custom Domains：100 / zone。
Routes：1,000 / zone。
```

Workers 域名规则：

```text
Workers Custom Domain 不是 Pages CNAME。
绑定后 Cloudflare 会自动生成 Worker 托管 DNS 记录和证书。
看到 AAAA 100:: read_only=true 是正常现象。
```

当前已验证：

```text
gptsession2cpaandsub2api
ai.eforge.xyz -> gptsession2cpaandsub2api
DNS: ai.eforge.xyz AAAA 100:: proxied=true read_only=true
```

结论：

```text
Workers 是轻量后端和边缘编排核心。
不要把重型 Node/Python/Go 常驻服务强行迁到 Workers。
```

### 4. D1

D1 是 Cloudflare 的 serverless SQL 数据库，SQLite 兼容思路，适合 Workers 原生项目。

适合：

```text
表单数据
邀请记录
短链接映射
订单/购买意向
轻量用户表
活动报名
小型后台数据
```

不适合：

```text
复杂 OLTP 高并发系统
重型统计分析
强事务业务
复杂权限后台
需要完整 PostgreSQL 生态的项目
```

免费版常见限制维度：

```text
数据库数量：10 个 / account。
单库大小：500 MB。
账号总存储：5 GB。
rows read：5 million / day。
rows written：100,000 / day。
每个 Worker invocation 查询 D1：Free 50 次，受 subrequest 限制。
```

实践建议：

```text
Cloudflare Workers + D1 是个人开发者最优先的小型表单/邀请/分享数据方案。
需要 PostgreSQL、Auth、管理后台时，再接 Supabase。
```

### 5. Workers KV

KV 是全球分布式 key-value 存储。

适合：

```text
配置项
开关
短链接跳转目标
低频更新的公开数据
缓存结果
简单 token / nonce
```

不适合：

```text
强一致计数
高频写入
复杂查询
关系型数据
订单状态
库存扣减
```

实践建议：

```text
读多写少用 KV。
需要查询、筛选、唯一约束，用 D1。
需要文件，用 R2。
```

免费版关键额度：

```text
reads：100,000 / day。
writes：1,000 / day。
deletes：1,000 / day。
list requests：1,000 / day。
stored data：1 GB。
```

### 6. R2

R2 是对象存储，适合资料、图片、附件、导出文件。

适合：

```text
虚拟资料文件
图片素材
用户上传文件
CSV/JSON 导出
下载包
静态大文件
```

不适合：

```text
数据库
频繁小对象强一致更新
需要复杂查询的结构化数据
```

实践建议：

```text
R2 存文件。
D1 存文件元数据。
Worker 做鉴权、签名、下载统计。
Pages 做展示页。
```

免费版关键额度：

```text
Standard storage：10 GB-month / month。
Class A operations：1 million / month。
Class B operations：10 million / month。
Internet egress：free。
```

注意：免费额度只适用于 Standard storage，不适用于 Infrequent Access storage。

典型结构：

```text
Pages 落地页
-> Worker API
-> D1 查询资料信息
-> R2 返回文件或签名下载链接
```

### 7. Queues / Cron / Workflows

适合：

```text
异步处理表单
发送通知
同步外部数据库
轻量任务队列
定时清理
定时汇总
低频数据同步
```

实践建议：

```text
表单提交不要在请求里做所有事。
Worker 收请求后写 D1，再把耗时动作丢到 Queue。
Cron 用于每天同步、清理、统计。
```

免费额度也有上限，不适合重型任务调度系统。

Queues 免费版关键额度：

```text
10,000 operations / day。
message retention：24 hours。
```

## Cloudflare 产品组合建议

### 方案 A：纯静态落地页

```text
Cloudflare Pages
GitHub 自动部署
Custom Domain
```

适合：

```text
宣传页
资料页
工具导航
会员购买跳转页
Telegram 群引流页
```

优点：

```text
最简单
最稳定
几乎不需要后端
适合批量复制
```

### 方案 B：表单收集小应用

```text
Pages 前端
Worker API
D1 数据库
可选 Queue 异步通知
```

适合：

```text
报名表
咨询收集
邀请码申请
购买意向
问卷
```

推荐数据表：

```text
submissions
contacts
campaigns
events
audit_logs
```

### 方案 C：虚拟资料下载/售卖

```text
Pages 展示
Worker 鉴权
D1 存订单/资料元数据
R2 存文件
KV 存配置和活动开关
```

适合：

```text
视频会员资料
电子资料包
模板文件
课程资料
私域引流资料
```

注意：

```text
支付不要自己造轮子。
低成本早期可以先跳转第三方购买链接。
后续再接 Stripe / Lemon Squeezy / Paddle / 国内支付服务。
```

### 方案 D：轻量 API + 外部数据库

```text
Worker API
Supabase / Turso
Pages 前端
```

适合：

```text
需要 PostgreSQL 的后台
需要登录权限
需要 Supabase Auth
需要更复杂 SQL
需要跨平台访问数据库
```

Worker 调用外部数据库时，优先使用 HTTPS API / 官方 serverless SDK，不要依赖传统长连接数据库驱动。

## 和 Supabase 的组合

Supabase 适合：

```text
PostgreSQL
Auth
Storage
Realtime
管理后台
SQL 查询和权限策略
```

Cloudflare + Supabase 推荐方式：

```text
Pages 承载前端
Worker 作为后端 API / BFF
Worker 调 Supabase REST / RPC / JS SDK
Supabase 存核心业务数据和用户体系
```

适合项目：

```text
有登录的 SaaS 小工具
需要后台管理的数据收集系统
需要复杂查询的邀请/分销/订单系统
需要权限隔离的数据应用
```

不建议：

```text
所有小表单都上 Supabase。
简单提交记录优先 D1，更轻更省心。
```

同步策略：

```text
D1 存边缘热数据。
Supabase 存主数据和后台管理。
Cron / Queue 定时把 D1 数据同步到 Supabase。
或者 Worker 写入时同时写 Supabase，但要有失败重试。
```

推荐：

```text
低价值表单：只用 D1。
需要后台和账号体系：Supabase 做主库。
边缘高频读：D1/KV 做缓存。
```

## 和 Turso / libSQL 的组合

Turso / libSQL 适合：

```text
轻量 SQL
SQLite/libSQL 生态
边缘读取
多区域低延迟
小应用多租户
```

Cloudflare + Turso 推荐方式：

```text
Pages 前端
Worker API
Turso HTTP/libSQL client
```

适合项目：

```text
轻量工具后台
多小项目共享一套数据库服务
全球访问但负载不高
不想管理 PostgreSQL 的项目
```

不建议：

```text
需要 PostgreSQL 扩展生态。
需要复杂权限策略。
需要 Supabase Auth / Storage / Realtime 一体化能力。
```

同步策略：

```text
Turso 做主库，Cloudflare KV 做配置缓存。
D1 做本地边缘缓存时，要明确主从关系。
不要让 D1 和 Turso 双主写入。
```

## 数据存储选择规则

### 一句话选择

```text
配置和缓存：KV
结构化轻数据：D1
文件：R2
登录和后台：Supabase
轻量全球 SQL：Turso
重型业务库：VPS / 托管 PostgreSQL / MySQL
```

### 决策表

| 场景 | 首选 | 备选 | 不建议 |
| --- | --- | --- | --- |
| 落地页 | Pages | Workers Static Assets | VPS |
| 表单收集 | Workers + D1 | Supabase | KV |
| 短链接 | Workers + KV | D1 | Supabase |
| 邀请码 | Workers + D1 | Turso | KV 单独承担 |
| 文件下载 | R2 + Worker | Supabase Storage | D1/KV 存文件 |
| 用户登录 | Supabase Auth | 自建 Auth | KV 手写登录 |
| 后台管理 | Supabase | 自建后台 | 纯 D1 无后台 |
| 全球轻 SQL | Turso | D1 | 传统单区 VPS |
| 重型服务 | VPS / PaaS | Docker 云主机 | Workers 免费版硬塞 |

## 大规模复制项目的标准映射表

后续每个项目必须维护一张映射表，建议放在项目自己的 `docs/`：

```text
项目名：
GitHub repo：
Cloudflare 产品：Pages / Workers
Cloudflare project/script：
默认域名：
正式域名：
DNS record：
数据库：
对象存储：
环境变量：
部署方式：
验证命令：
回滚方式：
```

示例：

```text
项目名：xtools
GitHub repo：qwdingyu/xtools
Cloudflare 产品：Pages
Cloudflare project：xtools
默认域名：xtools-7nq.pages.dev
正式域名：tool.eforge.xyz
DNS record：tool.eforge.xyz CNAME xtools-7nq.pages.dev
数据库：无
对象存储：无
部署方式：GitHub -> Cloudflare Pages
验证命令：rtk curl -sS -I https://tool.eforge.xyz
```

## 免费额度风险控制

### 必须做的事

```text
1. 每个项目都有独立 GitHub repo。
2. 每个项目记录 Cloudflare 产品类型。
3. 每个正式域名记录 DNS 指向。
4. 每个数据存储记录用途和额度风险。
5. 所有脚本默认幂等，删除操作必须显式确认。
6. 每次上线后 curl 验证。
7. 每次踩坑写 docs。
```

### 不要做的事

```text
1. 不要把所有小项目都放进一个 Pages project。
2. 不要把所有数据都放进一个 KV namespace。
3. 不要把文件塞进 D1。
4. 不要把订单状态只放 KV。
5. 不要把 Worker 当 VPS。
6. 不要在免费额度边界不清楚时承诺无限服务。
```

## 当前最优实践路径

### 第一阶段：纯展示和引流

```text
Cloudflare Pages
一个项目一个 repo
一个项目一个正式子域名
无数据库
```

适合快速上线大量落地页。

### 第二阶段：增加表单和轻数据

```text
Workers API
D1
KV
必要时 Queue
```

适合收集数据、做邀请、做轻量交互。

### 第三阶段：增加文件和资料

```text
R2
Worker 鉴权
D1 元数据
```

适合虚拟资料和下载型产品。

### 第四阶段：增加账号和后台

```text
Supabase
或 Turso / libSQL
Worker BFF
Pages 前端
```

适合需要长期运营和数据管理的产品。

### 第五阶段：重型服务

```text
VPS / Docker / PaaS
Cloudflare 只做 DNS、CDN、WAF、入口代理
```

适合 new-api 这类偏重项目。

## 官方资料入口

执行前优先查这些页面：

```text
Cloudflare Pages limits:
https://developers.cloudflare.com/pages/platform/limits/

Cloudflare Workers pricing / limits:
https://developers.cloudflare.com/workers/platform/pricing/

Cloudflare D1 pricing:
https://developers.cloudflare.com/d1/platform/pricing/

Cloudflare R2 pricing:
https://developers.cloudflare.com/r2/pricing/

Cloudflare Workers KV:
https://developers.cloudflare.com/kv/platform/pricing/

Cloudflare Queues pricing:
https://developers.cloudflare.com/queues/platform/pricing/

Cloudflare Pages custom domains:
https://developers.cloudflare.com/pages/configuration/custom-domains/

Cloudflare Workers custom domains:
https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

Supabase pricing:
https://supabase.com/pricing

Turso pricing:
https://turso.tech/pricing
```

## 最终判断

Cloudflare 免费版非常适合个人开发者做大量小工具、小页面、小 API、小数据应用，但不是无限资源。

最佳使用方式不是追求“一个平台解决所有问题”，而是：

```text
Pages 负责静态展示。
Workers 负责轻量逻辑。
D1 负责边缘结构化轻数据。
KV 负责配置和缓存。
R2 负责文件。
Supabase 负责账号、后台、PostgreSQL。
Turso 负责轻量全球 SQL。
VPS 负责重型服务。
```

这样才能最大化免费额度，同时保持工程上清晰、可复制、可运维。
