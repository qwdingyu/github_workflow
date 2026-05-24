# Cloudflare Dashboard 差异核查与最佳实践

## 背景

2026-05-24 在 Cloudflare Dashboard 的 `Workers 和 Pages` 页面中看到两个明显差异：

1. `gptsession2cpaandsub2api` 的域名显示方式和 `vibox-shop`、`xtools` 不同。
2. `vibox-shop` 看起来出现了两次。

这不是同一个问题。第一个是 Cloudflare Workers 和 Cloudflare Pages 的正常产品差异；第二个是同名 Worker script 与 Pages project 同时存在，属于部署路径混用造成的重复对象。

## 当前核查结论

### gptsession2cpaandsub2api

```text
类型：Cloudflare Worker
默认域名：gptsession2cpaandsub2api.mailforwdy.workers.dev
正式域名：ai.eforge.xyz
域名绑定：Workers Custom Domains
DNS 记录：Cloudflare 自动生成的只读 AAAA 100::
线上状态：https://ai.eforge.xyz -> HTTP/2 200
```

Cloudflare DNS 中看到 `ai.eforge.xyz` 是：

```text
Type: AAAA
Content: 100::
Proxy: true
Meta: read_only=true, origin_worker_id=<worker-domain-id>
```

这是 Workers Custom Domain 的正常形态，不应该手动改成 CNAME。

### vibox-shop

```text
正确生产入口：Cloudflare Pages project: vibox-shop
默认域名：vibox-shop.pages.dev
正式域名：shop.eforge.xyz
GitHub source：qwdingyu/vibox-shop
DNS 记录：shop.eforge.xyz CNAME vibox-shop.pages.dev, proxied=false
Pages custom domain：active
线上状态：https://shop.eforge.xyz -> HTTP/2 200
```

同时也存在：

```text
重复对象：Cloudflare Worker script: vibox-shop
```

该 Worker script 不是当前生产入口。它很可能来自此前误用 `wrangler deploy`，或者在 Pages 项目上执行了 Worker 部署流程。Cloudflare 当时也给过警告：

```text
It seems that you have run `wrangler deploy` on a Pages project,
`wrangler pages deploy` should be used instead.
```

这说明问题根因不是 Cloudflare 异常，而是部署命令和项目类型不匹配。

另外，如果 Dashboard 第二张图指的是 Pages 的部署记录而不是项目列表，`vibox-shop` 也确实能看到不止一条 deployment。Cloudflare Pages 会区分：

```text
production deployment：绑定 production branch，用于正式域名
preview deployment：预览部署，不等于正式入口
```

本次 API 查询看到 `vibox-shop` 有 production deployment，也看到 preview deployment 记录。判断是否影响线上，只看正式域名和 production deployment：

```text
shop.eforge.xyz -> HTTP/2 200
vibox-shop.pages.dev -> HTTP/2 200
Pages custom domain shop.eforge.xyz -> active
```

所以 Pages 部署记录不止一条不等于“线上部署错了两份”。真正需要纠偏的是同名 Worker script 与 Pages project 并存。

### xtools

```text
类型：Cloudflare Pages project
默认域名：xtools-7nq.pages.dev
正式域名：tool.eforge.xyz
GitHub source：qwdingyu/xtools
DNS 记录：tool.eforge.xyz CNAME xtools-7nq.pages.dev, proxied=false
Pages custom domain：active
线上状态：https://tool.eforge.xyz -> HTTP/2 200
```

`xtools` 证明了一个关键事实：Pages 默认域名不一定是 `<project>.pages.dev`。脚本必须读取 Cloudflare Pages API 返回的 `project.subdomain`，不能自己拼接。

## API 与 HTTP 验证证据

本次核查使用了 Cloudflare API 和线上 HTTP 验证，不只依赖截图判断。

已验证：

```text
https://ai.eforge.xyz -> HTTP/2 200
https://gptsession2cpaandsub2api.mailforwdy.workers.dev -> HTTP/2 200
https://shop.eforge.xyz -> HTTP/2 200
https://vibox-shop.pages.dev -> HTTP/2 200
https://tool.eforge.xyz -> HTTP/2 200
https://xtools-7nq.pages.dev -> HTTP/2 200
```

