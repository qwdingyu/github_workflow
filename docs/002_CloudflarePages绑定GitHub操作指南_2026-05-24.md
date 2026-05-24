# Cloudflare Pages 绑定 GitHub 操作指南

日期：2026-05-24

## 结论

`GPTSession2CPAandSub2API` 的最佳上线方式是：

```text
GitHub 私有仓库 -> Cloudflare Pages Git integration -> main 分支自动生产部署
```

首次绑定推荐使用 Cloudflare Dashboard，而不是纯命令行。

原因：

- Cloudflare Pages 的 GitHub 集成依赖 Cloudflare GitHub App 授权。
- 首次安装 GitHub App、选择账号/组织、授予仓库访问权限，这些是浏览器授权流程，Dashboard 更稳定。
- `wrangler` 更适合 Pages 项目管理、直接上传部署、兜底发布和后续自动化，不适合作为首次 GitHub App 绑定的唯一入口。
- Cloudflare Pages API 可以创建带 Git source 的项目，但前提是 Cloudflare 账号已经完成 GitHub App 授权，并且已经拿到 GitHub repo、owner、installation 等上下文；对个人试点项目不如 Dashboard 稳。

最佳实践：

1. 首次绑定 GitHub：用 Cloudflare Dashboard。
2. 日常发布：用 `git push` 触发 Pages 自动部署。
3. 日常检查：用 Cloudflare Dashboard、Cloudflare API 或 Wrangler。
4. 兜底发布：用 `wrangler pages deploy src --project-name <项目名>`，但不要把它作为主路径。

## 当前项目部署配置

项目名建议：

```text
gptsession2cpaandsub2api
```

GitHub 仓库：

```text
qwdingyu/GPTSession2CPAandSub2API
```

Cloudflare Pages 推荐配置：

```text
Framework preset: None
Production branch: main
Build command: exit 0
Build output directory: src
Root directory: 留空
Environment variables: 不需要
```

说明：

- `src/index.html` 是站点入口。
- `src/favicon.svg` 是页面图标。
- `src/_headers` 会被 Cloudflare Pages 作为响应头配置读取。
- 当前项目没有 `package.json`，不需要安装依赖。
- 当前项目没有构建产物生成步骤，因此 `Build command` 使用 `exit 0`。

## Dashboard 绑定步骤

### 1. 确认 GitHub 仓库

本地已经推送到：

```text
https://github.com/qwdingyu/GPTSession2CPAandSub2API
```

本地检查：

```bash
rtk git status --short
rtk git remote -v
rtk git log -1 --oneline
```

预期：

- 工作区干净。
- `origin` 指向 `https://github.com/qwdingyu/GPTSession2CPAandSub2API.git`。
- `main` 已推送。

### 2. 进入 Cloudflare Pages

1. 打开 Cloudflare Dashboard。
2. 进入 `Workers & Pages`。
3. 点击 `Create application`。
4. 选择 `Pages`。
5. 选择 `Connect to Git` 或 `Import an existing Git repository`。

### 3. 授权 GitHub

如果是第一次绑定：

1. 点击 GitHub 授权。
2. 选择 GitHub 账号 `qwdingyu`。
3. 仓库权限建议选择 `Only select repositories`。
4. 勾选：

```text
qwdingyu/GPTSession2CPAandSub2API
```

不要给 Cloudflare GitHub App 授权所有仓库，除非后续确实要批量接入。

### 4. 选择仓库

回到 Cloudflare Pages 创建页面后，选择：

```text
qwdingyu/GPTSession2CPAandSub2API
```

如果仓库列表里没有出现：

1. 回到 GitHub App 授权页面。
2. 确认 Cloudflare Pages App 已被允许访问该私有仓库。
3. 刷新 Cloudflare Pages 创建页面。

### 5. 配置构建

填写：

```text
Project name: gptsession2cpaandsub2api
Production branch: main
Framework preset: None
Build command: exit 0
Build output directory: src
Root directory: 留空
```

环境变量不需要填写。

如果 Cloudflare UI 允许 Build command 留空，也可以留空；但本项目推荐 `exit 0`，因为它显式告诉 Pages “无构建步骤且构建成功”。

### 6. 创建并等待首次部署

点击 `Save and Deploy`。

首次部署完成后，Cloudflare 会给出类似：

```text
https://gptsession2cpaandsub2api.pages.dev
```

记录这个地址，后续作为 smoke test 目标。

## 首次部署后验收

### 页面功能

打开 Pages URL 后检查：

- 页面能加载。
- 浏览器标题正常。
- `favicon.svg` 正常。
- 可以粘贴示例 session JSON。
- 可以切换 `CPA`、`sub2api`、`Cockpit`、`9router`。
- 可以复制输出。
- 可以下载 JSON。

### 安全头

拿到 Pages URL 后运行：

```bash
rtk curl -I https://<你的项目>.pages.dev/
```

重点检查响应头：

```text
content-security-policy
x-frame-options
x-content-type-options
referrer-policy
permissions-policy
```

`content-security-policy` 必须包含：

```text
connect-src 'none'
```

原因：本项目处理 access token 和 session token，线上页面必须尽量禁止主动网络外发。

### 浏览器网络请求

在浏览器 DevTools 的 Network 面板检查：

