# GitHub 到 Vercel 和 Cloudflare Pages 的 AI 接管发布流程

日期：2026-05-24

## 结论

最优解不是找一个“万能 MCP”直接替代完整 DevOps，而是建立一个小而稳的闭环：

1. GitHub 是唯一代码与任务事实源。
2. Vercel 和 Cloudflare Pages 使用官方 GitHub 集成自动部署。
3. GitHub Actions 只负责质量门禁、状态汇总和兜底部署，不做复杂平台编排。
4. AI 通过 GitHub CLI、GitHub MCP、Vercel MCP、Cloudflare MCP 和项目内 workflow skill 接管开发、提交、PR、检查失败修复、日志分析和文档沉淀。

这套方案适合个人创业者：配置少、可观察、可回滚、能快速上线，同时不会做成大而全的平台。

## 一句话架构

本地 AI Agent 修改代码和文档，提交到 GitHub；GitHub 触发 CI；Vercel 和 Cloudflare Pages 通过 GitHub App 自动生成 Preview 和 Production 部署；AI 读取 GitHub Checks、平台部署状态和日志，失败就修复并继续提交，直到主链路闭环。

## 为什么不建议一开始用 GitHub Actions 手动部署两端

Vercel 和 Cloudflare Pages 都已经有成熟 GitHub 集成。对个人项目来说，直接使用平台 Git 集成更简单：

- 少维护两套部署脚本。
- Preview Deployment 天然绑定分支和 PR。
- Production Deployment 天然绑定默认分支。
- 回滚、环境变量、域名和部署日志由平台托管。
- AI 需要处理的是“开发和修复闭环”，不是重复造部署平台。

GitHub Actions 的最佳定位是质量门禁：

- 单元测试。
- 类型检查或静态检查。
- 构建检查。
- 轻量 smoke test。
- 汇总部署状态。

只有在平台 Git 集成不满足需求时，才启用 CLI 兜底部署。

## 必备工具边界

### 本地 CLI

- `gh`：管理 repo、issue、PR、secrets、workflow、checks。
- `git`：提交、分支、tag、回滚。
- `vercel`：兜底拉取配置、部署、查看日志。
- `wrangler`：Cloudflare Pages 兜底部署、查看项目配置。
- `rtk`：本地命令统一前缀，降低输出噪声和 token 消耗。

### 推荐 MCP

- GitHub MCP：让 AI 读取和修改 issue、PR、commit、branch、checks、workflow 结果。
- Vercel MCP：让 AI 查询项目、部署、日志、环境与平台状态。
- Cloudflare MCP：让 AI 查询 Pages/Workers 相关资源、日志、构建和账号上下文。
- 文档 MCP：用于查询官方文档，避免凭记忆使用过期参数。

注意：MCP 不能完全消除账号授权、组织权限、账单和首次 GitHub App 安装这些人工边界。MCP 负责可观测和自动化操作，账号信任边界仍应由人一次性配置。

### 推荐 skills

- `$plan`：需求和顶层方案。
- `$ralph` 或 `$autopilot`：单任务持续执行到验证完成。
- `$code-review`：合并前代码审查。
- `$security-review`：涉及密钥、认证、支付、用户数据时必须跑。
- `$visual-verdict`：前端页面上线前做截图和视觉验收。
- `$note`：把踩坑、项目约定和长期规则沉淀下来。

## 标准工作流

### 0. 一次性初始化

1. 本地确认 GitHub CLI 授权：

```bash
rtk gh auth status
```

2. 仓库必须包含：

```text
docs/
.github/workflows/
README.md
AGENTS.md 或等价项目约束
```

3. Vercel 控制台安装 GitHub 集成并绑定仓库。
4. Cloudflare Workers & Pages 控制台安装 GitHub 集成并绑定仓库。
5. 两个平台都设置：

