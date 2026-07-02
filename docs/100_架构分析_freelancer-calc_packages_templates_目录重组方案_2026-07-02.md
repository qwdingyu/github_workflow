# 架构分析：freelancer-calc / packages / templates 目录重组方案

> 日期：2026-07-02
> 角色：架构师 + 产品经理 + 项目总监 + 行业顾问
> 分析范围：`freelancer-calc/`、`packages/`、`templates/`
> 状态：纯分析，零代码变更

---



## 一、当前状态全景

### 1.1 仓库根目录结构

```
github_workflow/
├── freelancer-calc/       ← 独立产品（npm 管理，非 pnpm）
├── packages/              ← pnpm workspace 共享包
│   ├── mach-calculators/  ← 数控报价计算器系统
│   └── mach-formulas/     ← 数控加工公式库
├── templates/             ← 9 个 git submodule + 共享部署脚本
│   ├── cf-api/            ← submodule
│   ├── cf-calculators/    ← submodule
│   ├── cf-form/           ← submodule
│   ├── cf-guardian/       ← submodule
│   ├── cf-seo/            ← submodule
│   ├── cf-seo-archive/    ← submodule
│   ├── cf-shop/           ← submodule（最成熟产品）
│   ├── cf-static/         ← submodule
│   ├── cf-tools/          ← submodule
│   ├── .deploy/           ← 共享部署脚本
│   └── docs/              ← 模板文档
├── dtc/                   ← DTC 工作台
├── docs/                  ← 根文档（含 arch/ cf-deploy/ payment/ seo-strategy/）
└── pnpm-workspace.yaml    ← 声明 packages/* + templates/* + dtc
```

### 1.2 pnpm workspace 配置

```yaml
packages:
  - "packages/*"
  - "templates/*"
  - "dtc"
```

### 1.3 Git Submodules（9 个）

```
templates/cf-api          → https://github.com/qwdingyu/cf-api.git
templates/cf-calculators  → https://github.com/qwdingyu/cf-calculators.git
templates/cf-form         → https://github.com/qwdingyu/cf-form.git
templates/cf-guardian     → https://github.com/qwdingyu/cf-guardian.git
templates/cf-seo          → https://github.com/qwdingyu/cf-seo.git
templates/cf-seo-archive  → https://github.com/qwdingyu/cf-seo-archive.git
templates/cf-static       → https://github.com/qwdingyu/cf-static.git
templates/cf-tools        → https://github.com/qwdingyu/cf-tools.git
templates/cf-shop         → https://github.com/qwdingyu/cf-shop.git
```

---



## 二、核心矛盾诊断

### 矛盾 1：templates/ 既是 workspace 成员又是独立 submodule

**问题**：
- `pnpm-workspace.yaml` 声明 `templates/*` 为 workspace 成员，意味着它们应共享依赖
- 但 9 个模板是独立的 git submodule，各自有独立的仓库、CI/CD、部署流程
- 导致依赖版本分裂：
  - `cf-api` 用 `drizzle-orm: ^0.45.2`
  - `cf-guardian` 用 `drizzle-orm: ^0.39.0`
  - `cf-shop` 有自己独立的 `frontend/` 子包和 `node_modules/`

**根因**：
- 这些模板是**已部署的独立产品**，天然需要独立管理
- 但 workspace 的初衷是"开发者体验"——`pnpm install` 一次装完所有依赖
- **两者并不冲突**，真正的问题是缺乏统一的依赖版本策略

**行业对标**：
- Turborepo/Nx 的 monorepo 模式中把独立微服务/应用放在 workspace 下统一管理是常见做法（参考 Vercel official examples）
- Git submodule + workspace 共存有先例，关键是划清职责：
  - workspace = **开发阶段**的一键依赖管理
  - submodule = **部署阶段**的独立发布单元
- 依赖版本分裂应该用 `pnpm overrides` 或定期 `pnpm -r update` 统一，而非取消 workspace

