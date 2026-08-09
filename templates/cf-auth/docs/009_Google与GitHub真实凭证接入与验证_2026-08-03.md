# 009 Google 与 GitHub 真实凭证接入与验证

> 日期：2026-08-03  
> 项目：cf-auth  
> 密钥：**仅**存在于本地 gitignored `.env`，本文不收录任何 secret

---

## 一、本地配置（已完成）

| 项 | 值 |
|----|-----|
| 文件 | `.env`（`.gitignore` 第 8 行忽略） |
| `ENABLED_SOCIAL_PROVIDERS` | `google,github` |
| `BETTER_AUTH_URL` | `http://localhost:8788` |
| Google / GitHub | 成对 `CLIENT_ID` + `CLIENT_SECRET`（来自控制台） |

验证忽略：

```bash
git check-ignore -v .env
# .gitignore:8:.env	.env
```

---

## 二、上游控制台必须登记的回调 URI

Better Auth 固定回调形态：

```text
{BETTER_AUTH_URL}/api/auth/callback/{providerId}
```

### 本地（当前默认）

| Provider | Authorized redirect / Callback URL |
|----------|--------------------------------------|
| **Google** | `http://localhost:8788/api/auth/callback/google` |
| **GitHub** | `http://localhost:8788/api/auth/callback/github` |

### 生产（部署 auth.eforge.xyz 后）

| Provider | URL |
|----------|-----|
| **Google** | `https://auth.eforge.xyz/api/auth/callback/google` |
| **GitHub** | `https://auth.eforge.xyz/api/auth/callback/github` |

### 控制台入口

- GitHub OAuth App：https://github.com/settings/developers（或具体 Application 设置页）  
- Google Cloud → APIs & Services → Credentials(凭据) → OAuth 2.0 Client → Authorized redirect URIs  
https://console.cloud.google.com/

> **说明：** 本环境无法代你点击控制台「保存」。若浏览器登录时报 `redirect_uri_mismatch`，请把上表 URI **精确**加入对应应用（含协议、端口、路径，无尾斜杠差异）。

---

## 三、自动化验证（已通过）

| 检查 | 命令 / 产物 | 结果 |
|------|-------------|------|
| 类型 + 单测 | `npm run verify` | tsc 0 · 17 passed / 1 skipped |
| 真实凭证套件 | `src/real-social-credentials.test.ts` | 有 `.env` 时 4 测通过 |
| 证据脚本 | `npm run verify:social` | `ok: true`，URL 含真实 client_id + callback |
| 真入口 | `npm run dev:local` + 双次 curl | health/meta 均含 `google`,`github` |
| 真入口 social | POST `/api/auth/sign-in/social` | 200 + accounts.google.com / github.com |

**验收边界（计划约定）：** 完整浏览器同意页 + 上游回调写 session 需人工登录与控制台 URI 一致；本阶段门禁为 **真实 client_id 授权 URL + health/meta 启用 + 测试/入口绿**。

---

## 四、开发者日常

```bash
cp .env.example .env   # 填入真实 ID/SECRET
npm run db:migrate
npm run dev:local
curl -s http://localhost:8788/api/health
curl -s http://localhost:8788/api/auth-meta/social
npm run verify
npm run verify:social
```

打开 http://localhost:8788/sign-in 应出现 **Google** 与 **GitHub** 按钮。

---

## 五、安全提醒

用户曾在聊天中粘贴过 Client Secret。建议在 Google/GitHub 控制台 **轮换 secret**，更新本地 `.env` 后重启。  
**禁止**把 secret 写入 git、README、docs 或 issue。