Cloudflare API 已验证：

```text
Workers custom domains:
- ai.eforge.xyz -> service gptsession2cpaandsub2api

Workers routes:
- eforge.xyz 当前 routes 为空

DNS:
- ai.eforge.xyz AAAA 100::, proxied=true, read_only=true
- shop.eforge.xyz CNAME vibox-shop.pages.dev, proxied=false
- tool.eforge.xyz CNAME xtools-7nq.pages.dev, proxied=false

Pages custom domains:
- shop.eforge.xyz status=active, verification=active, validation=active
- tool.eforge.xyz status=active, verification=active, validation=active
```

## 差异点解释

### 差异 1：为什么 gptsession2cpaandsub2api 的域名方式不同

因为它是 Worker，不是 Pages。

Workers 的正式子域名绑定推荐使用 Workers Custom Domains。绑定后 Cloudflare 会自动生成一个只读 DNS 记录，常见形态是：

```text
AAAA 100::
proxied=true
read_only=true
```

这个记录不是普通业务服务器的 IPv6 地址，也不是需要用户维护的源站地址，而是 Cloudflare 用来把该主机名接到 Worker 的托管记录。

Pages 的正式子域名绑定则是：

```text
CNAME <actual-pages-subdomain>
proxied=false
```

所以截图中 `gptsession2cpaandsub2api` 和其他 Pages 项目的域名显示不同，是正常现象。

### 差异 2：为什么 vibox-shop 出现两次

因为当前 Cloudflare 账号里同时存在：

```text
Worker script: vibox-shop
Pages project: vibox-shop
```

这不是最佳实践。一个应用应该只有一个明确的 Cloudflare 产品入口。

当前应以 Pages project `vibox-shop` 为准，因为：

1. `shop.eforge.xyz` 的 DNS 指向 `vibox-shop.pages.dev`。
2. Pages custom domain 已经 active。
3. 线上 `shop.eforge.xyz` 返回 HTTP/2 200。
4. Workers custom domains 只绑定了 `ai.eforge.xyz`，没有绑定 `shop.eforge.xyz`。
5. Workers routes 查询为空，没有路由把 `shop.eforge.xyz` 指向 `vibox-shop` Worker。

因此 `vibox-shop` Worker script 目前看是重复残留对象，而不是生产入口。

## 最佳实践

### 1. 先判断项目类型，再选部署线

每个新项目上线前先做一次分类：

```text
纯静态落地页、展示页、下载页、营销页：
优先 Cloudflare Pages

需要边缘函数、API、D1/KV/R2、定时任务：
优先 Cloudflare Workers

已有 Worker 线上跑通的项目：
继续 Workers，不要为了“像静态站”再迁到 Pages
```

### 2. 一个应用只保留一个 Cloudflare 产品入口

标准关系：

```text
一个应用目录
-> 一个独立 Git 仓库
-> 一个 GitHub repo
-> 一个 Cloudflare Pages project 或一个 Worker script
-> 一个正式子域名
```

禁止在同一应用上同时维护 Pages project 和 Worker script，除非有明确架构设计，例如 Pages 前端加单独 Worker API，且二者名称、域名和职责明确分离。

### 3. Pages 项目标准流程

适用：`vibox-shop`、`xtools` 这种独立静态项目。

```text
本地提交
-> GitHub push main
-> Cloudflare Pages 绑定 GitHub repo
-> Pages custom domain
-> DNS-only CNAME 指向 Cloudflare API 返回的 project.subdomain
-> 等待 custom domain active
-> curl 验证 pages.dev 和正式域名
```

关键规则：

```text
不要手写 <project>.pages.dev
必须读取 Pages project.subdomain
```

原因：`vibox-shop` 正好是 `vibox-shop.pages.dev`，但 `xtools` 是 `xtools-7nq.pages.dev`。

### 4. Workers 项目标准流程

适用：`gptsession2cpaandsub2api` 这种 Worker 项目。

