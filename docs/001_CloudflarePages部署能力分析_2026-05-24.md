# Cloudflare Pages 部署能力分析

日期：2026-05-24

## 背景

需要验证 `GPTSession2CPAandSub2API` 是否适合作为 GitHub 到 Cloudflare Pages 自动部署流程的试点项目。

该项目是一个浏览器本地运行的 ChatGPT session JSON 转换工具，输入和输出都包含敏感 token，因此部署判断不仅要看能不能上线，还要看上线后是否保持“不上传 token、不写入存储”的安全承诺。

## 结论

具备部署到 Cloudflare Pages 的能力，且非常适合作为第一个试点项目。

原因：

- 项目是纯静态页面。
- 入口文件已经存在：`src/index.html`。
- 静态资源相对路径正确：`./favicon.svg`。
- 没有 `package.json`、构建依赖、服务端入口或环境变量。
- 页面没有 `fetch()`、`XMLHttpRequest`、`localStorage`、`sessionStorage`、`indexedDB` 或 `sendBeacon`。
- Cloudflare Pages 官方支持无框架静态 HTML，未使用框架时可用 `exit 0` 作为 Build command，并把实际静态目录作为 Build output directory。

## 推荐 Cloudflare Pages 配置

```text
Framework preset: None
Production branch: main
Build command: exit 0
Build output directory: src
Root directory: 留空
Environment variables: 不需要
```

如果后续把仓库改成 monorepo，再设置 Root directory；当前不需要。

## 已做的试点准备

新增 `src/_headers`，由 Cloudflare Pages 在部署时解析为响应头。

目的：

- 禁止 iframe 嵌入，降低钓鱼页面包装风险。
- 禁止 MIME sniffing。
- 禁止 referrer 泄漏。
- 限制摄像头、麦克风、定位、支付、USB、串口等浏览器能力。
- 通过 `connect-src 'none'` 禁止页面发起网络请求，强化 token 不上传的核心承诺。

## 排查过程

1. 检查仓库文件，确认项目是纯静态文件，生产页面位于 `src/`，项目文档位于 `docs/`。
2. 检查 Git 状态，确认开始前工作区干净。
3. 阅读 `README.md`，确认项目定位是纯前端单页面工具。
4. 阅读 `src/index.html`，确认入口、资源引用和交互逻辑都在同一个静态 HTML 内。
5. 搜索潜在运行时依赖和外发能力：`fetch()`、`XMLHttpRequest`、本地存储、IndexedDB、sendBeacon、模块导入、服务端函数。
6. 检查是否存在 `package.json`、`wrangler.toml`、`_headers`、`_redirects`、独立 JS/TS 文件。
7. 查询 Cloudflare Pages 官方文档，确认无框架静态站点推荐 `exit 0` 和自定义 Build output directory，且 `_headers` 应放在输出目录。

## 风险与建议

### 风险 1：站点源码和项目文档混放

状态：已修正。

站点公开输出目录已经从 `docs/` 调整为 `src/`。这样 Cloudflare Pages 只发布 `src/index.html`、`src/favicon.svg` 和 `src/_headers`，项目分析文档继续保留在 `docs/`。

建议：

- Cloudflare Pages 的 Build output directory 必须改为 `src`。
- 后续不要再把生产页面放回 `docs/`。
- `docs/` 仍然不能写入真实 token、密钥、账号凭证或私有排查日志，因为 GitHub 仓库成员仍可看到这些内容。

### 风险 2：页面含内联 CSS 和内联 JS

为了不引入构建系统，当前 CSP 必须允许 `'unsafe-inline'`。

建议：

- 试点阶段接受该取舍。
- 如果后续要进一步收紧 CSP，再把 CSS/JS 拆成独立文件并使用 hash 或 nonce。

### 风险 3：GitHub CLI 授权状态

初次分析时本机 `gh auth status` 显示账号 token 无效；后续已经完成重新授权，并成功删除重建 GitHub 仓库、推送 main 分支。AI 后续可以继续用 GitHub CLI 接管仓库创建、提交推送、PR、workflow 和检查状态。

建议：

```bash
rtk gh auth login -h github.com
```

## 验证记录

- `rtk git status --short`：开始前工作区干净。
- `rtk rg --files`：确认项目文件很少，适合静态部署。
- `rtk rg` 搜索运行时依赖：未发现网络请求、本地存储或服务端入口。
- `rtk du -sh docs`：当前静态输出目录约 60K。
- `rtk xmllint --html --noout src/index.html`：不作为有效验收，因为该工具对 HTML5 语义标签、SVG 和内联 JavaScript 产生误报。

## 下一步试点步骤

1. 在 Cloudflare Dashboard 进入 Workers & Pages。
2. Create application。
3. 选择 Pages。
4. Import an existing Git repository。
5. 选择 `GPTSession2CPAandSub2API`。
6. 使用推荐配置：

```text
Build command: exit 0
Build output directory: src
Production branch: main
```

7. 首次部署完成后检查：

- 首页是否能打开。
- `favicon.svg` 是否加载。
- 粘贴示例 JSON 是否能转换。
- 复制和下载按钮是否可用。
- 响应头是否包含 `Content-Security-Policy`。
- 浏览器 Network 面板中转换过程是否没有外发请求。

## 官方依据

- Cloudflare Pages Build configuration: https://developers.cloudflare.com/pages/configuration/build-configuration/
- Cloudflare Pages Static HTML guide: https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
- Cloudflare Pages Git integration: https://developers.cloudflare.com/pages/get-started/git-integration/
- Cloudflare Pages Headers: https://developers.cloudflare.com/pages/configuration/headers/
