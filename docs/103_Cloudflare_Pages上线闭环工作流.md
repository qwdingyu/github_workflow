# Cloudflare Pages 上线闭环工作流

日期：2026-05-24

线上地址：

```text
https://gptsession2cpaandsub2api.mailforwdy.workers.dev/
```

## 背景

`GPTSession2CPAandSub2API` 已经可以通过 Cloudflare 访问。下一步不是继续堆功能，而是把“代码变更 -> GitHub -> Cloudflare 部署 -> 验收 -> 文档记录”的闭环固化下来。

这个项目处理 ChatGPT session、access token、session token 等敏感数据，因此上线流程必须同时满足：

- 可快速推送。
- 可验证部署是否生效。
- 可验证页面没有外发 token。
- 可追踪每次变更。
- 可回滚。
- 可沉淀踩坑记录。

## 总体原则

1. GitHub 是唯一事实源。
2. `main` 分支对应生产部署。
3. 每次修改必须有中文 commit。
4. 代码变更必须同步 `docs/`。
5. 不直接把 Wrangler 上传作为主发布路径。
6. Cloudflare 自动部署失败时，先读日志，再修复并提交，不绕过问题。
7. 本项目以小而美为目标，流程只保留必要动作。

## 推荐工作流

```text
确认需求
-> 阅读 README、docs、相关源码
-> 判断影响范围和风险
-> 修改代码和文档
-> 本地静态检查
-> 中文 Lore commit
-> git push origin main
-> 等待 Cloudflare 自动部署
-> curl 验证线上版本和响应头
-> 浏览器功能验收
-> 如失败，记录原因并继续修复
```

## 每次开发前检查

```bash
rtk git status --short
rtk git remote -v
rtk git log -3 --oneline
```

必须满足：

- 工作区干净，或明确知道未提交文件是谁改的。
- `origin` 指向自己的 GitHub 仓库。
- 当前分支是要部署的分支，当前项目为 `main`。

## 修改范围规则

### 代码

当前项目的生产页面是：

```text
src/index.html
```

修改它会直接影响线上页面。

### 文档

所有流程、分析、踩坑记录写入：

```text
docs/
```

命名格式：

```text
序号_中文文件名_日期.md
```

### 响应头

安全响应头在：

```text
src/_headers
```

它必须保留：

```text
connect-src 'none'
```

除非非常明确地要新增网络能力，否则不能放开 `connect-src`。

## 本地检查

本项目没有构建系统，因此最小检查如下：

```bash
rtk git diff --check
rtk rg -n "fetch\\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon" src/index.html
rtk rg -n "connect-src 'none'|Content-Security-Policy" src/_headers
```

预期：

- `git diff --check` 无输出。
- `src/index.html` 不出现主动网络请求或本地持久化存储。
- `src/_headers` 保留 CSP。

说明：`xmllint --html src/index.html` 不作为本项目验收标准，因为它会对 HTML5 语义标签、SVG 和内联 JavaScript 产生误报。

## 提交流程

```bash
rtk git add <变更文件>
rtk git commit -m "<中文原因>" \
  -m "<背景、约束、方案>" \
  -m "Constraint: <约束>" \
  -m "Rejected: <拒绝方案> | <原因>" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: <已验证内容>" \
  -m "Not-tested: <未验证内容>"
```

不要使用“update”“fix bug”这类无法解释原因的提交标题。

## 推送与自动部署

```bash
rtk git push origin main
```

推送成功后，Cloudflare Pages 应自动部署 `main`。

如果 Cloudflare 没有触发部署：

1. 检查 Cloudflare Pages 项目是否绑定了正确仓库。
2. 检查 Production branch 是否为 `main`。
3. 检查 GitHub App 是否仍有私有仓库访问权限。
4. 检查 GitHub 最近提交是否真的进入远端 `main`。

## 线上验收

### 1. 验证响应头

```bash
rtk curl -I https://gptsession2cpaandsub2api.mailforwdy.workers.dev/
```

必须检查：