### 矛盾 2：freelancer-calc 是孤儿产品

**问题**：
- 结构上跟 `templates/cf-static` 几乎一样（纯静态 + serve + Cloudflare Pages）
- 但它有自己的 `.git`、`.deploy`、`.credentials`、`node_modules`
- 不在 `pnpm-workspace.yaml` 里，用的是 npm（有 `package-lock.json`）
- 挂在根目录下，跟 monorepo 毫无关系

**根因**：
- 这是一个**已部署的独立产品**，不是模板也不是共享包
- 它应该要么独立成仓库，要么放到 `templates/` 下作为产品实例

**行业对标**：
- 独立产品应有独立仓库（GitHub 的最佳实践）
- 如果暂不独立，至少应放在明确的产品目录下，而非跟 monorepo 配置混在一起

### 矛盾 3：packages/ 里放的是领域代码，不是共享内核

**问题**：
- `mach-formulas` 和 `mach-calculators` 是**数控加工领域**的公式库
- 当前只被 `templates/cf-calculators` 引用（通过 `workspace:*` 协议依赖）
- 但 `cf-calculators` 是独立 submodule，跨仓库引用 workspace 协议依赖**在构建/发布时存在复杂度**
- `packages/` 的历史设计意图是放所有模板共用的共享内核（如已删除的 `cf-core`），现在放的是单模板依赖的领域代码

**根因**：
- 真正的问题不是"领域代码不该放 packages/"，而是 **domain libraries 的发布策略和生命周期未定义**：
  - 如果 mach-* 有独立版本化、独立测试、多产品复用的价值 → 就应该留在 packages/ 并发布到 npm
  - 如果 mach-* 只是 cf-calculators 的纯内部实现细节 → 迁入 cf-calculators 内部更合理
- 当前 workspace 协议（`workspace:*`）跨 submodule 边界引用时，更新/发布流程不清晰

**行业对标**：
- **领域库放在 packages/ 是 monorepo 的常见模式**（Nx 官方示例中有大量 domain-specific libraries 放在 libs/ 下）
- 决定去留的核心判断标准是**复用潜力 + 独立版本化价值**，而非"是否基础设施"
- 关键约束：如果跨 submodule 边界引用，应改用 npm 已发布版本而非 `workspace:*`

### 矛盾 4：部署脚本三重冗余

**问题**：
- `templates/.deploy/` — 根级共享
- 每个模板子目录 `.deploy/` — 独立副本（9 份）
- `freelancer-calc/.deploy/` — 又一份副本

**根因**：
- 没有统一的部署脚本管理策略
- 每个项目都复制了一份部署脚本，导致维护成本极高
- **但在 git submodule 场景下，物理复制有一定合理性**：每个 submodule 是独立仓库，部署到不同的 Cloudflare Workers/Pages，需要不同的 `wrangler.toml` 和绑定配置

**行业对标**：
- **GitHub Actions reusable workflows** 是共享部署逻辑的行业标准做法——在工作流层面复用，而非文件系统层面
- 每个 submodule 的独立 `.deploy/` 存放本项目的环境配置（域名、binding、secrets 名称），共同逻辑通过 GHA 工作流引用共享
- `templates/.deploy/00-init-project.sh` 这类脚手架脚本适合作为**知识模板**（供新项目复制后修改），不适合作为运行时依赖

---



## 三、目录定位分析

### 3.1 freelancer-calc/ 定位

**当前角色**：独立部署的静态站点产品
**正确角色**：应该是 `templates/` 下的一个产品实例，或独立仓库
**建议**：
- 方案 A：迁入 `templates/cf-calculators/` 作为其一个工具页面（如果是同类产品）
- 方案 B：独立成仓库 `freelancer-calc`，从 monorepo 中移除
- 方案 C：保留在根目录，但重命名为 `products/freelancer-calc/`，明确其产品属性

### 3.2 packages/ 定位

