# Cloudflare Workers 自动部署最佳实践

日期：2026-05-24

## 纠偏结论

线上地址：

```text
https://gptsession2cpaandsub2api.mailforwdy.workers.dev/
```

已经部署成功，而且可以访问。

通过 Cloudflare API 查询后确认，它当前对应的是 Cloudflare Workers 脚本：

```text
gptsession2cpaandsub2api
```

不是 Cloudflare Pages project。

因此，最佳实践不应该继续按 Pages 的 `Build output directory` 方案推进，而应该围绕 Workers 建立：

```text
本地修改 -> GitHub main -> Cloudflare Workers Builds -> workers.dev 自动更新
```

这既保留当前可访问的 `workers.dev` 地址，又满足“本地更新后推送到 GitHub，然后 Cloudflare 自动更新”的目标。

## 最佳实践方案

使用 Cloudflare Workers Builds。

Cloudflare 官方说明：Workers Builds 是 Cloudflare 原生 CI/CD，支持把现有 Worker 连接到 GitHub 或 GitLab；连接后，每次 push 到选定分支都可以自动 build/deploy。

对当前项目，推荐配置为：

```text
Worker: gptsession2cpaandsub2api
GitHub repo: qwdingyu/GPTSession2CPAandSub2API
Branch: main
Build command: 留空
Deploy command: npx wrangler deploy
Root directory: 仓库根目录
Wrangler config: wrangler.jsonc
Static assets directory: src
```

关键约束：

```text
Cloudflare Worker 名称必须等于 wrangler.jsonc 里的 name
```

当前已固定为：

```json
{
  "name": "gptsession2cpaandsub2api",
  "assets": {
    "directory": "./src"
  }
}
```

## 为什么这比 Pages 方案更适合当前状态

之前讨论 Pages，是因为项目本质是静态站点，Pages 确实适合静态站点。

但现实状态是：

- 线上域名已经是 `workers.dev`。
- Cloudflare API 中 Pages projects 为空。
- Cloudflare API 中 Workers scripts 存在 `gptsession2cpaandsub2api`。
- 用户目标是保留当前 Cloudflare 线上访问，并实现 GitHub push 后自动更新。

所以继续强行创建 Pages 会引入新域名和新项目，反而混淆。

当前最佳实践是：

```text
保留现有 Worker
用 Workers Static Assets 承载 src/
用 Workers Builds 连接 GitHub 自动部署
```

## 仓库结构

```text
src/
  index.html
  favicon.svg
  _headers

docs/
  001_...
  002_...
  003_...
  004_...
  005_...

wrangler.jsonc
README.md
LICENSE
```

职责：

- `src/`：线上静态资源。
- `docs/`：项目知识库、流程、分析、踩坑。
- `wrangler.jsonc`：Cloudflare Workers 部署配置源。
- `README.md`：用户入口和最短部署说明。

## Cloudflare Dashboard 连接步骤

1. 打开 Cloudflare Dashboard。
2. 进入 `Workers & Pages`。
3. 找到已有 Worker：

```text
gptsession2cpaandsub2api
```

4. 进入该 Worker。
5. 打开 `Settings`。
6. 打开 `Builds`。
7. 点击 `Connect`。
8. 选择 GitHub 账号。
9. 选择仓库：

```text
qwdingyu/GPTSession2CPAandSub2API
```

10. 配置：

```text
Branch: main
Root directory: /
Build command: 留空
Deploy command: npx wrangler deploy
```

11. 保存并触发首次 build。

注意：Cloudflare 官方要求，连接现有 Worker 时，Dashboard 里的 Worker 名称必须匹配 Wrangler 配置文件里的 `name`。本项目已经满足：

```text
gptsession2cpaandsub2api
```

## 本地开发和推送流程

每次修改：

```bash
rtk git status --short
rtk git diff --check
rtk rg -n "fetch\\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon" src/index.html
rtk rg -n "connect-src 'none'|Content-Security-Policy" src/_headers
rtk git add <files>
rtk git commit -m "<中文提交原因>" ...
rtk git push origin main
```

Cloudflare Workers Builds 连接成功后，`git push origin main` 会触发自动部署。

