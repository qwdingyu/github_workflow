# RTK 生效验证指南

## 两个层面的验证

### 层面 1：权限（settings.json）— 不弹框
重启后运行：
```
bash scripts/verify_permissions.sh
```
35 项全 ✅ = 权限配置生效。

### 层面 2：RTK 指令（AGENTS.md）— AI 主动加 rtk 前缀
这是**指令级**的，不是脚本能自动检测的。需要**人工观察 AI 行为**。

---

## RTK 验证步骤（重启 Qwen Code 后）

进入 `github_workflow` 目录，对 AI 说以下任意一句话：

### 测试 1：git 命令
> "帮我看下 git 状态"

- ✅ AI 执行 `rtk git status --short` → **RTK 生效**
- ❌ AI 执行 `git status --short` → **RTK 未生效**

### 测试 2：npm 命令
> "安装一下依赖"

- ✅ AI 执行 `rtk npm install` → **RTK 生效**
- ❌ AI 执行 `npm install` → **RTK 未生效**

### 测试 3：curl 命令
> "检测一下 baidu.com 的响应头"

- ✅ AI 执行 `rtk curl -sS -I https://www.baidu.com/` → **RTK 生效**
- ❌ AI 执行 `curl -sS -I https://www.baidu.com/` → **RTK 未生效**

### 测试 4：node 命令
> "跑一下 node 看看版本"

- ✅ AI 执行 `rtk node -v` → **RTK 生效**
- ❌ AI 执行 `node -v` → **RTK 未生效**

### 测试 5：管道命令
> "用 curl 抓 baidu.com 然后 grep 搜索 title"

- ✅ AI 执行 `rtk curl -sS https://www.baidu.com/ | rtk grep "title"` → **RTK 生效**
- ❌ AI 没加 rtk → **RTK 未生效**

---

## 如果 RTK 未生效

检查项：
1. `AGENTS.md` 是否在项目根目录：`ls AGENTS.md`
2. 父级 `AGENTS.md` 是否有 rtk 规则：`grep rtk ../AGENTS.md`
3. AI 是否加载了 AGENTS.md（会话开头应显示 "Context from: ../AGENTS.md"）

## 清理记录

- 用户级 `~/.qwen/settings.json`：已清理 ~50 条垃圾权限（中文输出片段被误录）
- 项目级 `.qwen/settings.json`：干净的 allow + deny 列表
- `Bash(rtk *)` 在用户级已配置 → 所有 rtk 前缀命令全局免授权
