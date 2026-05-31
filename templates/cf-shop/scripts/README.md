# scripts/ 脚本索引

> 最后更新：2026-05-28

## 快速导航

| 场景 | 命令 |
|------|------|
| **首次完整部署** | `CLOUDFLARE_API_TOKEN=xxx bash scripts/08-setup-local.sh` |
| **配置 GitHub Actions** | `CLOUDFLARE_API_TOKEN=xxx bash scripts/09-configure-github.sh` |
| **仅部署（不 seed）** | `CLOUDFLARE_API_TOKEN=xxx ADMIN_TOKEN=xxx ESHOP_SEED_REMOTE=false npm run deploy:full` |
| **本地开发测试** | `npm run dev` → `npm run smoke:readonly` |
| **数据库备份** | `CLOUDFLARE_API_TOKEN=xxx bash scripts/12-ops-maintenance.sh backup-remote` |
| **轮换管理 Token** | `bash scripts/12-ops-maintenance.sh rotate-admin-token` |
| **绑定自定义域名** | `CLOUDFLARE_API_TOKEN=xxx ESHOP_BIND_DOMAIN=true npm run deploy:full` |
| **配置 Resend 邮件** | `bash scripts/11-setup-resend.sh` |

---

## 脚本执行顺序（严格按此顺序）

```
┌─────────────────────────────────────────────────────────────────┐
│                 eshop 部署流程（8步）                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  第1步: 01-check.mjs            结构检查（文件、配置、迁移）      │
│    ↓                                                            │
│  第2步: 02-deploy-full.mjs      完整部署（D1/Turso → deploy）    │
│    ↓                                                            │
│  第3步: 03-bind-domain.mjs      绑定自定义域名                    │
│    ↓                                                            │
│  第4步: 04-smoke-readonly.mjs   只读冒烟测试                      │
│    ↓                                                            │
│  第5步: 05-smoke-admin.mjs      管理端冒烟测试                    │
│    ↓                                                            │
│  第6步: 06-smoke-write.mjs      写入冒烟测试                      │
│    ↓                                                            │
│  第7步: 07-verify-domain.mjs    域名 HTTPS 握手验证               │
│    ↓                                                            │
│  第8步: 08-setup-local.sh       本地一键部署（编排 01-07）        │
│                                                                 │
│  配置类（首次部署后按需执行）:                                     │
│  09-configure-github.sh         GitHub Actions 配置（主力）       │
│  10-setup-github.sh             GitHub 配置（含支付/邮件 Secrets）│
│  11-setup-resend.sh             Resend API Key 配置               │
│                                                                 │
│  运维类（日常维护）:                                              │
│  12-ops-maintenance.sh          运维工具集（备份/导出/轮换/清理）  │
│  13-apply-turso-migrations.sh   Turso 迁移                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 脚本清单

| 序号 | 脚本名 | 类型 | 用途 |
|------|--------|------|------|
| 01 | [`01-check.mjs`](./01-check.mjs) | mjs | 静态结构检查（文件存在、wrangler 配置、migration 表） |
| 02 | [`02-deploy-full.mjs`](./02-deploy-full.mjs) | mjs | 完整远程部署（D1 创建/迁移/seed → deploy → smoke） |
| 03 | [`03-bind-domain.mjs`](./03-bind-domain.mjs) | mjs | Workers Custom Domain 绑定（Cloudflare API） |
| 04 | [`04-smoke-readonly.mjs`](./04-smoke-readonly.mjs) | mjs | 只读 smoke（health、商品列表、优惠码、/admin 不泄露） |
| 05 | [`05-smoke-admin.mjs`](./05-smoke-admin.mjs) | mjs | 管理端 smoke（创建商品、导入卡密、manual 订单、确认发卡） |
| 06 | [`06-smoke-write.mjs`](./06-smoke-write.mjs) | mjs | 写入 smoke（创建订单、幂等键、direct 发卡闭环） |
| 07 | [`07-verify-domain.mjs`](./07-verify-domain.mjs) | mjs | 域名 HTTPS 握手 + /api/health 验证 |
| 08 | [`08-setup-local.sh`](./08-setup-local.sh) | bash | 本地一键部署（install → check → D1 → deploy → smoke → GitHub） |
| 09 | [`09-configure-github.sh`](./09-configure-github.sh) | bash | GitHub Actions 配置（精简版，已验证主力） |
| 10 | [`10-setup-github.sh`](./10-setup-github.sh) | bash | GitHub Actions 配置（含可选支付/邮件/Turnstile Secrets） |
| 11 | [`11-setup-resend.sh`](./11-setup-resend.sh) | bash | Resend API Key 配置到 Workers Secret |
| 12 | [`12-ops-maintenance.sh`](./12-ops-maintenance.sh) | bash | 运维工具集（backup/export/rotate-token/cleanup） |
| 13 | [`13-apply-turso-migrations.sh`](./13-apply-turso-migrations.sh) | bash | 将 migrations/*.sql 应用到 Turso 远程数据库 |

### 辅助文件

| 文件 | 用途 |
|------|------|
| [`http-client.mjs`](./http-client.mjs) | Smoke 测试共享 HTTP 客户端（内部依赖） |

---

## 调用关系

```
08-setup-local.sh        ← 入口：本地一键部署
  ├── npm install
  ├── 01-check.mjs
  ├── 02-deploy-full.mjs ← 入口：完整部署
  │     ├── wrangler d1 create/export
  │     ├── wrangler deploy
  │     ├── 03-bind-domain.mjs  (ESHOP_BIND_DOMAIN=true)
  │     ├── 04-smoke-readonly.mjs
  │     ├── 05-smoke-admin.mjs
  │     └── 06-smoke-write.mjs
  └── 09-configure-github.sh  (gh CLI 可用时)

12-ops-maintenance.sh    ← 入口：运维操作
  ├── backup-remote
  ├── export-admin
  ├── rotate-admin-token
  └── cleanup-idempotency-keys

04/05/06-smoke-*.mjs     ← 均依赖 http-client.mjs
07-verify-domain.mjs     ← 独立
11-setup-resend.sh       ← 独立
13-apply-turso-migrations.sh ← 独立
```

---

## 环境变量速查

| 变量 | 用途 | 必需于 |
|------|------|--------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API 鉴权 | 所有远程操作 |
| `ADMIN_TOKEN` | 管理后台鉴权 | smoke:admin, smoke:write |
| `RESEND_API_KEY` | Resend 邮件 API | 邮件发送, 11-setup-resend |
| `EMAIL_FROM` | 发件人地址 | 邮件发送 |
| `ESHOP_WORKER_NAME` | Worker 名称（默认 eshop） | deploy, backup |
| `ESHOP_D1_DATABASE` | D1 数据库名（默认 eshop-db） | deploy, backup |
| `ESHOP_CUSTOM_DOMAIN` | 自定义域名（默认 eshop.eforge.xyz） | domain bind |
| `ESHOP_BIND_DOMAIN` | 是否绑定域名（默认 false） | deploy-full |
| `ESHOP_SEED_REMOTE` | 是否执行 seed（默认 true） | deploy-full |
| `DATABASE_PROVIDER` | 数据库引擎 d1/turso（默认 d1） | ops-maintenance |
| `TURSO_URL` / `TURSO_AUTH_TOKEN` | Turso 连接信息 | Turso 操作 |
| `BASE_URL` | 目标地址（默认 localhost:8790） | smoke, verify |

---

## 踩坑记录

详见 [DEPLOY-GUIDE.md](./DEPLOY-GUIDE.md)