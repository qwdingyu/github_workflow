# Cloudflare Pages 独立项目标准工作流

日期：2026-05-24

## 结论

以后所有轻量落地页、工具页、资料页、表单页，都按这一套执行：

```text
一个可部署应用
= 一个独立 Git 仓库
= 一个独立 GitHub repo
= 一个独立 Cloudflare Pages project
= 一个独立自定义域名
```

不要把具体业务项目长期放进 `github_workflow` 主仓库。主仓库只沉淀流程、脚本、规范和踩坑记录。

## 标准路径

```text
本地项目目录
-> git init
-> gh repo create
-> git push
-> Cloudflare Pages GitHub 集成项目
-> 绑定 custom domain
-> DNS CNAME
-> curl 验证
-> docs 记录
```

更稳的执行顺序：

```text
1. 本地项目先初始化并提交。
2. 创建 GitHub repo 并 push main。
3. 运行 pages_github_domain_workflow.mjs 创建 Pages project、custom domain 和 DNS CNAME。
4. 如果 Cloudflare Pages deployments 为空，再 push 一次真实提交或空提交触发首次构建。
5. 等 Pages deployment success。
6. 等 custom domain active。
7. curl 验证 pages.dev 和正式域名。
```

原因：Cloudflare Pages 项目如果在 GitHub 首次 push 之后才创建，可能不会自动部署已经存在的旧提交，需要后续一次 push 触发首次 production deployment。

## 项目结构建议

纯静态落地页推荐：

```text
project/
  README.md
  package.json
  src/
    index.html
    styles.css
    app.js
    _headers
  scripts/
    check.mjs
  docs/
    001_部署纠偏记录_YYYY-MM-DD.md
```

不需要：

- `wrangler.toml`
- Worker `main`
- Vite/Next.js/React
- 构建命令

除非项目确实需要组件化、路由、SSR、API 或构建产物。

## GitHub

每个项目独立仓库：

```bash
git init -b main
git add .
git commit -m "初始化项目"
gh repo create <repo-name> --private --source=. --remote=origin --push
```

建议默认 private。确认没有内部账号、zone id、部署记录后，再考虑 public。

## Cloudflare Pages 配置

标准配置：

```text
Project name: <project-name>
Source: GitHub
Repo: <owner>/<repo>
Production branch: main
Build command: 留空
Build output directory: src
Preview deployments: 关闭或按需开启
```

如果项目有构建步骤：

```text
Build command: npm run build
Build output directory: dist 或 build
```

但纯静态项目不要为了“看起来专业”引入构建链路。

## 绝对不要混用 Workers 命令

不要对 Pages 项目执行：

```bash
wrangler deploy
npx wrangler deploy
```

这是 Workers 命令，会触发：

```text
Missing entry-point to Worker script or to assets directory
```

Pages 静态项目只使用：

```bash
npx wrangler pages deploy src --project-name <project-name>
```

更推荐：

```text
git push -> Cloudflare Pages 自动构建
```

## 自定义域名

Pages 绑定 custom domain 只完成“项目和域名的关系”。DNS 仍然要有 CNAME。

标准 DNS：

```text
Type: CNAME
Name: <subdomain>
Target: Cloudflare Pages API 返回的 project.subdomain
Proxy status: DNS only
TTL: Auto
```

例如：

```text
shop.eforge.xyz -> vibox-shop.pages.dev
tool.eforge.xyz -> xtools-7nq.pages.dev
```

不要自己拼 `<project-name>.pages.dev`。

`vibox-shop` 的默认域名正好是 `vibox-shop.pages.dev`，但 `xtools` 的默认域名是 `xtools-7nq.pages.dev`。这说明 Cloudflare Pages 默认子域名不总是项目名直连，必须以 API 返回的 `subdomain` 为准。

如果 Pages custom domain 显示：

```text
CNAME record not set
```

说明 Pages 绑定已创建，但 DNS CNAME 没有创建或没有生效。

关键注意：

```text
Cloudflare Pages 自定义域名初始验证时，CNAME 优先使用 DNS only。
```

本次实测 `shop.eforge.xyz` 使用 `proxied=true` 时出现两个问题：

- Pages domain 仍显示 `CNAME record not set`。
- `https://shop.eforge.xyz` 返回 522。

将同一条 CNAME 改为 `proxied=false` 后：

- Pages domain 进入 `active`。
- `https://shop.eforge.xyz` 返回 HTTP/2 200。

因此，Pages 项目自动化脚本默认使用 DNS only，不要默认开启 proxy。

2026-05-24 后续安全加固复测补充：

