# RP 最小接入模板（cf-auth）

> 用途：新项目接 cf-auth 的最小可运行骨架（Hono + Node）。
> 照着改 env 即可本地跑通 authorize → callback → token → userinfo。

## 快速启动

```bash
cp .env.example .env           # 填入 cf-auth 发的 client_id / secret
npx tsx server.ts              # 启动 http://localhost:3000
# 浏览器打开 http://localhost:3000/login → 跳转 cf-auth → 回调 → 显示 user info
```

## 文件

| 文件 | 说明 |
|------|------|
| `server.ts` | OAuth Authorize / Callback / Userinfo 完整流程 |
| `.env.example` | 必要 env 清单（从 cf-auth Admin → OAuth 应用 → 创建后复制） |
| `README.md` | 本文件 |

## 与 docs/014 关系

文档 `docs/014_RP接入手册` 是手工步骤；本模板是可运行的代码实现。当有新 RP 时，复制本目录 + 改 env，代替从 lottery 手抄。

## 依赖

```bash
npm install hono jose
```