- Production branch：`main`
- Preview branch：所有非 `main` 分支或 PR 分支
- Build command：项目真实构建命令
- Output directory：项目真实产物目录
- Environment variables：只放平台运行需要的变量

### 1. 开发入口

每个需求必须先落到 GitHub Issue 或 `docs/todolist.md`：

- 背景。
- 目标。
- 非目标。
- 验收标准。
- 风险。
- 需要同步的文档。

AI 开始开发前先读：

- `README.md`
- `AGENTS.md`
- `docs/`
- 相关源码和测试
- 当前 Git 状态

### 2. 分支策略

默认使用短分支：

```text
feat/<短任务名>
fix/<短问题名>
docs/<短文档名>
chore/<短维护名>
```

个人项目也建议保留 PR 流程，即使只有一个人维护。原因是 Vercel 和 Cloudflare Pages 的 Preview Deployment 会天然挂在 PR 上，AI 可以围绕这个预览链接做验证和修复。

紧急小修可以直推 `main`，但必须先通过本地质量门禁，并在提交信息中说明原因。

### 3. 每次修改的硬性闭环

每次 AI 修改必须完成：

1. 分析全局上下文，不只看局部文件。
2. 修改代码。
3. 同步文档。
4. 增加或更新测试。
5. 运行本地验证。
6. 提交到 Git。
7. 推送到 GitHub。
8. 等待 GitHub Checks 和平台部署结果。
9. 失败则读取日志，继续修复并再次提交。
10. 成功后记录踩坑或经验到 `docs/`。

### 4. GitHub Actions 质量门禁

建议只保留一个主 workflow：

```text
.github/workflows/quality-gate.yml
```

职责：

- checkout
- 安装依赖
- lint 或静态检查
- unit tests
- build
- 可选 smoke test

不要在质量门禁里写复杂业务判断。质量门禁只回答一个问题：这次提交是否有资格部署。

### 5. 部署主路径

主路径：

```text
push/PR -> GitHub -> Vercel GitHub App -> Vercel Preview/Production
push/PR -> GitHub -> Cloudflare Pages GitHub App -> Pages Preview/Production
```

AI 的职责：

- 用 `gh pr checks` 或 GitHub MCP 查询检查结果。
- 用 Vercel MCP/CLI 查询 Vercel 部署状态和日志。
- 用 Cloudflare MCP/Wrangler 查询 Cloudflare Pages 部署状态和日志。
- 将失败原因归因到源码、配置、环境变量或平台限制。
- 修改后重新提交。

### 6. 兜底部署路径

只有以下情况才使用 CLI 部署：

- 平台 GitHub App 暂时故障。
- 需要一次性验证平台配置。
- 需要调试构建产物。
- 迁移项目时需要临时并行验证。

Vercel 兜底：

```bash
rtk vercel pull --yes
rtk vercel deploy
rtk vercel deploy --prod
```

Cloudflare Pages 兜底：

```bash
rtk wrangler pages deploy <产物目录> --project-name <项目名>
```

兜底路径不能长期成为主路径，否则会增加密钥、日志、环境和部署状态的维护成本。

## AI 接管时的最小权限模型

### GitHub

AI 需要：

- 读写当前仓库。
- 创建分支。
- 创建/更新 PR。
- 读取 Actions logs 和 Checks。
- 设置 repo secrets 的权限只在初始化阶段开放，日常关闭或人工确认。

### Vercel

AI 需要：

- 读取项目和部署。
- 读取部署日志。
- 可选：触发重新部署。
- 修改域名、账单、团队、生产环境变量需要人工确认。

### Cloudflare

AI 需要：

- 读取 Pages 项目和部署。
- 读取构建日志。
- 可选：触发重新部署。
- 修改 DNS、生产环境变量、账号级权限、账单需要人工确认。

## 文档规范

所有项目文档放在根目录 `docs/`。

命名：

```text
序号_中文文件名_日期.md
```

示例：

