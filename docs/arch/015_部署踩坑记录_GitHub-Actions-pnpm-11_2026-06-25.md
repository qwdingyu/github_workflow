# 015_部署踩坑记录_GitHub-Actions-pnpm-11_2026-06-25.md

# 部署踩坑记录：GitHub Actions pnpm 11.5.2 兼容性与构建脚本忽略问题

> 日期：2026-06-25
> 项目：github_workflow（eForge Monorepo 根仓库）
> 影响范围：`.github/workflows/architecture-check.yml`、`.github/workflows/publish.yml`、`pnpm-workspace.yaml`
> 问题：pnpm 11.5.2 在 CI 中强制忽略依赖构建脚本，导致 `pnpm install --frozen-lockfile` 失败

---

## 一、部署结果

### 已完成

| 步骤 | 状态 | 详情 |
|------|------|------|
| 识别 CI 失败根因 | ✅ | pnpm/action-setup@v4 要求显式版本 + pnpm 11.5.2 要求 Node >= 22.13 + allowBuilds 配置无效 |
| 升级 Node.js 版本 | ✅ | `node-version` 从 20 改为 22 |
| 修复 pnpm-workspace.yaml | ✅ | `allowBuilds` 从占位符文本改为有效布尔值 `true` |
| 推送修复到 GitHub | ✅ | commit `2d5cccd` 已推送到 `main` 分支 |
| 验证 CI 通过 | ✅ | Workflow run `28143080717` 结论为 `success` |

### 当前状态

- ✅ `architecture-check.yml`：pnpm 11.5.2 + Node 22 + allowBuilds 配置正确，CI 通过
- ✅ `publish.yml`：两处 pnpm 安装步骤均已修复
- ✅ `pnpm-workspace.yaml`：`allowBuilds` 配置有效
- ❌ 之前 6 次 CI 失败（run `28142744701` 至 `28142977468`）均与此问题相关

---

## 二、问题 1：pnpm/action-setup@v4 要求显式指定 pnpm 版本

### 现象

GitHub Actions 报错：

```
No pnpm version is specified
```

### 根因

`pnpm/action-setup@v4` 在近期更新后，要求必须显式指定 `version` 参数，不再允许省略。

原始配置（commit `3e284f1`）：

```yaml
- name: 安装 pnpm
  uses: pnpm/action-setup@v4
```

### 修复

在两个 workflow 文件中为 `pnpm/action-setup@v4` 添加 `version: 11.5.2`：

```yaml
- name: 安装 pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 11.5.2
```

涉及文件：
- `.github/workflows/architecture-check.yml`
- `.github/workflows/publish.yml`（两处）

---

## 三、问题 2：pnpm 11.5.2 要求 Node.js >= 22.13

### 现象

指定 pnpm 版本为 11.5.2 后，CI 报错：

```
Node.js v20.20.2
Error: warn: This version of pnpm requires at least Node.js v22.13
warn: The current version of Node.js is v20.20.2
warn: Visit https://r.pnpm.io/comp to see the list of past pnpm versions with respective Node.js version support.
node:internal/modules/cjs/loader:1031
      throw new ERR_UNKNOWN_BUILTIN_MODULE(request);
            ^

Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
    at Module._load (node:internal/modules/cjs/loader:1031:13)
    ...
    at ../store/index/lib/index.js (file:///home/runner/setup-pnpm/node_modules/.pnpm/pnpm@11.5.2/node_modules/pnpm/dist/pnpm.mjs:55051:25)
```

Workflow run：`28142744701`

### 根因

pnpm 11.5.2 内部依赖 `node:sqlite` 模块，该模块在 Node.js 20 中不存在，需要 Node.js >= 22.13。

原始配置使用 `node-version: 20`：

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
```

### 修复

将两个 workflow 文件中的 `node-version` 从 20 改为 22：

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
```

涉及文件：
- `.github/workflows/architecture-check.yml`
- `.github/workflows/publish.yml`

---

## 四、问题 3：pnpm 11.5.2 强制忽略依赖构建脚本（核心问题）

### 现象

Node.js 升级到 22 后，`pnpm install --frozen-lockfile` 报错并退出：

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5, esbuild@0.27.3, sharp@0.34.5, workerd@1.20260526.1

Run "pnpm approve-builds" to pick which packages should be allowed to run scripts.