**当前角色**：混合了领域代码和潜在共享内核
**正确角色**：应明确领域库的发布策略，而非简单地"只能放基础设施"
**建议**：
- **先决策 mach-* 的发布策略**：是否有独立版本化、独立测试、多产品复用的价值？
  - 有 → 保留在 `packages/`，发布到 npm，各模板改用 npm 已发布版本
  - 无 → 迁入 `templates/cf-calculators/lib/` 作为内部实现
- `packages/` 的门槛不是"必须基础设施"，而是**至少有 2 个消费者或明确的独立发布价值**
- 未来如重建 cf-core 之类的共享内核，应放在 `packages/` 下独立目录，不冲突

### 3.3 templates/ 定位

**当前角色**：git submodules 集合 + pnpm workspace 成员
**正确角色**：产品模板/实例集合，每个独立运营
**建议**：
- **保留 `pnpm-workspace.yaml` 中的 `templates/*`**，确保 `pnpm install` 一次装完所有依赖的开发者体验
- 但应建立依赖版本统一策略：通过 `pnpm overrides` 或定期 `pnpm -r update` 对齐关键依赖版本（drizzle-orm、hono 等）
- git submodule 保持独立仓库和 CI/CD，明确职责划分：
  - workspace = 开发阶段的一键依赖管理
  - submodule = 部署阶段的独立发布单元

---



## 四、重组方案对比

### 方案 A：最小改动（推荐）

**核心思想**：保持现有结构，但明确边界和职责

| 目录 | 操作 | 说明 |
|------|------|------|
| `freelancer-calc/` | 迁入 `templates/cf-freelancer/` | 作为新模板，结构与 cf-static 对齐 |
| `packages/mach-*` | 先决策发布策略 | 有独立价值 → 保留 + 发布 npm / 无 → 迁入 cf-calculators/lib/ |
| `templates/.deploy/` | 保留物理副本，共享逻辑迁移到 GHA reusable workflows | symlink 跨 submodule 边界不可行 |
| `pnpm-workspace.yaml` | 保留 `templates/*` + 统一依赖版本策略 | 保留一键 install 的 DX，用 overrides 对齐关键依赖 |

**优点**：
- 改动最小，风险最低
- 保留 `pnpm install` 一键安装的开发者体验
- 部署脚本共享方式符合 submodule 架构

**缺点**：
- 部署脚本仍有物理冗余（可用脚手架生成保证一致性）
- 依赖版本分裂需要持续关注（建议季度性 pnpm -r update）

### 方案 B：激进重构

**核心思想**：彻底按 monorepo 最佳实践重构

| 目录 | 操作 | 说明 |
|------|------|------|
| `freelancer-calc/` | 独立成仓库或删除 | 清理根目录 |
| `packages/` | 只保留真正的共享内核 | 删除 mach-* |
| `templates/` | 全部迁入 packages/ 或独立仓库 | 取消 submodule |
| `pnpm-workspace.yaml` | 精简为真正的共享包 | 只含 cf-core 等 |

**优点**：
- 结构最清晰，符合 monorepo 最佳实践
- 依赖管理最干净

**缺点**：
- 改动巨大，风险高
- 需要重新建立所有 CI/CD 流程
- 与现有文档和流程冲突较大

### 方案 C：混合模式（折中）

**核心思想**：区分"产品"和"模板"

```
github_workflow/
├── products/              ← 已部署的独立产品
│   ├── freelancer-calc/   ← 从根迁入
│   ├── cf-shop/           ← 从 templates 迁入（最成熟）
│   └── ...
├── templates/             ← 可复用的项目模板
│   ├── cf-api/
│   ├── cf-form/
│   ├── cf-static/
│   └── ...
├── packages/              ← 共享内核
│   └── cf-core/
└── dtc/
```

**优点**：
- 概念清晰：产品 vs 模板
- 部署脚本可以统一管理在 products/ 下
- templates/ 保持轻量，只含脚手架代码

**缺点**：
- 需要重新梳理哪些是产品、哪些是模板
- cf-shop 等已成熟产品可能需要特殊处理

