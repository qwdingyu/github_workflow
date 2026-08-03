# cf-auth

独立 **Better Auth** 统一认证服务（OAuth 2.1 / OIDC Provider）。

| 项 | 值 |
|----|-----|
| 生产域名 | `https://auth.eforge.xyz` |
| 本地 | `http://localhost:8788` |
| 形态 | Cloudflare Workers **优先** + Node/libSQL **兼容** |
| 边界 | 多项目走 **授权码 + PKCE**，**不**共享 Cookie、**不**让业务直连 auth DB |

## 当前进度

| 里程碑 | 状态 |
|--------|------|
| M0 规划文档 | 完成（docs/000–005） |
| M1 脚手架 + health | 完成 |
| M2 Better Auth 核心 | 完成（邮箱 session + Google URL） |
| M3 OAuth Provider 本地闭环 | 完成（code → token → userinfo） |
| M4 Cloudflare 部署 | 未做 |
| M5 真实 Google | 未做 |
| M6 cf-lottery 接入 | 未做 |

详见 [docs/006_M1至M3实施记录_2026-08-03.md](./docs/006_M1至M3实施记录_2026-08-03.md)。

## 快速开始（本地）

```bash
cp .env.example .env
npm install --legacy-peer-deps
npm run db:migrate
npm run dev:local
curl -s http://localhost:8788/api/health
```

```bash
npm run verify   # tsc + vitest
```

## 核心路由

| 路径 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `/api/auth/*` | Better Auth handler |
| `GET /api/auth/oauth2/authorize` | 授权端点 |
| `POST /api/auth/oauth2/token` | 换 token |
| `GET /api/auth/oauth2/userinfo` | 用户信息 |
| `GET /.well-known/oauth-authorization-server/api/auth` | AS metadata |
| `/sign-in` `/consent` | 最小登录/同意页 |

## 技术原则

- 使用官方 **better-auth** + **@better-auth/oauth-provider** + **Hono**，不自研 OAuth
- 双入口：`src/index.ts`（Workers）、`src/server.ts`（Node）
- 数据库：本地 `file:./data/local.db`（同 lottery docs/050）；生产候选 D1/Turso

## 文档

见 [docs/000_文档索引总表_2026-08-03.md](./docs/000_文档索引总表_2026-08-03.md)。