```text
Pages custom domain active 后，如果希望 Cloudflare WAF 对该 Pages 域名生效，需要把 CNAME 切回 proxied=true。
DNS-only 可以让 Pages 访问成功，但不会经过 Cloudflare 代理层，因此 WAF 不会拦截 /.env、/.git、/admin 等路径。
```

当前最终实践：

```text
1. 首次绑定 Pages custom domain：先用 proxied=false，确保 Pages active 和 HTTPS 200。
2. 安全加固阶段：切换 proxied=true。
3. 切换后立即验证：
   - 首页仍 HTTP/2 200。
   - /.env 返回 HTTP/2 403。
   - /admin 返回 HTTP/2 403 且 cf-mitigated: challenge。
4. 如果 proxied=true 复现 522，再临时回滚 proxied=false，并记录排查。
```

## 权限模型

Cloudflare 自动化最少需要两类权限：

### Pages Deploy Token

```text
Account -> Cloudflare Pages -> Edit
Account resource -> 对应 account
```

用于：

- 创建 Pages project。
- 查询 deployments。
- 创建 Pages custom domain。

### Domain DNS Token

```text
Zone -> DNS -> Edit
Zone resource -> 指定 zone，例如 eforge.xyz
```

用于：

- 查询 DNS records。
- 创建 CNAME。
- 更新 CNAME。

不要把“能创建 Pages custom domain”误认为“能管理 DNS”。这两个权限面不同。

## 可执行脚本

主仓库提供脚本：

```text
scripts/cloudflare/pages_github_domain_workflow.mjs
```

用途：

- 确认或创建 GitHub 集成型 Pages project。
- 确认或创建 Pages custom domain。
- 确认或创建 DNS CNAME。
- 输出后续 curl 验证命令。

使用方式：

最小配置，适合当前已验证的 Global API Key 路径：

```bash
CF_AUTH_EMAIL="<cloudflare-login-email>" \
CF_GLOBAL_API_KEY="<global-api-key>" \
CF_CUSTOM_DOMAIN="tool.eforge.xyz" \
node ../scripts/cloudflare/pages_github_domain_workflow.mjs
```

脚本会自动推导：

```text
GitHub owner/repo: 从当前目录 git remote.origin.url 读取
Pages project: 默认使用 GitHub repo name
Cloudflare account: 如果账号列表只有一个，自动选择
Cloudflare zone: 从 custom domain 推导 eforge.xyz 并查询 zone id
CNAME target: 从 Cloudflare Pages project.subdomain 读取
```

脚本默认会对 Cloudflare API 的瞬时网络错误、`429` 和 `5xx` 做有限重试：

```text
CF_REQUEST_RETRIES=3
CF_REQUEST_RETRY_DELAY_MS=1000
```

原因：实际复跑 `xtools` 时出现过 `socket hang up`。当 Pages project、custom domain、DNS CNAME 已经正确时，单次 API 连接中断不应让整个自动化流程误判失败。

完整覆盖配置，适合多账号、多 zone 或特殊项目：

```bash
CF_API_TOKEN="<token>" \
CF_DNS_AUTH_EMAIL="<cloudflare-login-email>" \
CF_DNS_GLOBAL_API_KEY="<global-api-key>" \
CF_ACCOUNT_ID="<account_id>" \
CF_ZONE_ID="<zone_id>" \
CF_PAGES_PROJECT="vibox-shop" \
CF_GITHUB_OWNER="qwdingyu" \
CF_GITHUB_REPO="vibox-shop" \
CF_CUSTOM_DOMAIN="shop.eforge.xyz" \
node scripts/cloudflare/pages_github_domain_workflow.mjs
```

默认值：

```text
CF_PRODUCTION_BRANCH=main
CF_BUILD_COMMAND=""
CF_DESTINATION_DIR=src
CF_ROOT_DIR=""
CF_CNAME_TARGET=<Cloudflare Pages API result.subdomain>
CF_DNS_PROXIED=false
CF_REQUEST_RETRIES=3
CF_REQUEST_RETRY_DELAY_MS=1000
```

如果 Pages token 缺少 DNS 权限，脚本支持单独传入 DNS 凭据：

```text
CF_DNS_API_TOKEN
```

或 Global API Key 模式：

```text
CF_DNS_AUTH_EMAIL
CF_DNS_GLOBAL_API_KEY
```

本次实际成功路径使用的是：

```text
CF_API_TOKEN 管 Pages
CF_DNS_AUTH_EMAIL + CF_DNS_GLOBAL_API_KEY 管 DNS
```

## 验证清单

每个项目上线后都必须验证：

