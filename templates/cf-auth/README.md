# cf-auth

独立 **Better Auth** 统一认证服务（OAuth 2.1 / OIDC Provider）。

| 项 | 值 |
|----|-----|
| 生产域名 | `https://auth.eforge.xyz` |
| 本地 | `http://localhost:8788` |
| 形态 | Cloudflare Workers **与** Node 原生 **双入口**（生产流量建议只选一个权威源） |
| 边界 | 多项目走 **授权码 + PKCE**，**不**共享 Cookie、**不**让业务直连 auth DB |
| 上游登录 | **多社交 IdP**（Google / GitHub / …）：密钥 env + Admin 运营开关（启用/排序/展示名） |

## 架构一句话

对上联邦多个社交源（Inbound），对下用标准 OAuth/OIDC 服务多个业务 RP（Outbound）。  
配置用 `SOCIAL_PROVIDER_REGISTRY` + env 密钥；运营启用/排序见 Admin「社交登录」与 [docs/026](./docs/026_社交登录Admin运营开关_PhaseA_2026-08-04.md)。登录按钮由 `/api/auth-meta/social`（effective 集合）动态渲染。

详见 [docs/007_顶层架构审查与多社交IdP设计_2026-08-03.md](./docs/007_顶层架构审查与多社交IdP设计_2026-08-03.md)。

## 当前进度

