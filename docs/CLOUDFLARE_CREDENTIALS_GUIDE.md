# Cloudflare 凭证使用指南 — 永久参考

> **目的**：一次写清，永远不再猜哪个 token 配哪个 email。
> **最后更新**：2026-06-01

---

## 一、你的 Cloudflare 账号信息

| 项目 | 值 |
|------|------|
| **登录邮箱** | `mailforwdy@gmail.com` |
| **Account ID** | `f4c2f5b7c4134455ba93f1ebc0233664` |
| **Zone ID (eforge.xyz)** | `b1df754ff171d8b748d831b04a69aac2` |
| **Zone 域名** | `eforge.xyz` |

---

## 二、凭证清单（2种方式）

### 方式 A：Global API Key（推荐 — 权限最全）

| 项目 | 值 |
|------|------|
| **类型** | Global API Key |
| **Key** | `cfk_OEX6CeMQY9HzaSypczGHsme7QzAxv7ki19HD6ksob4959493` |
| **配合邮箱** | `mailforwdy@gmail.com` |
| **权限** | 全部（Zone DNS + Workers + Routes + Domains） |
| **HTTP 头** | `X-Auth-Email: mailforwdy@gmail.com` + `X-Auth-Key: <key>` |

### 方式 B：API Token（受限 — 仅 Workers 编辑）

| 项目 | 值 |
|------|------|
| **类型** | API Token |
| **Token** | `cfat_ue16s4yVUHOfR8iwkrSfY7oJNU2QPggwyQVMO6DE6e5258c6` |
| **权限** | 仅 Workers Scripts:Edit（Account 级别） |
| **缺少的权限** | ❌ Zone DNS Edit、❌ Zone Settings Edit、❌ Workers Routes/Domains |
| **HTTP 头** | `Authorization: Bearer <token>` |
| **适用场景** | 仅 `wrangler deploy` 上传 Worker 代码 |

---

## 三、常见操作速查表

### 1. 部署 Worker（上传代码）

```bash
# 用 API Token（方式 B）即可
export CLOUDFLARE_API_TOKEN="cfat_ue16s4yVUHOfR8iwkrSfY7oJNU2QPggwyQVMO6DE6e5258c6"
cd templates/cf-guardian
npx wrangler deploy
```

### 2. 绑定自定义域名到 Worker（Workers Custom Domain）

```bash
# 必须用 Global API Key（方式 A）
cd /Users/dingyuwang/0-X/github_workflow
CF_AUTH_EMAIL="mailforwdy@gmail.com" \
CF_GLOBAL_API_KEY="cfk_OEX6CeMQY9HzaSypczGHsme7QzAxv7ki19HD6ksob4959493" \
CF_WORKER_SERVICE="cf-guardian" \
CF_CUSTOM_DOMAIN="seo.eforge.xyz" \
node scripts/cloudflare/workers_custom_domain_bind.mjs
```

### 3. 部署 Pages 项目 + 绑定域名

```bash
# 必须用 Global API Key（方式 A）
CF_AUTH_EMAIL="mailforwdy@gmail.com" \
CF_GLOBAL_API_KEY="cfk_OEX6CeMQY9HzaSypczGHsme7QzAxv7ki19HD6ksob4959493" \
CF_CUSTOM_DOMAIN="xxx.eforge.xyz" \
CF_PAGES_PROJECT="cf-static" \
node scripts/cloudflare/pages_github_domain_workflow.mjs
```

### 4. 探测当前 Token 权限

```bash
# 用 Global API Key
CF_AUTH_EMAIL="mailforwdy@gmail.com" \
CF_GLOBAL_API_KEY="cfk_OEX6CeMQY9HzaSypczGHsme7QzAxv7ki19HD6ksob4959493" \
CF_ACCOUNT_ID="f4c2f5b7c4134455ba93f1ebc0233664" \
CF_ZONE_ID="b1df754ff171d8b748d831b04a69aac2" \
node scripts/cloudflare/capability_probe.mjs

# 或用 API Token
CF_API_TOKEN="cfat_ue16s4yVUHOfR8iwkrSfY7oJNU2QPggwyQVMO6DE6e5258c6" \
CF_ACCOUNT_ID="f4c2f5b7c4134455ba93f1ebc0233664" \
CF_ZONE_ID="b1df754ff171d8b748d831b04a69aac2" \
node scripts/cloudflare/capability_probe.mjs
```

### 5. 创建/迁移 Turso 数据库

```bash
# 用 TURSO_DATABASE_URL 环境变量
export TURSO_DATABASE_URL="libsql://seo-guardian.turso.io?authToken=<turso_token>"
npx drizzle-kit push
```

---

## 四、踩坑记录 — 为什么之前总出错

### 坑 1：把 Global API Key 当 API Token 用

```bash
# ❌ 错误：Global Key 不能赋值给 CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN="cfk_OEX6CeMQY9HzaSypczGHsme7QzAxv7ki19HD6ksob4959493"
npx wrangler deploy  # 失败：Invalid access token [code: 9109]

# ✅ 正确：Global Key 必须配合邮箱，用 X-Auth-Email + X-Auth-Key
CF_AUTH_EMAIL="mailforwdy@gmail.com" \
CF_GLOBAL_API_KEY="cfk_OEX6CeMQY9HzaSypczGHsme7QzAxv7ki19HD6ksob4959493" \
node scripts/cloudflare/workers_custom_domain_bind.mjs
```

### 坑 2：用 API Token 做域名绑定

```bash
# ❌ 错误：API Token 没有 Zone 权限
export CLOUDFLARE_API_TOKEN="cfat_ue16s4yVUHOfR8iwkrSfY7oJNU2QPggwyQVMO6DE6e5258c6"
npx wrangler deploy --routes="seo.eforge.xyz/*"  # 失败：Authentication error [code: 10000]

# ✅ 正确：域名绑定必须用 Global API Key
```

### 坑 3：用 wrangler 而不是项目脚本

```bash
# ❌ 绕弯路：wrangler triggers deploy 需要特殊 token 权限
npx wrangler triggers deploy  # 经常失败

# ✅ 正确：用项目已有的脚本
node scripts/cloudflare/workers_custom_domain_bind.mjs
```

---

## 五、快速决策树

```
要做什么？
├─ 只部署 Worker 代码？
│  └─ 用 API Token (cfat_...) → CLOUDFLARE_API_TOKEN → wrangler deploy
│
├─ 绑定域名 / 改 DNS / 管理 Routes？
│  └─ 用 Global API Key (cfk_...) + 邮箱 → 项目脚本
│     CF_AUTH_EMAIL + CF_GLOBAL_API_KEY → workers_custom_domain_bind.mjs
│
├─ 部署 Pages？
│  └─ 用 Global API Key → pages_github_domain_workflow.mjs
│
└─ 不确定 token 权限？
   └─ 先用 capability_probe.mjs 探测
```

---

## 六、凭证格式识别

| 前缀 | 类型 | 用法 |
|------|------|------|
| `cfat_` | API Token | `Authorization: Bearer <token>` |
| `cfk_` | Global API Key（你的账号） | `X-Auth-Email` + `X-Auth-Key` |
| 无特殊前缀（纯字母数字） | 标准 Global API Key | `X-Auth-Email` + `X-Auth-Key` |

> **注意**：你的 Global API Key 以 `cfk_` 开头，但它**不是** API Token。
> Cloudflare 官方 Global Key 通常没有前缀，但你的 key 是 `cfk_` 格式，
> 只能用 `X-Auth-Key` 头，不能用 `Authorization: Bearer`。
