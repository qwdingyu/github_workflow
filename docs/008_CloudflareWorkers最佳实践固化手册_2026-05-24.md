# Cloudflare Workers 最佳实践固化手册

日期：2026-05-24

## 结论

对当前项目，以下流程就是最佳实践：

```text
src/ 静态资源
-> wrangler.jsonc 作为部署配置事实源
-> GitHub main 作为代码事实源
-> Cloudflare Workers Builds 自动部署
-> Workers Static Assets 承载页面
-> Workers Custom Domains 绑定 ai.eforge.xyz
-> workers.dev 保留为回退入口
-> curl 验证正式域名和回退域名
-> docs 记录变更、踩坑和运维结论
```

这个结论不是泛泛而谈，而是由三部分共同确定：

1. 当前项目的真实线上产品是 Cloudflare Workers，不是 Pages。
2. Cloudflare 官方文档支持 Workers GitHub 自动部署、Workers Static Assets、Workers Custom Domains。
3. 本项目已经实测完成 `git push -> Workers 自动部署 -> ai.eforge.xyz 最新版本可访问` 的闭环。

## 当前事实

| 项 | 当前值 | 是否事实源 |
| --- | --- | --- |
| GitHub 仓库 | `qwdingyu/GPTSession2CPAandSub2API` | 是 |
| 主分支 | `main` | 是 |
| Cloudflare 产品 | Workers | 是 |
| Cloudflare Account ID | `f4c2f5b7c4134455ba93f1ebc0233664` | 是 |
| Cloudflare Zone | `eforge.xyz` | 是 |
| Cloudflare Zone ID | `b1df754ff171d8b748d831b04a69aac2` | 是 |
| Worker 名称 | `gptsession2cpaandsub2api` | 是 |
| Wrangler 配置 | `wrangler.jsonc` | 是 |
| 静态资源目录 | `src/` | 是 |
| 正式域名 | `https://ai.eforge.xyz/` | 是 |
| 回退域名 | `https://gptsession2cpaandsub2api.mailforwdy.workers.dev/` | 是 |
| 文档目录 | `docs/` | 是 |

`docs/` 是项目知识库，但不是部署资源目录。线上页面必须放在 `src/`，不要再把 `docs/index.html` 当作部署入口。

复用到其他项目时，只能替换表中的项目身份信息，例如仓库名、Worker 名称、Account ID、Zone ID、域名和 smoke marker；不要替换主流程。

## 官方依据核查

### Workers Builds

Cloudflare 官方 GitHub integration 说明：Cloudflare 支持把 GitHub 仓库连接到 Worker，并在 push 变更时自动部署。

本项目使用方式：

```text
GitHub main -> Cloudflare Workers Builds -> npx wrangler deploy
```

### Workers Static Assets

Cloudflare 官方 Static Assets 说明：Wrangler 配置中的 `assets.directory` 是静态资源上传和分发的核心配置。

本项目固定为：

```json
{
  "assets": {
    "directory": "./src"
  }
}
```

因此：

- 页面文件放 `src/`。
- 安全响应头文件放 `src/_headers`。
- `docs/` 只放文档。

### Workers Custom Domains

Cloudflare 官方 Custom Domains 说明：Custom Domain 可以把 Worker 连接到一个域名或子域名，并由 Cloudflare 处理对应 DNS 记录和证书。Custom Domain 会把该域名或子域名的所有路径指向 Worker。

本项目正好符合这个条件：

```text
ai.eforge.xyz/*
```

全部由当前 Worker 提供服务。

### Workers Routes

Cloudflare 官方 Routes 说明：Routes 是把 URL pattern 映射到 Worker。

因此 Routes 适合：

```text
example.com/tool/*
api.example.com/v1/*
```

不适合作为当前项目首选，因为当前项目需要完整子域名入口，而不是挂在已有网站的一段路径上。

### Workers Domains API

Cloudflare API 提供：

```text
PUT /accounts/{account_id}/workers/domains
```

用于把域名绑定到 Worker。本项目已用该 API 成功绑定：