```text
001_GitHub到Vercel和CloudflarePages_AI接管发布流程_2026-05-24.md
002_Vercel部署踩坑记录_2026-05-24.md
003_CloudflarePages环境变量踩坑记录_2026-05-24.md
```

踩坑记录必须包含：

- 背景。
- 现象。
- 原因。
- 排查过程。
- 解决方案。
- 验证方式。
- 后续建议。

## 提交规则

每次修改都必须提交。

提交信息采用 Lore Commit Protocol：

```text
<为什么要做这个改动>

<背景、约束和方案说明>

Constraint: <约束>
Rejected: <被拒绝方案> | <原因>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Tested: <验证>
Not-tested: <未验证>
```

## AI 执行检查清单

AI 每轮完成前必须确认：

- 是否理解了项目全局结构。
- 是否只围绕核心功能修改。
- 是否避免过度设计。
- 是否同步了文档。
- 是否增加或更新了测试。
- 是否运行了本地验证。
- 是否提交了 Git。
- 是否推送到了 GitHub。
- 是否检查了 CI。
- 是否检查了 Vercel 部署。
- 是否检查了 Cloudflare Pages 部署。
- 是否把踩坑记录写入 `docs/`。

## 最小可执行落地顺序

第一阶段：建立仓库契约。

1. 补齐 `README.md`、`AGENTS.md`、`docs/`、`.github/workflows/quality-gate.yml`。
2. 统一质量门禁命令。
3. 约定提交协议和文档协议。

第二阶段：接入平台。

1. GitHub 连接 Vercel。
2. GitHub 连接 Cloudflare Pages。
3. 配置 Preview 和 Production branch。
4. 跑一次 PR Preview。
5. 合并到 `main` 跑一次 Production。

第三阶段：AI 闭环。

1. AI 从 issue 或 docs/todolist.md 接任务。
2. AI 修改代码、测试、文档。
3. AI 提交并推送。
4. AI 创建 PR。
5. AI 读取 CI 和部署状态。
6. AI 修复失败直到通过。
7. AI 合并或等待人工合并。
8. AI 写入踩坑记录。

## 常见踩坑记录

### 背景

同一个项目同时部署到 Vercel 和 Cloudflare Pages，容易因为平台构建环境、输出目录、环境变量名称和 Node/包管理器版本不同而出现一边成功一边失败。

### 原因

两个平台虽然都支持 GitHub 自动部署，但构建容器、默认环境变量、缓存策略、构建产物目录识别和日志格式不完全一致。

### 排查过程

1. 先看 GitHub Checks，确认代码质量门禁是否失败。
2. 如果 GitHub Checks 通过，再分别看 Vercel 和 Cloudflare Pages 部署日志。
3. 对比两端 build command、output directory、环境变量和运行时版本。
4. 本地执行同一条构建命令复现。
5. 修复后提交，等待两个平台重新部署。

### 解决方案

把构建命令和产物目录写入文档，并尽量让两端使用同一套命令。平台差异不要散落在代码里，必须集中记录在 `docs/`。

### 建议

不要让 AI 每次凭日志临时猜配置。项目必须有一份稳定的部署说明，AI 每次部署问题都先读取这份说明，再看平台日志。

## 官方资料

- GitHub CLI manual: https://cli.github.com/manual/
- GitHub Actions documentation: https://docs.github.com/actions
- GitHub Actions secrets: https://docs.github.com/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions
- GitHub Actions environments: https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment
- Vercel Git deployments: https://vercel.com/docs/deployments/git
- Vercel CLI: https://vercel.com/docs/cli
- Vercel MCP: https://vercel.com/docs/agent-resources/vercel-mcp
- Cloudflare Pages Git integration: https://developers.cloudflare.com/pages/configuration/git-integration/
- Cloudflare Pages direct upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Wrangler Pages commands: https://developers.cloudflare.com/workers/wrangler/commands/pages/
- Cloudflare MCP servers: https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/