##[error]Process completed with exit code 1.
```

失败的 workflow runs：
- `28142808203`
- `28142849340`
- `28142907336`
- `28142944391`
- `28142977468`
- `28142880697`

### 根因

`pnpm-workspace.yaml` 中的 `allowBuilds` 配置使用了占位符文本，不是有效布尔值：

```yaml
# 错误配置（commit 85e967a 引入，commit 3e284f1 保留）
allowBuilds:
  esbuild: set this to true or false
  sharp: set this to true or false
  workerd: set this to true or false
```

pnpm 11+ 严格执行 `allowBuilds` 配置校验。当值为非布尔文本时，pnpm 无法识别为允许状态，默认忽略所有依赖构建脚本，导致安装失败。

**为什么之前能正常工作？**

在 commit `3e284f1` 及之前，CI 使用 `pnpm/action-setup@v4` 且未指定版本，GitHub runner 默认安装的 pnpm 版本（9.x 或更早）对 `allowBuilds` 的校验较为宽松，或者该配置项的默认行为不同，因此占位符文本未触发错误。

当显式指定 pnpm 11.5.2 后，新版 pnpm 严格执行配置校验，暴露了 `pnpm-workspace.yaml` 中的无效配置。

---

## 五、错误修复尝试与失败原因

在找到正确修复方案前，共尝试了 5 种错误方案，全部失败：

### 尝试 1：`pnpm approve-builds`

```yaml
- name: 安装依赖
  run: |
    pnpm approve-builds
    pnpm install --frozen-lockfile
```

**结果**：

```
There are no packages awaiting approval
```

**失败原因**：`approve-builds` 用于审批 lockfile 中标记为待批准的包，但我们的问题是 workspace 配置校验失败，不是审批状态问题。该命令无法绕过配置校验。

### 尝试 2：`pnpm install --no-ignore-builds`

```yaml
- run: pnpm install --frozen-lockfile --no-ignore-builds
```

**结果**：

```
[ERROR] Unknown option: 'ignore-builds'
Did you mean 'ignore-scripts'? Use "--config.unknown=value" to force an unknown option.
```

**失败原因**：pnpm 11 没有 `--no-ignore-builds` 参数。该参数名可能是其他包管理器或旧版本的选项。

### 尝试 3：`pnpm approve-builds esbuild sharp workerd`

```yaml
- name: 安装依赖
  run: |
    pnpm approve-builds esbuild sharp workerd
    pnpm install --frozen-lockfile
```

**结果**：

```
There are no packages awaiting approval
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5, esbuild@0.27.3, sharp@0.34.5, workerd@1.20260526.1
```

**失败原因**：与尝试 1 相同，`approve-builds` 解决的是审批状态问题，不是配置校验问题。

### 尝试 4：`pnpm config set ignore-scripts false`

```yaml
- name: 安装依赖
  run: |
    pnpm config set ignore-scripts false
    pnpm install --frozen-lockfile
```

**结果**：

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5, esbuild@0.27.3, sharp@0.34.5, workerd@1.20260526.1
```

**失败原因**：`ignore-scripts` 是全局脚本执行开关，而 pnpm 11 的 `[ERR_PNPM_IGNORED_BUILDS] 是由 `allowBuilds` 配置校验失败触发的，两者是不同的机制。修改 `ignore-scripts` 不会影响 `allowBuilds` 的校验结果。

### 尝试 5：`pnpm install --config.ignore-scripts=false`

```yaml
- run: pnpm install --frozen-lockfile --config.ignore-scripts=false
```

**结果**：

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5, esbuild@0.27.3, sharp@0.34.5, workerd@1.20260526.1
```

**失败原因**：与尝试 4 相同，`--config.ignore-scripts=false` 设置的是错误的配置项，无法解决 `allowBuilds` 校验失败问题。

---

## 六、最终修复方案

### 修复文件

`pnpm-workspace.yaml`

### 修复内容

将 `allowBuilds` 从占位符文本改为有效布尔值：

```yaml
# 修复前（commit 3e284f1）
allowBuilds:
  esbuild: set this to true or false
  sharp: set this to true or false
  workerd: set this to true or false

# 修复后（commit 2d5cccd）
allowBuilds:
  esbuild: true
  sharp: true
  workerd: true
```

### 同步清理

移除 workflow 文件中所有临时绕过参数，恢复为简洁配置：

