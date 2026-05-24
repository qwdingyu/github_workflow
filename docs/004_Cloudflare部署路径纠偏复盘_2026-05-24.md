# Cloudflare 部署路径纠偏复盘

日期：2026-05-24

## 背景

项目已经可以通过以下地址访问：

```text
https://gptsession2cpaandsub2api.mailforwdy.workers.dev/
```

之前我们按“Cloudflare Pages 静态站点”思路分析，是因为项目本质是纯静态 HTML 工具，Pages 确实能部署。但通过 Cloudflare API 实际查询后确认：当前线上地址对应的是 Cloudflare Workers 脚本，而不是 Pages project。

## 纠偏结论

当前最佳实践不是继续强推 Pages，而是保留现有 Worker，并用 Cloudflare Workers Builds 接 GitHub 自动部署。

主线应改为：

```text
src/ 静态资源
wrangler.jsonc 定义 Worker 和 assets
GitHub main 保存事实源
Cloudflare Workers Builds 监听 GitHub main
workers.dev 自动更新
```

## 为什么之前会混淆

### 原因 1：项目形态像 Pages

项目没有后端，没有构建步骤，只有一个 HTML 页面和 favicon。从静态站点角度看，Pages 是合理候选。

### 原因 2：域名是 workers.dev

实际线上地址是：

```text
*.workers.dev
```

这通常对应 Workers，而不是 Pages 默认的：

```text
*.pages.dev
```

### 原因 3：没有先查 Cloudflare API

后续用 API 查询得到：

- Pages project 列表为空。
- Workers scripts 中存在 `gptsession2cpaandsub2api`。

这说明当前生产部署实际在 Workers。

## 正确的仓库结构

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
- `docs/`：项目知识库、分析、流程、踩坑。
- `wrangler.jsonc`：Cloudflare Workers 部署配置。

## 本次结构优化

已完成：

1. 将 `docs/index.html` 迁移为 `src/index.html`。
2. 将 `docs/favicon.svg` 迁移为 `src/favicon.svg`。
3. 将 `docs/_headers` 迁移为 `src/_headers`。
4. 新增 `wrangler.jsonc`，Worker 名称固定为 `gptsession2cpaandsub2api`。
5. 新增 `Codex auth.json` 输出格式。
6. 保留 CSP 的 `connect-src 'none'` 安全边界。

## 当前 canonical 文档

后续以此文档为准：

```text
docs/005_CloudflareWorkers自动部署最佳实践_2026-05-24.md
```

旧的 Pages 文档保留为试点过程记录，但不再作为当前生产部署主线。

## 踩坑记录

### 背景

项目先跑通了一个 Cloudflare 线上地址，然后围绕 Pages 自动部署做了流程设计。

### 原因

没有先用 Cloudflare API 区分当前线上资源到底是 Pages project 还是 Workers script。

### 排查过程

1. 使用 token 验证 Cloudflare API 可用。
2. 查询 Pages projects，结果为空。
3. 查询 Workers scripts，发现 `gptsession2cpaandsub2api`。
4. 确认当前 URL 使用 `workers.dev` 域名。
5. 重新检索 Cloudflare Workers Builds 官方文档。

### 解决方案

放弃把当前生产链路强行迁移到 Pages。保留 Worker，并使用 Workers Builds 对接 GitHub 自动部署。

### 建议

后续遇到 Cloudflare 部署问题，必须先判断产品类型：

```text
Pages: *.pages.dev，走 Pages project API
Workers: *.workers.dev，走 Workers scripts / Workers Builds
```

不要只根据项目是不是静态文件来决定产品线。

## 官方依据

- Cloudflare Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Cloudflare Workers GitHub integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