```text
本地提交
-> GitHub push main
-> Workers Builds 或 wrangler deploy
-> Workers Custom Domains 绑定正式子域名
-> Cloudflare 自动生成只读 DNS
-> curl 验证 workers.dev 和正式域名
```

关键规则：

```text
不要为 Workers Custom Domain 手动创建普通 CNAME
不要把 read_only AAAA 100:: 当成异常
```

### 5. 手动部署命令要和项目类型匹配

Pages：

```bash
rtk npx wrangler pages deploy src --project-name <pages-project>
```

Workers：

```bash
rtk npx wrangler deploy
```

如果在 Pages 项目中看到下面警告，应立即停止并纠偏：

```text
wrangler deploy on a Pages project
wrangler pages deploy should be used instead
```

继续执行会产生不想要的 Worker script，`vibox-shop` 重复对象就是这个风险的实例。

### 6. 自动化脚本必须幂等

Pages 脚本必须做到：

```text
已存在 Pages project -> 复用
已存在 custom domain -> 复用
已存在正确 CNAME -> 不改
CNAME 指向错误 -> 更新到 project.subdomain
存在非 CNAME 冲突记录 -> 停止并报错
等待 custom domain active -> 再输出成功
```

Workers 脚本必须做到：

```text
已存在 custom domain -> 复用
没有 custom domain -> 创建
创建后 curl 验证正式域名
不手动创建普通 DNS CNAME
```

## vibox-shop 重复 Worker 的处理建议

当前不要立刻删除。删除 Worker script 是破坏性操作，必须满足全部条件再执行：

1. `shop.eforge.xyz` 确认走 Pages，HTTP 200。
2. `vibox-shop.pages.dev` 确认 HTTP 200。
3. Workers custom domains 中没有 `shop.eforge.xyz`。
4. Workers routes 为空，或没有任何 route 指向 `vibox-shop`。
5. Cloudflare Dashboard 中确认没有人使用 `vibox-shop` Worker 的 `workers.dev` 地址。
6. GitHub 仓库、文档、脚本均确认生产入口是 Pages project。

满足后才可以删除 Worker script `vibox-shop`。删除前建议再记录一次 API 查询结果和 Dashboard 截图。

## 以后新项目的执行清单

### Pages 新项目

```bash
rtk git init
rtk git add .
rtk git commit -m "<中文 Lore commit>"
rtk gh repo create <repo> --private --source=. --remote=origin --push

CF_AUTH_EMAIL="<cloudflare-email>" \
CF_GLOBAL_API_KEY="<global-api-key>" \
CF_CUSTOM_DOMAIN="<subdomain>.eforge.xyz" \
node ../scripts/cloudflare/pages_github_domain_workflow.mjs

rtk curl -sS -I https://<subdomain>.eforge.xyz
```

### Workers 新项目

```bash
rtk git init
rtk git add .
rtk git commit -m "<中文 Lore commit>"
rtk gh repo create <repo> --private --source=. --remote=origin --push
rtk npx wrangler deploy

CF_API_TOKEN="<worker-domain-token>" \
CF_ACCOUNT_ID="<account-id>" \
CF_ZONE_ID="<zone-id>" \
CF_WORKER_NAME="<worker-name>" \
CF_CUSTOM_DOMAIN="<subdomain>.eforge.xyz" \
node ../scripts/cloudflare/workers_custom_domain_bind.mjs

rtk curl -sS -I https://<subdomain>.eforge.xyz
```

## 最终结论

1. `gptsession2cpaandsub2api` 和 `vibox-shop` 的域名方式不同，是因为前者是 Workers，后者是 Pages。
2. `ai.eforge.xyz` 的只读 `AAAA 100::` 是 Workers Custom Domain 的正常结果，不是错误配置。
3. `vibox-shop` 出现两次，是因为同时存在 Worker script 和 Pages project；当前生产入口应认定为 Pages project。
4. 后续静态落地页类项目复制 `vibox-shop`/`xtools` 的 Pages 流程。
5. 后续 Worker/API 类项目复制 `gptsession2cpaandsub2api` 的 Workers 流程。
6. 不再混用 `wrangler deploy` 和 `wrangler pages deploy`；命令必须与项目类型一致。