## 线上验证

推送后检查：

```bash
rtk curl -sS https://gptsession2cpaandsub2api.mailforwdy.workers.dev/ | rtk rg "custom-domain-smoke"
rtk curl -I https://gptsession2cpaandsub2api.mailforwdy.workers.dev/
rtk curl -sS https://ai.eforge.xyz/ | rtk rg "custom-domain-smoke"
rtk curl -I https://ai.eforge.xyz/
```

必须满足：

- 页面返回最新探针。
- HTTP 状态为 `200`。
- 响应头包含 `content-security-policy`。
- CSP 包含 `connect-src 'none'`。
- `workers.dev` 回退域名和 `ai.eforge.xyz` 自定义域名返回同一版本。

## 本次实测结果

提交：

```text
26f6a37 调整 Workers 部署目录并补齐 Codex 登录输出
```

操作：

```bash
rtk git push origin main
rtk curl -sS https://gptsession2cpaandsub2api.mailforwdy.workers.dev/ | rtk rg "workflow-smoke-2026-05-24-003"
rtk curl -I https://gptsession2cpaandsub2api.mailforwdy.workers.dev/
```

结果：

- GitHub push 成功。
- 线上 Worker 立即返回 `workflow-smoke-2026-05-24-003`。
- 响应状态为 `HTTP/2 200`。
- 响应头包含 `content-security-policy`。
- CSP 保留 `connect-src 'none'`。
- 本地分支与 `origin/main` 同步。

结论：

```text
本地修改 -> GitHub main -> Cloudflare Workers 自动更新 -> 线上验证
```

当前链路已经跑通。后续主线按 Workers 自动部署执行，不再按 Pages 项目配置推进。

## 自定义域名实测补充

2026-05-24 已通过 Workers Custom Domains API 将当前 Worker 绑定到：

```text
https://ai.eforge.xyz/
```

该域名是当前项目的正式运维入口，`workers.dev` 域名保留为回退入口。

后续每次推送后，必须同时验证两个入口：

```bash
rtk curl -I https://ai.eforge.xyz/
rtk curl -sS https://ai.eforge.xyz/ | rtk rg "custom-domain-smoke"
rtk curl -I https://gptsession2cpaandsub2api.mailforwdy.workers.dev/
rtk curl -sS https://gptsession2cpaandsub2api.mailforwdy.workers.dev/ | rtk rg "custom-domain-smoke"
```

如果两个入口版本不一致，先等待 Cloudflare Workers Builds 完成；仍不一致时再检查缓存、构建日志和 Worker custom domain 绑定状态。

## 命令行兜底

如果 Workers Builds 暂未连接，或者 Cloudflare 构建失败，可以临时用 Wrangler 直接部署：

```bash
CLOUDFLARE_API_TOKEN=<token> rtk npm exec wrangler -- deploy
```

但这只是兜底，不是主流程。

使用兜底后必须写入 `docs/`：

- 背景。
- 为什么自动构建失败。
- 临时部署命令。
- 如何恢复 GitHub 自动部署。

## API Token 结论

本次验证发现：

- 账号级 token 可以通过 `accounts/{account_id}/tokens/verify` 验证。
- 该 token 能读取 Workers scripts。
- 该 token 能让 Wrangler 在非交互环境中运行。
- 该 token 不适合用 `/user/tokens/verify` 判断，因为它不是 user-scoped token。

安全建议：

```text
已出现在对话中的 token 后续应轮换。
```

生产自动部署建议交给 Workers Builds 内部生成和管理 token，减少在 GitHub Secrets 或本地环境中长期保存 Cloudflare token。

## 为什么不把 Pages 当主线

Pages 不是错方案，但当前项目已经跑在 Workers。

继续切 Pages 会带来：

- 新项目。
- 新域名或额外域名迁移。
- 旧 Worker 是否保留的问题。
- 工作流理解成本。

对当前目标来说，Workers Builds 是最短路径，也是 Cloudflare 官方支持的原生 CI/CD。

## 官方依据

- Cloudflare Workers CI/CD: https://developers.cloudflare.com/workers/ci-cd/
- Cloudflare Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Cloudflare Workers GitHub integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