```bash
curl -I https://<project-name>.pages.dev
curl -I https://<custom-domain>
```

Cloudflare API 验证：

```text
Pages deployment latest_stage.status = success
Pages custom domain status = active
DNS CNAME exists
```

页面功能验证：

- 首页返回 200。
- CSS/JS 正常加载。
- 购买按钮可跳转。
- Telegram/社群入口可跳转。
- 移动端首屏可读。

## Vibox 本次踩坑

### 背景

`shop` 是独立落地页项目，目标域名 `shop.eforge.xyz`。

### 原因

第一次执行路径混用了 Workers：

```text
wrangler deploy
```

导致 Wrangler 按 Worker 项目解析，报缺少 entry-point。

### 排查过程

1. 确认项目是纯静态 Pages，而不是 Worker。
2. 查询 Cloudflare Pages project，确认 `build_command` 为空、`destination_dir=src`。
3. 删除 `wrangler.toml`，避免诱导 Worker 部署。
4. GitHub push 后查询 Pages deployments，确认 production success。
5. `curl -I https://vibox-shop.pages.dev` 返回 200。
6. 查询 custom domain，发现 `CNAME record not set`。
7. 尝试 DNS records API，Bearer token 返回 Authentication error。
8. 回查 Wrangler 日志，确认 Cloudflare 登录邮箱为 `mailforwdy@gmail.com`。
9. 将 `cfk_...` 按 Global API Key 模式测试，使用 `X-Auth-Email` + `X-Auth-Key` 后 DNS records API 成功。
10. 创建 `shop -> vibox-shop.pages.dev` CNAME，初始 `proxied=true` 导致 522 和 Pages 仍报 CNAME 未设置。
11. 将 CNAME 改为 `proxied=false`，Pages custom domain 变为 active，HTTPS 返回 200。

### 解决方案

项目部署和域名均已完成；最终 DNS CNAME：

```text
shop -> vibox-shop.pages.dev
proxied=false
```

并确保 AI 使用的 DNS 凭据具备：

```text
Zone -> DNS -> Read/Edit -> eforge.xyz
```

如果使用 Global API Key，必须使用：

```text
X-Auth-Email: <Cloudflare 登录邮箱>
X-Auth-Key: <Global API Key>
```

不能把 Global API Key 当 Bearer token 使用。

### 建议

后续不要重新探索。新项目直接按本文和脚本执行：

```text
独立仓库
GitHub push
Pages Git 集成
DNS CNAME
curl 验证
docs 记录
```

遇到失败时先判断它属于哪一层：

```text
GitHub push 失败
Cloudflare Pages build 失败
Pages custom domain pending
DNS CNAME missing
HTTPS certificate pending
```

不要把 DNS 问题误判为部署失败，也不要把 Workers 命令用于 Pages 项目。

## XTools 二次验证

### 背景

为了验证脚本不是只对 `shop` 特例有效，新增独立项目：

```text
Project: xtools
GitHub: qwdingyu/xtools
Domain: tool.eforge.xyz
```

### 发现的问题

第一次脚本把 CNAME 写成：

```text
tool.eforge.xyz -> xtools.pages.dev
```

但 Cloudflare Pages API 返回的真实默认域名是：

```text
xtools-7nq.pages.dev
```

因此 Pages custom domain 一直显示：

```text
CNAME record not set
```

### 修正

脚本不再拼接 `<project>.pages.dev`，而是读取：

```text
GET /accounts/<account_id>/pages/projects/<project>
result.subdomain
```

最终写入：

```text
tool.eforge.xyz CNAME xtools-7nq.pages.dev
proxied=false
```

验证结果：

```text
tool.eforge.xyz -> HTTP/2 200
Pages deployment -> success
Pages custom domain -> active
```

二次幂等复跑时还暴露了瞬时网络问题：

```text
socket hang up
```

当时脚本已经确认：

```text
Pages project exists: xtools
Pages custom domain exists: tool.eforge.xyz (active)
DNS CNAME already correct: tool.eforge.xyz -> xtools-7nq.pages.dev
```

因此这不是配置错误，而是 Cloudflare API 连接瞬断。脚本已补充请求重试，避免后续大规模复制时因为单次网络抖动误报失败。

### 结论

二次验证证明脚本现在具备跨项目复用能力：

- 可以从 Git remote 推导 GitHub owner/repo。
- 可以从 custom domain 推导 zone。
- 可以从 Cloudflare account list 推导 account id。
- 可以从 Pages project API 推导真实 CNAME target。
- 可以创建 DNS only CNAME。
- 可以等待 custom domain active。

后续新增 Pages 项目，不再手动填写 9 个变量。
