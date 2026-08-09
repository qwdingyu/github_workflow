# 018 Admin 登录 get-session 500 与 JWKS 密钥不一致

> 日期：2026-08-04  
> 项目：cf-auth（`https://auth.eforge.xyz`）  
> 影响面：平台管理后台 `/admin`，**不是** lottery 业务后台  
> 状态：生产已处置（清空 `jwks` 后由 Better Auth 按当前 secret 重建）
> **完整复盘与最佳实践：`docs/019_平台Admin登录全链路复盘与最佳实践_2026-08-04.md`**

## 背景

用户从 `/sign-in` Google 登录成功后，回调到  
`https://auth.eforge.xyz/admin/login?redirect=/admin/`，无法进入管理台。

Network 完整链路（截图）：

| 步骤 | 请求 | 状态 | 含义 |
|------|------|------|------|
| 1 | `POST/GET .../api/auth/sign-in/social` | 200 | 发起 Google |
| 2 | Google OAuth | 302 | 授权成功 |
| 3 | `GET /admin/` | 200 | SPA 壳加载成功 |
| 4 | `index-CwYLBSJ5.js` 等 | 304 | **新 Admin SPA 已上线**（非旧包问题） |
| 5 | `GET /api/admin/health`（路由守卫） | **401** | 解析不到管理员会话 |
| 6 | `AdminLoginView` → `GET /api/admin/health` | **401** | 同上 |
| 7 | `AdminLoginView` → `GET /api/auth/get-session` | **500** | **真正断点** |

## 容易误判的点（已排除）

| 猜测 | 结论 |
|------|------|
| 没部署最新 Admin 登录页 | 否。chunk 名与源码一致，UI 已是「社交优先」 |
| `ADMIN_EMAILS` 未含 `xthinkai@gmail.com` | 否。env 与库用户邮箱一致，且 `adminConfigured=true` |
| 纯 Google 用户没有邮箱密码 | 是事实，但**不是本次断点**；主路径应是 session 复用 |
| `ADMIN_API_KEY` 当登录密码 | 只能导致 email 登录失败，与 get-session 500 无关 |
| 无 cookie 时 get-session 坏了 | 否。无 cookie → `200 null` 正常 |

## 根因

1. Better Auth 挂了 `jwt()` 插件（OAuth Provider 依赖）。  
2. `jwt` 插件在 **`/get-session` 成功读到 session 之后**，用 after hook 签发 `set-auth-jwt` 响应头。  
3. 签发要解密 `jwks.privateKey`（由 `BETTER_AUTH_SECRET` 对称加密存库）。  
4. 库里那条 JWKS 是**旧 secret** 加密的；当前 Worker / `.env` 的 secret 解不开。  
5. 抛错：  
   `Failed to decrypt private key. Make sure the secret currently in use is the same as the one used to encrypt the private key...`  
6. 被包装成 `FAILED_TO_GET_SESSION` → HTTP **500**。  
7. `resolveAdminActor` 里 `auth.api.getSession` 失败被 catch 成 `null` → `/api/admin/health` **401**「需要平台管理员身份」。

因果链：

```
Google 登录成功（session 行已写入）
  → 浏览器带 __Secure-better-auth.session_token 进 /admin
  → get-session 能验 cookie、能 findSession
  → jwt after-hook 解密 JWKS 失败
  → 500
  → Admin 守卫/登录页认为「没有管理员会话」
  → 卡在 /admin/login
```

本地用生产 Turso + 当前 `BETTER_AUTH_SECRET` 复现：

- 带正确签名的 session cookie → get-session **500** + 上述解密错误  
- `DELETE FROM jwks` 后同 cookie → get-session **200** + user `xthinkai@gmail.com`  
- `/api/admin/health` → **200** `ok: true`

## 处置（生产，2026-08-04）

对 Turso `cf-auth-db` 执行：

```sql
DELETE FROM jwks;
```

下次需要签 JWT 时，Better Auth 会用**当前** `BETTER_AUTH_SECRET` 生成新密钥对。

验证（伪造与浏览器同格式的 `__Secure-better-auth.session_token`）：

- `GET /api/auth/get-session` → 200 + session/user  
- `GET /api/admin/health` → 200 + counts  

**用户侧**：刷新 `https://auth.eforge.xyz/admin`（必要时硬刷新）。  
若仍停在登录页，再走一次「去 /sign-in 用 Google 登录」（旧 cookie 若已过期/被清则需重新登录）。

## 为何会 secret 不一致

常见触发：

- 多次 `wrangler secret put BETTER_AUTH_SECRET` / `local-deploy` 换了 secret，**未清 jwks**  
- 早期部署与后期 `.env` 不是同一串  
- 本地 secret 与 CF secret 曾短暂分叉，却共用同一 Turso

`local-deploy.sh` 会从 `.env` 同步 `BETTER_AUTH_SECRET`；**换 secret 必须同步处理 JWKS**。

## 以后再发怎么处理

1. 看 Worker 日志是否有 `Failed to decrypt private key`。  
2. 确认 CF secret 与预期一致（不要用日志打明文）。  
3. 若确定要沿用**当前** secret：`DELETE FROM jwks;`（会让已签发的 access/id token 校验用旧 kid 失败，需 RP 重新授权；session cookie 本身一般仍可用）。  
4. 若必须沿用**旧** secret：把 CF / `.env` 改回加密该 jwks 时的值（更危险，优先清 jwks）。  
5. 可选加固（未做，记在此）：  
   - `/api/health` 探测「能否解密最新 jwks」  
   - 或 `jwt({ jwks: { disablePrivateKeyEncryption: true } })`（私钥明文落库，权衡安全）  
   - deploy 文档强制：变更 `BETTER_AUTH_SECRET` 检查清单含清 jwks

## 与邮箱密码登录的关系

`xthinkai@gmail.com` 仅有 `providerId=google` 的 account，**无 password 哈希**。  
在 Admin 登录页展开「邮箱密码」会得到 Invalid email or password——这是预期，不是本次 500 的原因。  
平台管理员主路径：**Google/GitHub → session → ADMIN_EMAILS 白名单**。

## 结论（一句话）

**问题不在 Admin SPA、不在白名单、不在 Google 登录本身；而在 jwt 插件的 JWKS 私钥与当前 `BETTER_AUTH_SECRET` 不匹配，导致有 session 时 `get-session` 500，进而 Admin 进不去。生产已清 jwks 恢复。**

---

## 延伸阅读

- 全链路状态机、分层探针、误判库、secret 轮换清单 → **docs/019**
- 部署与 ADMIN secret 同步 → docs/017
- M7 加固（SPA/create-client）→ docs/016
