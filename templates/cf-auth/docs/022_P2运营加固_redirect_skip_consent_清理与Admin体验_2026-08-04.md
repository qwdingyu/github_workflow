# 022 P2 运营加固：redirect / skip_consent / 清理与 Admin UX

> 日期：2026-08-04  
> 前置：docs/020 审查、docs/021 P0 止血  
> 范围：平台 IdP Admin（`auth.eforge.xyz/admin`），非 lottery 租户后台

## 1. 本轮目标

在 P0（完整下线 + 黑名单 + 批量封禁/启停）之上完成 020 所列 **P2 运营加固**，不引入批量删用户/删 client/批量轮 secret。

## 2. 已落地项

| 项 | 实现 | 说明 |
|----|------|------|
| redirect 严格校验 | `src/lib/oauth-client-validation.ts` + Admin create/patch | 仅 `https://*` 或 `http://localhost` / `127.0.0.1`；禁 userinfo |
| skip_consent 第一方 | 同模块 + `FIRST_PARTY_REDIRECT_HOSTS` | 全部 redirect hostname ∈ allowlist 才可 skip |
| rate_limit 清理 | `createApp` 启动偶发 + `index.ts` `scheduled` | 未绑 Cron 时启动路径仍可清；可选 CF Cron |
| users N+1 | `GET /users` 一次 `inArray` accounts | 本页 providers 批量查 |
| health 运营计数 | disabledClients / blocklist / sessionsCreated24h | Dashboard 展示 |
| audit 筛选 | `targetType` / `targetId` query | 前端筛选 + 本页 CSV 导出 |
| 会话多选 | `POST /sessions/batch-revoke` ≤20 | Sessions 页多选 + 批量下线 |
| 前端 | Dashboard / Audit / Sessions / 既有 Users·Clients·Blocklist | 批量纪律与 020 一致 |
| Blocklist 多选 | `POST /blocklist/batch-remove` + 前端多选 | 批量移除 ≤20；审计只读多选仅导出 CSV，**不**批量删审计 |

## 3. 配置

- **vars**（`wrangler.jsonc`）：`FIRST_PARTY_REDIRECT_HOSTS=localhost,127.0.0.1,auth.eforge.xyz,lucky.eforge.xyz`
- **.env.example**：同上注释
- 未设 env 时代码默认含 localhost + eforge 生产域

## 4. 明确未做

- 不开放 create-client 给普通用户（仍 403/收口）
- 不批量删除 client / user / audit
- 不批量 rotate secret
- 未强制绑定 Cloudflare Cron（`scheduled` 已实现，控制台可选绑定）
- 审计 CSV 仅导出**当前页**，避免一次打爆大表

## 5. 验证

```bash
npm run verify          # tsc + vitest
npm run build:frontend  # Admin SPA → public/
```

单测增量：redirect/skip_consent、batch-revoke 上限、audit 筛选、health 扩展字段、`oauth-client-validation` 单元。

## 6. 部署

```bash
bash local-deploy.sh    # verify + build + secrets + wrangler + smoke
# 或 git push 后本地 deploy:prod
```

生产：`https://auth.eforge.xyz` / Admin `https://auth.eforge.xyz/admin`