```text
hostname: ai.eforge.xyz
service: gptsession2cpaandsub2api
environment: production
enabled: true
```

## 最佳实践判定

### 为什么不是 Cloudflare Pages

Pages 适合静态站点，但本项目当前事实不是 Pages：

- 线上入口是 `workers.dev`。
- Cloudflare API 查询 Pages projects 为空。
- Workers scripts 中存在 `gptsession2cpaandsub2api`。
- `wrangler.jsonc` 已经使用 Workers Static Assets。

继续做 Pages 会引入第二套部署面，造成：

- 两个 Cloudflare 项目。
- 两套默认域名。
- 两套构建日志。
- 不确定哪个域名是正式入口。
- AI 后续判断混乱。

结论：

```text
禁止把当前项目迁移成 Pages，除非未来明确废弃现有 Worker。
```

### 为什么不是 Vercel

Vercel 能部署静态站点，但当前项目已经在 Cloudflare Workers 上跑通正式域名、HTTPS 和自动部署。

继续引入 Vercel 会造成：

- 第二个平台。
- 第二套域名绑定。
- 第二套部署日志。
- 第二套权限和 token。
- 对个人创业者没有必要。

结论：

```text
当前项目不引入 Vercel。
```

### 为什么不是自写部署平台

当前项目是单页静态工具，不需要自写发布系统。

最佳实践是使用官方能力：

- GitHub 管代码。
- Workers Builds 管自动部署。
- Wrangler 管部署配置。
- Custom Domains 管正式域名。
- curl 管线上验收。
- docs 管知识沉淀。

结论：

```text
不要造部署轮子。
```

## 标准工作流

### 0. 开始前核查

每次开发前先确认没有未理解的改动：

```bash
rtk git status --short
rtk git log -3 --oneline
```

如果发现未提交改动：

- 先判断是否与当前任务相关。
- 相关则读懂后继续。
- 不相关则不要回滚。
- 不清楚来源时不要覆盖。

### 1. 修改代码

线上资源只改：

```text
src/
```

文档只改：

```text
docs/
```

规则：

- 每次代码变更必须同步 docs。
- 不要把页面放到 docs。
- 不要把 token 写进代码、docs、README、commit message。
- smoke marker 只用于部署验证，不作为业务功能。

### 2. 本地验证

每次提交前至少执行：

```bash
rtk git diff --check
rtk rg -n "fetch\\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon" src/index.html
rtk rg -n "connect-src 'none'|Content-Security-Policy" src/_headers
rtk proxy npx wrangler deploy --dry-run
```

解释：

- `git diff --check`：防止空白和格式问题。
- `rg fetch...`：确认静态页没有意外联网、存储或追踪行为。
- `rg connect-src...`：确认 CSP 仍阻止外连。
- `wrangler deploy --dry-run`：确认 `wrangler.jsonc` 和 `src/` 能被 Wrangler 正确读取。

本项目标准使用：

```bash
rtk proxy npx wrangler deploy --dry-run
```

不要把 `rtk npm exec wrangler` 作为标准命令。此前实测它可能从错误目录查找 `package.json`。

### 3. 提交

提交必须是中文，并遵循 Lore Commit Protocol。

模板：

```text
<为什么做这个改动>

<背景、约束、方案取舍>

Constraint: <外部约束>
Rejected: <拒绝的方案> | <原因>
Confidence: high
Scope-risk: narrow
Directive: <后续维护提醒>
Tested: <已验证项>
Not-tested: <未验证项>
```

命令：

```bash
rtk git add <files>
rtk git commit -m "<中文原因>" -m "<正文>" -m "Tested: ..."
```

### 4. 推送

```bash
rtk git push origin main
```

推送后确认本地和远端一致：

```bash
rtk git rev-parse HEAD
rtk git rev-parse origin/main
rtk git status --short
```

验收标准：

```text
HEAD == origin/main
git status --short 输出为空
```

### 5. 线上验证

必须同时验证正式域名和回退域名。

