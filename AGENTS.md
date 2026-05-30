# AGENTS.md - github_workflow 项目工作规则

> 本文件在每次 AI 会话启动时自动加载，所有规则必须严格遵守。

---

## 1. RTK 命令前缀（强制）

**所有 shell 命令必须使用 `rtk` 前缀**，无例外（纯读取类命令如 `ls`、`pwd` 除外）。

### 正确用法
```bash
rtk git status --short
rtk git add <files>
rtk git commit -m "<中文原因>"
rtk git push origin main
rtk npm install
rtk npm run dev
rtk npm run build
rtk npx wrangler deploy
rtk curl -sS -I https://example.com/
rtk node scripts/cloudflare/security_baseline.mjs
```

### 禁止用法
```bash
# ❌ 缺少 rtk 前缀
git push origin main
npm run dev
npm install
curl -sS https://example.com/
node scripts/cloudflare/security_baseline.mjs
```

### 特殊场景
- 管道命令：两端都加 `rtk`，如 `rtk curl -sS https://example.com/ | rtk rg "keyword"`
- 环境变量前缀：`CLOUDFLARE_API_TOKEN="<token>" rtk npx wrangler deploy`
- `rtk proxy` 用于需要代理的命令：`rtk proxy npx wrangler deploy --dry-run`
- 不要把 `rtk npm exec wrangler` 作为标准命令，实测可能从错误目录查找 `package.json`，用 `rtk npx wrangler` 代替

---

## 2. 提交规范

- commit message 必须使用**中文**
- 格式：`rtk git commit -m "<中文原因>"`
- 每次代码变更务必提交，不要积压

---

## 3. 铁律速查（详见 docs/）

| # | 铁律 |
|---|------|
| 1 | 每次代码变更务必提交，commit 用中文 |
| 2 | 所有代码修改都要同步文档 |
| 3 | 全局视野、顶层思路，不能不停打补丁 |
| 4 | 小而美的瑞士军刀，不要过度设计 |
| 5 | 分析全局后慎重改动，确保闭环+单元测试 |
| 6 | 问题/规范/流程保存到 docs 目录（采坑记录：背景/原因/排查/解决方案/建议） |
| 7 | docs 命名规范：`序号_中文文件名_日期.md`，不含空格 |
| 8 | 围绕核心功能，细节记入 todolist.md |
| 9 | 技术选型采用行业最优，遵循最佳实践 |
| 10 | 使用 RTK/MCP/skills 提高效率 |
| 11 | 测试脚本要正式化，不要写了删删了写 |
| 12 | 核心代码、变量、常量、业务流程补充中文注释 |
| 13 | 能用 ORM 一定不要用 SQL，防止注入和数据库切换 |