---



## 五、行业标准对照

### 5.1 Monorepo 最佳实践（Turborepo/Nx）

| 实践 | 当前状态 | 符合度 |
|------|----------|--------|
| packages/ 职责清晰 | ⚠️ mach-* 的发布策略未定义（不是"错"，是"未决策"） | 中 |
| 每个 package 独立版本 | ⚠️ mach-* 有版本，但引用方是 submodule，跨仓库引用需 npm publish | 中 |
| workspace 协议依赖 | ✅ `@eforge/mach-calculators（独立 npm 包）` 在开发阶段正常工作 | 高 |
| 统一构建/测试流程 | ⚠️ 各模板独立 CI，无统一 orchestration（对独立产品来说这是合理选择） | 中 |

> **注**：Turborepo/Nx 模式假定所有项目在同一仓库统一构建——本项目是"独立产品集合"模式，两者目标不同，不应直接套用同一套评估标准。

### 5.2 Git Submodule 最佳实践

| 实践 | 当前状态 | 符合度 |
|------|----------|--------|
| 只读引用 | ⚠️ 本地有修改，但未 push | 中 |
| workspace + submodule 共存 | ⚠️ 可以共存，但需明确职责划分和依赖版本策略 | 中 |
| 独立 CI/CD | ✅ 各模板有独立 workflows | 高 |

> **注**："不混用 workspace 和 submodule"不是行业共识——两者有不同职责（开发 vs 发布），可以共存且互不冲突。

### 5.3 产品架构最佳实践

| 实践 | 当前状态 | 符合度 |
|------|----------|--------|
| 独立产品独立仓库 | ❌ freelancer-calc 挂在根目录 | 低 |
| 部署脚本统一策略 | ⚠️ 三重冗余，但 submodule 场景下一定程度的复制是合理的 | 中 |
| 文档与代码同仓 | ✅ 各产品有 docs/ | 高 |

---



## 六、推荐路线图

### Phase 1：止血（1-2 天）

1. **明确 freelancer-calc 归属**：迁入 `templates/cf-freelancer/` 或独立仓库
2. **决策 packages/mach-* 发布策略**：定义是否独立版本化并发布 npm，而非匆忙迁移
3. **统一关键依赖版本**：在根 `package.json` 中增加 `pnpm.overrides` 对齐 drizzle-orm、hono 等核心依赖的版本号
4. **清理僵尸项目**：评估 cf-seo-archive 等无维护项目是否需要删除或归档

### Phase 2：规范（1 周）

1. **建立部署脚本共享策略**：将核心部署逻辑提取为 GitHub Actions reusable workflows，各模板的 `.deploy/` 保留环境配置
2. **建立 templates/ 开发规范**：新模板必须通过脚手架创建，禁止从零开始
3. **清理重复文档**：合并 templates/docs/ 和根 docs/ 中的重复内容

### Phase 3：优化（2-4 周）

1. **评估 cf-shop 独立化**：如果 cf-shop 是成熟产品，考虑独立仓库
2. **建立产品 vs 模板分类**：明确哪些是产品、哪些是模板
3. **建立依赖版本季度审查机制**：每季度运行 `pnpm -r update`，检查并对齐关键依赖版本

---



## 七、风险与注意事项

### 7.1 高风险操作

- **移动 cf-shop**：它有 20 份审查文档、17 个脚本、独立的 frontend/，移动成本高
- **删除 submodule**：会丢失 Git 历史关联，需要确保所有修改已 push

### 7.2 依赖关系陷阱

- `mach-calculators` 依赖 `@eforge/mach-calculators（独立 npm 包）`
- 如果迁出 monorepo，需要改为 npm 依赖或 git 依赖

### 7.3 部署脚本兼容性

- 各模板的 `.deploy/` 可能有定制化修改
- 提取 GHA reusable workflows 前需要对各模板的部署脚本做 diff 分析，识别可共享的逻辑 vs 模板特有的配置