```bash
rtk curl -I https://ai.eforge.xyz/
rtk curl -sS https://ai.eforge.xyz/ | rtk rg "custom-domain-smoke"
rtk curl -I https://gptsession2cpaandsub2api.mailforwdy.workers.dev/
rtk curl -sS https://gptsession2cpaandsub2api.mailforwdy.workers.dev/ | rtk rg "custom-domain-smoke"
```

必须满足：

- 两个域名都是 `HTTP/2 200`。
- 两个域名都返回同一个最新 smoke marker。
- 响应头包含 `content-security-policy`。
- CSP 包含 `connect-src 'none'`。

### 6. 记录

只要涉及以下任一项，就必须写入 docs：

- 部署流程变化。
- 域名变化。
- Cloudflare 权限变化。
- 线上验证失败。
- 缓存、DNS、证书、CSP 问题。
- 使用 Wrangler 兜底部署。
- 使用 Dashboard 手动处理。

踩坑记录必须包含：

```text
背景
原因
排查过程
解决方案
建议
```

## 域名绑定 SOP

### 前置条件

绑定前必须确认：

```text
zone: eforge.xyz
hostname: ai.eforge.xyz
worker: gptsession2cpaandsub2api
environment: production
```

不得绑定根域名，除非明确要让整个根域由该 Worker 接管。

### 只读检查

```bash
CLOUDFLARE_API_TOKEN=<token> rtk curl -sS "https://api.cloudflare.com/client/v4/accounts/<account_id>/workers/domains" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
```

判断：

- 如果 `ai.eforge.xyz` 已存在且 `service` 正确，不要重复创建。
- 如果存在但 `service` 不是当前 Worker，停止，先人工确认。
- 如果不存在，才进入绑定步骤。

### 执行绑定

本项目固定命令模板：

```bash
CLOUDFLARE_API_TOKEN=<token> rtk curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/f4c2f5b7c4134455ba93f1ebc0233664/workers/domains" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"hostname":"ai.eforge.xyz","service":"gptsession2cpaandsub2api","environment":"production","zone_id":"b1df754ff171d8b748d831b04a69aac2"}'
```

成功响应必须包含：

```text
success: true
hostname: ai.eforge.xyz
service: gptsession2cpaandsub2api
zone_name: eforge.xyz
enabled: true
```

### 绑定后验证

```bash
rtk curl -I https://ai.eforge.xyz/
rtk curl -sS https://ai.eforge.xyz/ | rtk rg "custom-domain-smoke"
```

如果短时间内 HTTPS 未生效：

1. 等待 Cloudflare 证书和 DNS 状态传播。
2. 重新查询 Workers custom domains。
3. 确认没有同名 CNAME 记录冲突。
4. 不要立刻切 Pages 或新建第二个项目。

## Token 策略

### 总原则

```text
能短期授权就不长期授权。
能只读就不写入。
能分 token 就不共用一个全能 token。
出现在聊天、日志、命令历史里的 token 必须轮换。
```

### 推荐三类 token

| Token | 用途 | 最小权限方向 |
| --- | --- | --- |
| Deploy Token | Wrangler 兜底部署 | Account Workers Scripts Edit |
| Readonly Ops Token | 查询 Worker、Build、Domain、DNS 状态 | Account/Zone Read |
| Domain Ops Token | 绑定 Custom Domain、改 DNS、改 Routes | 只在域名变更时临时启用 |

本项目当前现象：

- Workers Custom Domains API 可用。
- DNS records 直读仍返回认证错误。

因此不要把当前 token 误判为完整 DNS 运维 token。

## MCP 和 Skill 使用边界

MCP 可以提高诊断效率，但不是本项目上线闭环的事实源。

使用原则：

- 先以 Cloudflare 官方文档、Wrangler、Cloudflare API、GitHub 和 curl 为准。
- MCP 只作为查询、诊断和生成计划的辅助工具。
- 如果使用 Cloudflare MCP，必须先核查当前官方文档和仓库说明，不把口头记忆当事实。

推荐用途：