- 初始加载只应有 HTML、favicon 等静态资源。
- 粘贴 token 并转换时，不应出现额外 API 请求。
- 不应把输入 JSON 发往任何远端服务。

## 命令行方案是否更稳定

### GitHub 侧

GitHub 有 `gh`，适合完整命令化：

```bash
rtk gh auth status
rtk gh repo view qwdingyu/GPTSession2CPAandSub2API
rtk gh pr status
rtk gh run list
rtk gh run view
```

GitHub 仓库创建、推送、PR、Actions 状态检查都可以由 `gh` 稳定接管。

### Cloudflare 侧

Cloudflare 的主 CLI 是 `wrangler`，不是 `gh` 这样的 GitHub 专用工具。

常见命令：

```bash
rtk npx wrangler login
rtk npx wrangler pages project list
rtk npx wrangler pages project create gptsession2cpaandsub2api --production-branch main
rtk npx wrangler pages deploy src --project-name gptsession2cpaandsub2api
```

但要注意：

- `wrangler pages deploy` 是直接上传部署，不是 GitHub 自动部署主路径。
- 直接上传适合兜底，不适合作为长期主发布链路。
- 如果绕过 GitHub 自动部署，就失去了 Git push/PR 和 Preview Deployment 的自然绑定。

### Cloudflare API

Cloudflare Pages API 可以创建项目，也支持项目的 source 配置。

但个人项目不建议一开始走 API 全自动绑定，原因：

- 首次 GitHub App 授权仍需要浏览器。
- API 参数需要 Cloudflare account id、GitHub repo id、owner id、安装状态等上下文。
- 出错时排查成本高于 Dashboard。
- 对单个试点项目不划算。

建议把 API 自动化留到第二阶段：当你已经有 3 个以上项目要批量接入 Pages，再沉淀脚本。

## 推荐 AI 接管闭环

### 主路径

```text
AI 修改代码和 docs
-> git commit
-> git push origin main
-> Cloudflare Pages 自动部署
-> AI/人检查 Pages 部署状态和页面功能
-> 失败则 AI 读日志、修复、再次提交
```

### 命令清单

本地提交：

```bash
rtk git status --short
rtk git add .
rtk git commit -m "<中文提交原因>"
rtk git push origin main
```

GitHub 检查：

```bash
rtk gh auth status
rtk gh repo view qwdingyu/GPTSession2CPAandSub2API
rtk gh run list --limit 5
```

Cloudflare 兜底检查：

```bash
rtk npx wrangler login
rtk npx wrangler pages project list
```

如果 GitHub 集成部署失败，而本地文件确认没问题，可以临时直接上传：

```bash
rtk npx wrangler pages deploy src --project-name gptsession2cpaandsub2api
```

兜底上传后必须在 `docs/` 记录原因，不能让兜底路径变成长期主路径。

## 注意事项

### 1. 私有仓库权限

当前 GitHub 仓库是 private。Cloudflare GitHub App 必须被允许访问该私有仓库，否则 Pages 创建页面看不到它。

### 2. `src/` 是公开站点目录，`docs/` 只放项目文档

当前项目已经把生产页面迁移到 `src/`，Cloudflare Pages 的 Build output directory 应配置为：

```text
src
```

这意味着 `docs/*.md` 不再作为站点静态产物发布。后续严禁把以下内容写入 `src/` 或 `docs/`：

- GitHub token。
- Cloudflare API token。
- ChatGPT session JSON。
- access token。
- refresh token。
- 真实账号凭证。
- 私有排查日志。

`src/` 只放线上需要访问的 HTML、图标和 Cloudflare Pages 配置文件。项目分析、踩坑记录、流程说明继续放 `docs/`。

### 3. `_headers` 必须在输出目录内

当前输出目录是 `src`，所以安全头文件必须放在：

```text
src/_headers
```

不要放到仓库根目录，否则 Cloudflare Pages 不会在当前配置下读取它。

### 4. 不要把 Wrangler 直接部署当主路径

直接部署虽然快，但会弱化 GitHub 仓库作为唯一事实源的约束。

主路径必须保持：

```text
commit -> push -> Cloudflare Git integration deploy
```

### 5. 后续每次变更都要提交

本项目后续每次修改都必须：

1. 同步代码和 docs。
2. 提交中文 commit。
3. 推送 GitHub。
4. 等待 Cloudflare Pages 自动部署。
5. 记录踩坑。

## 推荐执行顺序

1. 先用 Dashboard 完成首次 GitHub 绑定。
2. 拿到 Pages URL。
3. 用浏览器验收页面功能。
4. 用 `curl -I` 验收安全头。
5. 改一行 README 或 docs 做一次测试提交。
6. `git push origin main`。
7. 观察 Cloudflare Pages 是否自动部署新提交。
8. 部署成功后，把 Pages URL 补回 README 或新的部署记录文档。

## 官方资料

- Cloudflare Pages Git integration: https://developers.cloudflare.com/pages/get-started/git-integration/
- Cloudflare Pages build configuration: https://developers.cloudflare.com/pages/configuration/build-configuration/
- Cloudflare Pages headers: https://developers.cloudflare.com/pages/configuration/headers/
- Wrangler Pages commands: https://developers.cloudflare.com/workers/wrangler/commands/pages/
- Cloudflare Pages API create project: https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/