---



## 八、结论

### 8.1 核心问题一句话总结

**一个 monorepo 试图同时管理：独立产品（freelancer-calc）、领域库（mach-*）、独立 submodule（templates/），导致职责边界模糊、发布策略未定义、维护成本高于必要水平。**

### 8.2  immediate 行动（本周）

1. **决策 freelancer-calc 归属**：产品 or 模板？
2. **决策 packages/mach-* 的生命周期**：独立发布 or 内部实现？
3. **统一关键依赖版本**：通过 `pnpm.overrides` 对齐核心依赖版本

### 8.3 长期目标

建立一个**职责清晰但不牺牲开发体验**的架构：
- `packages/` = 有独立版本化价值的共享库（可以是基础设施，也可以是领域库）
- `templates/` = 独立部署的产品集合，保留 submodule 独立性，通过 workspace 享受一键安装的 DX
- 部署共享通过 **GitHub Actions reusable workflows** 实现，而非文件系统层面的共享

---



## 九、附录

### 9.1 关键文件清单

| 文件 | 作用 | 问题 |
|------|------|------|
| `pnpm-workspace.yaml` | workspace 声明 | 包容 templates/* 但缺少依赖版本统一策略 |
| `package.json` | 根 package | 有 `drizzle-zod` 依赖，但无明确用途 |
| `.gitmodules` | submodule 配置 | 9 个 submodule 管理复杂 |
| `docs/ARCHITECTURE_ENFORCEMENT.md` | 架构规则 | 针对已删除的 cf-core，需更新 |
| `docs/README.md` | 文档索引 | 引用不存在的路径（eshop/xtools/vcode） |

### 9.2 未使用的配置

- `docs/dev_info/z-pay支付开发文档.txt` — 疑似遗留文件
- `docs/misc/001_临时.txt` — 临时文件
- `templates/cf-seo-archive/` — 只有 JS 脚本，无完整项目结构

### 9.3 数据来源

本分析基于以下真实文件：
- `/Users/dingyuwang/0-X/github_workflow/package.json`
- `/Users/dingyuwang/0-X/github_workflow/pnpm-workspace.yaml`
- `/Users/dingyuwang/0-X/github_workflow/.gitmodules`
- `/Users/dingyuwang/0-X/github_workflow/freelancer-calc/package.json`
- `/Users/dingyuwang/0-X/github_workflow//Users/dingyuwang/0-X/2-node/mach-calculators/package.json`
- `/Users/dingyuwang/0-X/github_workflow//Users/dingyuwang/0-X/2-node/mach-calculators/package.json`
- 各 templates/*/package.json
- `docs/ARCHITECTURE_ENFORCEMENT.md`
- `docs/README.md`

---



## 十、下一步建议

在做出任何代码变更前，建议：

1. **团队对齐**：确认方案 A/B/C 的倾向
2. **风险评估**：cf-shop 等成熟产品的移动成本
3. **渐进执行**：从 Phase 1 开始，每个 Phase 验证通过后再进入下一 Phase
4. **文档同步**：任何结构变更必须同步更新 `docs/README.md` 和 `ARCHITECTURE_ENFORCEMENT.md`
5. **开发者体验优先**：任何结构变更都必须评估对日常开发工作流的影响（`pnpm install` 一键装依赖、跨模板调试等），避免为结构纯度牺牲 DX

---

> **⚠️ 本文档版本记录**：
> 2026-07-02 v2 — 修正 v1 多处争议性处方案：
> - 矛盾1：保留 workspace（非移除），增加依赖版本统一策略
> - 矛盾3：领域代码放 packages/ 是合理选择，取决于发布策略
> - 矛盾4：部署脚本共享改为 GHA reusable workflows（symlink 在 submodule 场景下不可行）
> - 方案 A：去除"移除 workspace"和"symlink 部署脚本"的建议
> - 新增开发者体验（DX）作为架构决策的权重因子