| 里程碑 | 状态 |
|--------|------|
| M0 规划文档 | 完成（docs/000–005） |
| M1 脚手架 + health | 完成 |
| M2 Better Auth 核心 | 完成（邮箱 session + 社交 URL） |
| M3 OAuth Provider 本地闭环 | 完成（code → token → userinfo） |
| 多社交注册表 + 动态登录页 | 完成（google/github/…） |
| 独立 GitHub 仓库 | 完成（[qwdingyu/cf-auth](https://github.com/qwdingyu/cf-auth) private） |
| M4 Cloudflare 部署 | **完成**（https://auth.eforge.xyz · Turso） |
| M5 真实 Google/GitHub 凭证与授权 URL | 完成（本地 + 生产 secrets；浏览器同意页需控制台 URI） |
| 部署后全面功能验证 | **完成**（本地 + `npm run smoke:prod`，见 docs/012） |
| 多项目接入与 Admin 路线 | **分析见 013**；**M7 已实施**（docs/014/015） |
| M6 cf-lottery 接入 | 生产 RP 已接（见 lottery docs/067）；client 治理走 Admin |
| M7 平台 Admin + 限流 | **完成**：`/admin` SPA（拷贝 lottery 样式）、`/api/admin/*`、审计、限流 |
| M7 加固 | **完成**：create-client 收口、SPA 路由隔离、LIKE ESCAPE、`adminConfigured`（docs/016） |

详见 [docs/006_M1至M3实施记录_2026-08-03.md](./docs/006_M1至M3实施记录_2026-08-03.md)。

## 生产

### A. Cloudflare Workers（当前公开生产常用路径）

| 项 | 值 |
|----|-----|
| 主域名 | https://auth.eforge.xyz |
| 备用 | https://cf-auth.mailforwdy.workers.dev |
| 库 | Turso `cf-auth-db`（独立于 lottery） |

```bash
# 从 .env 同步 secrets（含 ADMIN_*）并部署
npm run deploy:prod   # = bash local-deploy.sh
curl -s https://auth.eforge.xyz/api/health
npm run smoke:prod    # 生产全面冒烟
```

详见 [docs/011_M4_Cloudflare部署记录_2026-08-03.md](./docs/011_M4_Cloudflare部署记录_2026-08-03.md)、  
[docs/012_Cloudflare部署后全面功能验证_2026-08-03.md](./docs/012_Cloudflare部署后全面功能验证_2026-08-03.md)。

### B. Node 原生 / 云服务器（Debian + nginx + systemd）

入口：`src/server.ts`（`npm start` / `npm run dev:local`）。  
运维脚本对齐 lottery 051 风格，细节以本仓文件为准：

```bash
# 服务器上（root）
git clone <repo> /tmp/cf-auth && cd /tmp/cf-auth
sudo bash scripts/setup-cloud-server.sh   # 或 npm run deploy:node
sudo nano /opt/cf-auth/.env               # 填密钥后
sudo systemctl restart cf-auth
curl -sS http://127.0.0.1:8788/api/health
# 更新
cd /opt/cf-auth && sudo bash scripts/update-cloud-server.sh
```

| 文件 | 作用 |
|------|------|
| `scripts/setup-cloud-server.sh` | 一键安装 |
| `scripts/update-cloud-server.sh` | 更新 |
| `scripts/cf-auth.service` | systemd |
| `scripts/nginx-auth.eforge.xyz.conf` | nginx |
| `scripts/env.cloud-server.example` | `.env` 模板 |

完整说明与切流注意：[docs/028_云服务器与Node原生部署_2026-08-04.md](./docs/028_云服务器与Node原生部署_2026-08-04.md)。  
**同一域名不要让 Workers 与 Node 同时当权威源。**

## 快速开始（本地）

```bash
cp .env.example .env
npm install --legacy-peer-deps
npm run build:frontend   # /admin 需要 public/
npm run db:migrate
npm run dev:local        # 或 npm start
curl -s http://localhost:8788/api/health
```

启用 GitHub（示例）：

```bash
# .env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
# 可选：ENABLED_SOCIAL_PROVIDERS=google,github
```

GitHub OAuth App 回调 URL 必须为：

`{BETTER_AUTH_URL}/api/auth/callback/github`

```bash
npm run verify   # tsc + vitest
```

## 平台 Admin（M7）

| 项 | 值 |
|----|-----|
| UI | `https://auth.eforge.xyz/admin`（样式/组件从 cf-lottery 拷贝，**无 i18n**） |
| API | `/api/admin/*`（clients / users / sessions / audit） |
| 鉴权 | `ADMIN_EMAILS` / `ADMIN_USER_IDS` 白名单 session，或 `ADMIN_API_KEY` |
| 构建 | `npm run build:frontend` → `public/`；`npm run deploy` 会先构建 |

```bash
# 本地：API + 已构建 SPA
npm run build:frontend && npm run dev:local
# 或 Vite 热更（proxy 到 8788）
npm run dev:local   # 终端 1
npm run dev:admin   # 终端 2 → http://localhost:5174/admin
```

RP 接入第二项目：[docs/014_RP接入手册_2026-08-03.md](./docs/014_RP接入手册_2026-08-03.md)。  
实施细节：[docs/015_M7_Admin与限流实施记录_2026-08-03.md](./docs/015_M7_Admin与限流实施记录_2026-08-03.md)。  
加固收口：[docs/016_M7加固核查与收口_2026-08-04.md](./docs/016_M7加固核查与收口_2026-08-04.md)。

## 核心路由

| 路径 | 说明 |
|------|------|
| `GET /api/health` | 健康检查（social ids + `adminConfigured` 布尔） |
| `/api/admin/*` | 平台管理（clients/users/sessions/audit；需 ADMIN_*） |
| `/admin` | 平台 Admin SPA |
| `GET /api/auth-meta/social` | 登录页用：effective 社交元数据（密钥∩allowlist∩运营启用） |
| `/admin/social` | 社交登录运营：启用 / 排序 / 展示名（密钥不入库） |
| `GET/PATCH /api/admin/social-providers` | 同上 API |
| `/api/auth/*` | Better Auth handler |
| `GET /api/auth/oauth2/authorize` | 授权端点 |
| `POST /api/auth/oauth2/token` | 换 token |
| `GET /api/auth/oauth2/userinfo` | 用户信息 |
| `GET /.well-known/oauth-authorization-server/api/auth` | AS metadata |
| `/sign-in` `/consent` | 最小登录/同意页 |

## 技术原则

- 使用官方 **better-auth** + **@better-auth/oauth-provider** + **Hono**，不自研 OAuth
- 双入口：`src/index.ts`（Workers）、`src/server.ts`（Node）
- 数据库：本地 `file:./data/local.db`；生产候选 D1/Turso
- 多 IdP：**注册表 + 成对密钥**，不写死单一 Google 分支

## 文档

见 [docs/000_文档索引总表_2026-08-03.md](./docs/000_文档索引总表_2026-08-03.md)。