```text
HTTP/2 200
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

### 2. 验证部署版本

本次流程测试在 `src/index.html` 中加入了不可见探针：

```text
workflow-smoke-2026-05-24-003
```

推送后执行：

```bash
rtk curl -sS https://gptsession2cpaandsub2api.mailforwdy.workers.dev/ | rtk rg "workflow-smoke-2026-05-24-003"
```

如果能匹配，说明 Cloudflare 已经部署了包含本次提交的新版本。

如果匹配不到：

1. 等待 30 秒再试。
2. 检查 Cloudflare Pages 部署日志。
3. 检查是否推送到了错误分支。
4. 检查 URL 是否指向当前 Pages 项目。

### 3. 浏览器功能验收

手动打开线上地址，检查：

- 页面正常加载。
- 输出格式切换正常。
- 示例 JSON 可以转换。
- 复制按钮可用。
- 下载按钮可用。
- 浏览器 Network 面板在转换时没有额外 API 请求。

### 4. 敏感数据验收

不要用真实长期 token 做测试。

如必须测试真实数据：

1. 使用临时或可废弃账号。
2. 测试后立即失效或轮换 token。
3. 不截图暴露 token。
4. 不把 token 粘贴进 issue、commit、docs 或聊天记录。

## 失败处理

### Git push 失败

先检查：

```bash
rtk gh auth status
rtk git remote -v
```

常见原因：

- GitHub CLI 授权过期。
- 远端仓库地址错误。
- 当前分支没有 upstream。
- 网络/DNS 不通。

### Cloudflare 部署失败

先检查：

- Build command 是否仍是 `exit 0`。
- Build output directory 是否仍是 `src`。
- `src/index.html` 是否存在。
- `src/_headers` 是否格式错误。
- Cloudflare GitHub App 是否有仓库权限。

不要立刻改成 Wrangler 直接上传。先修主链路。

### 页面能访问但不是新版本

先检查：

```bash
rtk git log -1 --oneline
rtk git ls-remote origin main
```

再检查 Cloudflare Pages 最近部署 commit 是否等于本地最新 commit。

## Wrangler 的定位

Wrangler 不是主发布路径。

可以用：

```bash
rtk npx wrangler pages project list
rtk npx wrangler pages deployment list --project-name gptsession2cpaandsub2api
```

直接上传只作为兜底：

```bash
rtk npx wrangler pages deploy src --project-name gptsession2cpaandsub2api
```

使用兜底后必须记录：

- 背景。
- 主链路为什么失败。
- 临时解决方案。
- 如何恢复 GitHub 自动部署主链路。

## 回滚策略

如果新版本上线后发现问题：

优先使用 Git 回滚：

```bash
rtk git revert <问题提交>
rtk git push origin main
```

只有在站点完全不可用且 GitHub 自动部署异常时，才考虑 Cloudflare Dashboard 回滚到上一条成功部署。

回滚后必须补一份踩坑记录到 `docs/`。

## 本次测试计划

本次提交会同时做两件事：

1. 新增本文档。
2. 在 `src/index.html` 增加不可见部署探针：

```text
workflow-smoke-2026-05-24-003
```

推送后用线上 curl 搜索该探针。如果能搜到，即证明：

```text
本地修改 -> Git commit -> GitHub main -> Cloudflare 自动部署 -> 线上可验证
```

闭环成立。

## 本次实测结果

### 第一次验证

提交：

```text
bc1a5a7 固化 Cloudflare Pages 上线闭环
```

验证命令：

```bash
rtk curl -sS https://gptsession2cpaandsub2api.mailforwdy.workers.dev/ | rtk rg "workflow-smoke-2026-05-24-001"
rtk curl -I https://gptsession2cpaandsub2api.mailforwdy.workers.dev/
```

结果：

- 线上首页成功返回 `workflow-smoke-2026-05-24-001`。
- 响应状态为 `HTTP/2 200`。
- 响应头包含 `content-security-policy`。
- CSP 保留 `connect-src 'none'`。

结论：

```text
本地修改 -> Git commit -> git push origin main -> Cloudflare 自动部署 -> 线上 curl 验证
```

这条主链路已跑通。

### 第二次验证

本段记录本身会触发第二次提交和部署。第二次验证使用：

```text
workflow-smoke-2026-05-24-003

### 第三次验证

本次结构迁移把站点输出目录从 `docs/` 改为 `src/`，第三次验证使用：

```text
workflow-smoke-2026-05-24-003
```

注意：推送本提交前，Cloudflare Pages 的 Build output directory 必须先改为 `src`。如果仍是 `docs`，线上不会发布 `src/index.html`。
```

如果线上首页能返回该探针，说明记录实测结果的提交也完成了部署闭环。

## 后续改进

短期只建议补三件事：

1. 把线上 URL 写入 README。
2. 增加一份最小手动验收清单。
3. 后续接入 Playwright 时再做真实浏览器 smoke test。

不要现在引入复杂 CI、框架迁移或自动化平台。当前项目核心价值是一个可靠的纯前端小工具，部署链路也应保持轻量。