- 查询官方文档。
- 读取配置。
- 诊断 Workers Builds。
- 生成变更计划。

不推荐做法：

- 长期给 MCP 高权限 token。
- 让 MCP 在未审查计划时直接改 DNS。
- 用 MCP 替代 `wrangler.jsonc`、GitHub commit、curl 验证。

本项目最稳做法：

```text
MCP 辅助查询和诊断
Wrangler 负责部署配置事实源
GitHub 负责代码事实源
curl 负责最终线上验收
docs 负责知识沉淀
```

## 故障处理

### 线上还是旧版本

现象：

```text
curl 返回旧 smoke marker
```

处理：

1. 检查 `HEAD == origin/main`。
2. 检查 Cloudflare Workers Builds 是否完成。
3. 同时检查 `workers.dev` 和 `ai.eforge.xyz`。
4. 如果 `workers.dev` 新、正式域名旧，检查 Custom Domain 和缓存。
5. 如果两个都旧，检查 GitHub push 和 Workers Builds。
6. 不要直接新建 Pages 项目。

### Custom Domain API 成功但 DNS records 读取失败

这是本项目已经观测到的状态，不是幻觉，也不是自动部署失败。

原因：

- Workers Custom Domains 权限可用。
- Zone DNS records 权限不足或资源范围不匹配。

处理：

- 对本项目正式域名访问不构成阻塞。
- 对完整 DNS 运维仍是风险。
- 需要创建独立 Domain Ops Token 并限制资源范围。

### curl 偶发 DNS 解析失败

现象：

```text
curl: (6) Could not resolve host
```

处理：

1. 立即用 `curl -I` 重试。
2. 同时测正式域名和回退域名。
3. 如果 HEAD 成功、body 失败，多数是本地网络或 DNS 抖动。
4. 继续重试，不要误判为 Cloudflare 部署失败。
5. 如果连续失败，再检查 DNS 和 Custom Domain 状态。

### CSP 丢失

现象：

```text
响应头没有 content-security-policy
或缺少 connect-src 'none'
```

处理：

1. 检查 `src/_headers`。
2. 检查是否误把页面部署目录改出了 `src/`。
3. 运行 `wrangler deploy --dry-run`。
4. 修复后提交、推送、重新验证两个域名。

### 自动部署失败

处理顺序：

1. 先查 Workers Builds 日志。
2. 检查 `wrangler.jsonc`。
3. 本地跑 `rtk proxy npx wrangler deploy --dry-run`。
4. 仍失败再考虑本地 Wrangler 兜底部署。
5. 兜底部署后必须写 docs，说明为什么绕过主路径。

## 禁止事项

除非明确新需求，否则不要做：

- 不要新建 Cloudflare Pages project。
- 不要迁移到 Vercel。
- 不要把 `src/index.html` 移回 `docs/`。
- 不要删除 Worker。
- 不要删除 custom domain。
- 不要修改根域名 DNS。
- 不要提交 token。
- 不要在没有验证两个域名的情况下宣称上线成功。
- 不要只看浏览器缓存结果，必须用 curl 验证。

## 完成定义

一次部署或运维任务只有同时满足以下条件，才算完成：

```text
代码已修改
docs 已同步
中文 Lore commit 已提交
git push origin main 已完成
HEAD == origin/main
wrangler dry-run 通过，或明确说明为什么本次不需要
ai.eforge.xyz 返回 HTTP/2 200
workers.dev 返回 HTTP/2 200
两个域名返回同一个最新 smoke marker
CSP 包含 connect-src 'none'
git status --short 为空
```

如果有任一项不满足，不能说“已经完成”，只能说“完成到哪一步，阻塞在哪里”。

## 官方参考

- Cloudflare Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Cloudflare Workers GitHub integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare Workers Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare Workers Routes: https://developers.cloudflare.com/workers/configuration/routing/routes/
- Cloudflare Workers Domains API: https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/
- Cloudflare MCP server repository: https://github.com/cloudflare/mcp-server-cloudflare
- Cloudflare API MCP server repository: https://github.com/cloudflare/mcp