```yaml
# 两个 workflow 文件统一为：
- name: 安装 pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 11.5.2

- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: "pnpm"

- name: 安装依赖
  run: pnpm install --frozen-lockfile
```

### 验证结果

Workflow run `28143080717` 执行结果：

```json
{
  "conclusion": "success",
  "status": "completed",
  "url": "https://github.com/qwdingyu/github_workflow/actions/runs/28143080717"
}
```

本地验证：

```bash
$ pnpm install --frozen-lockfile
Packages: +166
Done in 2.5s
```

---

## 七、受影响文件清单

| 文件 | 修改类型 | 修改摘要 |
|------|---------|---------|
| `.github/workflows/architecture-check.yml` | 修改 | pnpm 添加 `version: 11.5.2`；Node.js 改为 `22` |
| `.github/workflows/publish.yml` | 修改 | 两处 pnpm 添加 `version: 11.5.2`；两处 Node.js 改为 `22` |
| `pnpm-workspace.yaml` | 修改 | `allowBuilds` 从占位符文本改为有效布尔值 `true` |

---

## 八、铁律补充

基于本次踩坑，新增以下铁律：

**铁律 18：pnpm workspace 配置必须是有效 YAML/JSON，禁止使用占位符文本**
- `pnpm-workspace.yaml`、`.npmrc` 等配置文件中的示例/占位符文本（如 `set this to true or false`）会在 pnpm 版本升级后触发校验失败
- 配置项的值必须是 pnpm 能识别的有效类型（布尔值、数字、字符串）
- 升级 pnpm 大版本前，必须检查所有 workspace 配置项的兼容性

**铁律 19：升级 pnpm 大版本前必须检查 allowBuilds 配置**
- pnpm 11+ 对 `allowBuilds` 执行严格校验
- 如果依赖包需要运行构建脚本（如 esbuild、sharp、workerd），必须在 `pnpm-workspace.yaml` 中显式声明为 `true`
- 不要依赖 `pnpm approve-builds` 或 `--ignore-scripts` 等命令行参数绕过配置校验——这些参数解决的是不同的问题

**铁律 20：GitHub Actions 中 pnpm 版本必须显式指定，并与 Node.js 版本兼容**
- `pnpm/action-setup@v4` 必须显式指定 `version`
- 指定版本后，必须查阅 pnpm 官方兼容矩阵，确保 `node-version` 满足要求
- pnpm 11.5.2 要求 Node.js >= 22.13，不能使用 Node 20

**铁律 21：CI 失败时先查配置校验，再查审批状态**
- `[ERR_PNPM_IGNORED_BUILDS]` 是配置校验失败，不是审批问题
- `pnpm approve-builds` 只解决"待审批包"的授权问题，不解决"配置值无效"问题
- 看到 pnpm 错误时，先检查 `pnpm-workspace.yaml` 和 `.npmrc` 的语法和值是否有效

---

## 九、相关 commits

| Commit | 描述 |
|--------|------|
| `a5d8d15` | fix: 为 pnpm/action-setup@v4 显式指定 pnpm 版本，避免 CI 报 No pnpm version is specified |
| `4debe36` | fix: 将 GitHub Actions 的 Node.js 版本从 20 升级到 22，兼容 pnpm 11.5.2 要求 |
| `6b1cbb2` | fix: 统一 GitHub Actions Node 版本为 22，修复 pnpm 11.5.2 兼容性问题 |
| `0d8b37e` | fix: 在 CI 中增加 pnpm approve-builds，解决 pnpm 11.5.2 默认忽略依赖构建脚本的问题 |
| `2fa63a5` | fix: 使用 --no-ignore-builds 替代 approve-builds，修复 pnpm 11.5.2 CI 构建脚本被忽略的问题 |
| `802ce44` | fix: 显式 approve pnpm 11.5.2 所需构建脚本，修复 CI 安装失败 |
| `d547b64` | fix: 通过 pnpm config set ignore-scripts false 解决 CI 构建脚本被忽略问题 |
| `1d87e7e` | fix: 通过 --config.ignore-scripts=false 解决 pnpm 11.5.2 CI 构建脚本忽略问题 |
| `2d5cccd` | fix: 通过 pnpm-workspace.yaml 的 allowBuilds 配置解决 CI 构建脚本忽略问题，移除 workflow 临时绕过参数 |

---

**状态：✅ 全部完成（2026-06-25）**
