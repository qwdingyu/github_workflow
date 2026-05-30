# eForge Monorepo

> Cloudflare Workers 工具链与模板 — 面向个人开发者的多项目批量生产和部署标准化方案

---

## ⚠️ 硬性规则：必须使用 pnpm

**本仓库的依赖安装只能使用 `pnpm`**，`npm install` 和 `yarn install` 已被 `preinstall` 脚本硬性阻断。

```bash
# ✅ 正确
pnpm install

# ❌ 以下命令会报错退出
npm install
yarn install
```

> **为什么？** 本仓库曾因误用 npm 导致 `packages/cf-core/node_modules/`（约 5000+ 文件）被提交到 Git 历史中，仓库体积膨胀 13MB。虽已通过 `git filter-repo` 彻底清除，但为了杜绝此类问题再次发生，pnpn 依赖管理作为**铁律**写入项目规范（详见 `docs/600_铁律.txt` 第 18 条）。
>
> pnpm 通过硬链接共享依赖，在 Monorepo 场景下避免 node_modules 重复下载和体积膨胀，是行业公认的最佳实践。

---

## 快速开始

```bash
# 1. 安装依赖（仅此一步）
pnpm install

# 2. 构建共享内核
pnpm build

# 3. 运行测试
pnpm test

# 4. 类型检查
pnpm type-check
```

---

## 项目结构

```
├── packages/
│   └── cf-core/          # 共享内核 — 所有项目共用的工具库
├── templates/
│   ├── cf-api/           # API 项目模板（Workers 模式）
│   ├── cf-form/          # 表单项目模板（Workers + Pages 混合）
│   ├── cf-ai-proxy/      # AI 代理项目模板
│   └── cf-static/        # 纯静态站点模板（Pages 模式）
├── dtc/                  # DTC 工作台 — 后台管理应用
├── eshop/                # 发卡平台（独立项目）
├── scripts/              # 脚手架与自动化脚本
├── docs/                 # 项目文档索引（详见 docs/README.md）
└── pnpm-lock.yaml        # 锁定文件 — 必须提交到仓库
```

---

## 核心命令

| 命令 | 说明 |
|------|------|
| `pnpm build` | 构建 cf-core 共享内核 |
| `pnpm test` | 运行 cf-core 单元测试 |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm lint` | 代码规范检查 |
| `pnpm clean` | 清理构建产物 |

---

## 文档索引

详细文档体系请参见 [`docs/README.md`](docs/README.md)。

---

## 技术栈

| 技术 | 用途 |
|------|------|
| TypeScript | 核心语言 |
| pnpm | 包管理器（强制） |
| esbuild | 构建工具 |
| Vitest | 单元测试 |
| Cloudflare Workers / Pages | 部署平台 |
