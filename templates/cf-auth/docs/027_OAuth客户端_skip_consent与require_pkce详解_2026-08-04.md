# 027 OAuth 客户端：`skip_consent` 与 `require_pkce` 详解

> 日期：2026-08-04  
> 项目：cf-auth（平台 IdP，`auth.eforge.xyz`）  
> 范围：Admin「新建/编辑 OAuth 应用」中的两个开关；**不**涉及 Google/GitHub 社交登录开关  
> 原则：以下均对照本仓库实现与 `@better-auth/oauth-provider` 运行时行为；**不** invent 协议外语义

---

## 1. 一句话

| 字段（API / DB） | Admin 建议中文文案 | 管什么 |
|------------------|-------------------|--------|
| `skip_consent` / `skipConsent` | **跳过用户授权确认页（仅第一方应用）** | 用户**已登录**后，是否还要经过 `/consent`「是否允许此应用访问」 |
| `require_pkce` / `requirePKCE` | **强制 PKCE（强烈建议开启）** | 授权与换 token 是否必须使用 PKCE（`code_challenge` + `code_verifier`） |

**共同点**：配置在 **出站 OAuth Client**（业务 RP 连 cf-auth），不是入站社交 IdP。

---

## 2. 审查结论（运维必读）

| 项 | 结论 |
|----|------|
| 默认新建 | Admin UI：`skip_consent=false`，`require_pkce=true` |
| 服务端创建 | `skip_consent` 仅当 body 显式 `true` 才开；`require_pkce` 为 `body.require_pkce !== false`（缺省/未传 → **true**） |
| `skip_consent=true` 门禁 | **全部** `redirect_uri` 的 hostname 必须 ∈ `FIRST_PARTY_REDIRECT_HOSTS`，否则 create/patch **失败** |
| 第一方名单（生产 wrangler） | `localhost,127.0.0.1,auth.eforge.xyz,lucky.eforge.xyz`（见 `wrangler.jsonc` vars） |
| 未配 env 时 | `parseFirstPartyHosts` 回落代码默认：`localhost` / `127.0.0.1` / `lucky.eforge.xyz` / `auth.eforge.xyz` |
| BA 运行时 `requirePKCE` | `client.requirePKCE ?? true`；公开客户端 / `offline_access` **始终**强制 PKCE，与开关无关 |
| 动态注册 | 插件禁止 DCR 设置 `skip_consent`；本平台 DCR 本身关闭 |
| 与登录 | `skip_consent` **不**跳过登录；无 session 仍去 `/sign-in` |
| 与 secret | `require_pkce` **不**等于取消 `client_secret`；机密客户端可 secret + PKCE 并存 |
| 与多 RP | consent / code / token 仍按 `client_id` 隔离；`skip_consent` 只跳过**该 client** 的确认 UI |

**推荐策略**

1. **自家第一方 RP**（redirect 全在白名单）：可开 `skip_consent`；**必须**开 `require_pkce`。  
2. **第三方 / 非白名单域**：禁止 `skip_consent`；**必须**开 `require_pkce`。  
3. **几乎不要**关 `require_pkce`（与 docs/014 接入手册 Code+PKCE 一致）。

---

## 3. 架构位置（双层 OAuth 中的哪一层）

```text
用户 ──► Google/GitHub（入站，社交）──► cf-auth 用户 + auth 域 session
用户 ──► 业务 RP ──► cf-auth /oauth2/authorize（出站，本文件两个字段）
                      ├─ 未登录 → /sign-in
                      ├─ 已登录 + 需同意 → /consent   ← skip_consent=false 时可能走到
                      └─ 已登录 + 可跳过/已同意 → 302 redirect_uri?code=…
业务后端 ──► /oauth2/token（PKCE verifier ± client_secret）← require_pkce 影响此路径
```

相关配置：

- 登录页 / 同意页：`src/lib/auth.ts` → `oauthProvider({ loginPage: "/sign-in", consentPage: "/consent" })`
- 同意页 UI：`src/routes/pages.ts` → `GET /consent` → 调 `/api/auth/oauth2/consent`
- 客户端表：`oauthClient.skipConsent` / `oauthClient.requirePKCE`（`src/db/schema.ts`）

---

## 4. `skip_consent` 详解

### 4.1 语义

**跳过最终用户授权确认（consent）**，不是跳过认证（login）。

用户已在 `auth.eforge.xyz` 持有有效 session 时：

| `skipConsent` | Better Auth 授权路径（`@better-auth/oauth-provider`） |
|---------------|-----------------------------------------------------|
| **true** | 直接 `redirectWithAuthorizationCode`：发授权码并 302 到 `redirect_uri`，**不**查 `oauthConsent`，**不**进 `/consent` |
| **false** / 未开 | 查 `oauthConsent`（`clientId` + `userId` [+ 可选 referenceId]）；若无记录或 scope 不全 → 跳转 **consent 页**；已有完整同意 → 同样直接发 code |

额外：请求带 `prompt=consent` 时，插件仍会要求走 consent 交互（与 client 标志叠加，以插件实现为准）。

### 4.2 本平台「仅第一方」约束（Admin 层，非 BA 自带）

BA 插件本身**不**根据域名限制 `skip_consent`。约束是 **cf-auth Admin 在 create/patch 时**加上的（docs/020 R4 → docs/022）：

**模块**：`src/lib/oauth-client-validation.ts`

```text
assertSkipConsentAllowed(redirectUris, firstPartyHosts):
  对每个 redirect_uri 取 hostname（小写）
  若不在 firstPartyHosts → 拒绝
  文案示例：skip_consent 仅限第一方域名（…）；拒绝主机 third.example
```

**调用点**：`src/routes/admin.ts`

- `POST /api/admin/clients`：`body.skip_consent === true` 时，用**本次** `redirect_uris` 校验。  
- `PATCH /api/admin/clients/:clientId`：若**生效后的** `skip_consent` 为 true（body 显式 true **或** 未改 body 但库中已是 true），则用**新 redirect（若有）否则旧 redirect** 再校验。  
  → 含义：已开启 skip 的 client，**不能**把 redirect 改成非第一方主机且仍保持 skip；改 redirect 也会被拦。

**白名单来源**

| 优先级 | 来源 |
|--------|------|
| 1 | 环境变量 `FIRST_PARTY_REDIRECT_HOSTS`（逗号分隔，trim，小写） |
| 2 | 代码默认：`localhost`, `127.0.0.1`, `lucky.eforge.xyz`, `auth.eforge.xyz` |

生产 `wrangler.jsonc` 当前 vars 与默认一致并含上述主机。新增业务域（例如 `app2.eforge.xyz`）若要开 skip，**必须先**把 hostname 写入 `FIRST_PARTY_REDIRECT_HOSTS` 并 redeploy，再创建/更新 client。

### 4.3 与 redirect 校验的关系

另有一层 **所有 client 都适用** 的 redirect 规则（与 skip 无关）：

- 允许：`https://…`
- 允许：`http://localhost` / `http://127.0.0.1`（可带端口）
- 拒绝：公网 `http://`、含 userinfo 的 URL、非法 URL

见 `parseRedirectUrisStrict`。即：第三方可用 **https** 注册 redirect，但**不能**再开 `skip_consent`。

### 4.4 默认与写入路径

| 路径 | 行为 |
|------|------|
| Admin SPA 新建 | `form.skipConsent = false` |
| Admin SPA 编辑 | 回填 `c.skipConsent` |
| POST body | `skipConsent: body.skip_consent === true` |
| session 管理员 | 可走 `auth.api.adminCreateOAuthClient({ skip_consent })` |
| API Key | Drizzle 直写 `oauthClient.skipConsent` |
| DTO 读出 | `skipConsent: Boolean(row.skipConsent)`（null/0 → false） |

### 4.5 安全含义

| 开 skip_consent | 风险 / 收益 |
|-----------------|-------------|
| 收益 | 第一方产品 SSO 少一步确认，体验接近「同一体系内应用」 |
| 风险 | 用户**看不到**「某某应用将获得你的身份/权限」；恶意或被劫持的第一方 redirect 配置危害更大 |
| 缓解 | 第一方主机白名单 + redirect 精确匹配 + 禁 DCR + 审计 `client.create` / `client.update` |

**明确不是**：

- 不是免登录  
- 不是跨 client 共用 consent  
- 不是跳过 RP 对 `id_token` 的 `iss`/`aud` 校验  
- 不是社交登录「记住我」

### 4.6 运维检查清单（skip）

- [ ] 该应用是否确为第一方、团队可控？  
- [ ] 每一个 redirect hostname 是否已在 `FIRST_PARTY_REDIRECT_HOSTS`？  
- [ ] 生产是否仅 https 业务域（本地 localhost 仅开发）？  
- [ ] 变更 skip / redirect 后是否出现在 `admin_audit_log`？  
- [ ] 关闭 skip 后，用户首次授权是否会落到 `/consent`（可人工点一次验证）？

---

## 5. `require_pkce` 详解

### 5.1 语义

**Proof Key for Code Exchange（RFC 7636）**：授权阶段提交 `code_challenge`（本实现仅 **S256**），token 阶段提交 `code_verifier`，AS 校验 hash 一致。用于降低**授权码泄露**后被另一端点换 token 的风险（尤其公共客户端；机密客户端亦为最佳实践）。

本平台对外承诺（docs/014）：**Authorization Code + PKCE**。

### 5.2 Better Auth `isPKCERequired`（运行时权威）

来源：`@better-auth/oauth-provider` 内 `isPKCERequired(client, requestedScopes)`（实现注释与代码一致）：

1. **始终要求 PKCE**（忽略 `requirePKCE=false`）若：  
   - `tokenEndpointAuthMethod === "none"`，或  
   - `type === "native"` / `"user-agent-based"`，或  
   - `public === true`  
2. **始终要求 PKCE** 若请求 scope 含 **`offline_access`**  
3. 否则：若 **`client.requirePKCE ?? true`** → 要求；仅显式 `requirePKCE === false` 且非 1/2 时可不强制  

**授权端**（`/oauth2/authorize`）：若 required 且缺少 `code_challenge` 或 `code_challenge_method` → `invalid_request`（错误描述为 required 原因字符串）。  
method 仅支持 **S256**。

**Token 端**（authorization_code）：

- 若 `isPKCERequired` → 必须带 `code_verifier` 路径  
- 若授权时用了 challenge，换 token **必须**带 verifier 且 S256 匹配  
- 授权未用 PKCE 却在 token 带 verifier → 失败  
- 本平台 Admin 创建的机密客户端默认仍带 `tokenEndpointAuthMethod: client_secret_basic` 与 secret；**推荐** secret 与 PKCE **同时**使用（lottery 样本即如此）

### 5.3 本平台写入与默认

| 路径 | 行为 |
|------|------|
| Admin SPA 新建 | `form.requirePkce = true` |
| Admin SPA 编辑 | `c.requirePKCE !== false`（null 当 true） |
| POST | `requirePKCE: body.require_pkce !== false` |
| PATCH | 仅当 body 含布尔 `require_pkce` 时更新 |
| DTO | `requirePKCE: row.requirePKCE == null ? true : Boolean(row.requirePKCE)` |

因此：**库内 null 与 true 对运维展示与 BA 默认一致，都按「需要 PKCE」理解。**

### 5.4 安全含义

| 保持 require_pkce=true | 关 false（机密 + 非 public + 无 offline_access） |
|------------------------|--------------------------------------------------|
| 与手册、样本、公网最佳实践一致 | 授权可无 challenge；安全面变差；易与前端实现不一致导致联调混乱 |
| 公开客户端仍会被 BA 强制 PKCE | 关开关**不能**让 public client 免 PKCE |

**明确不是**：

- 不是「不要 client_id」  
- 不是「不要 client_secret」  
- 不是 CSRF 的 `state` 替代品（`state` 仍应由 RP 自行校验）  
- 不是 Google/GitHub 侧的 PKCE 配置

### 5.5 运维检查清单（PKCE）

- [ ] 新建应用是否保持勾选「强制 PKCE」？  
- [ ] 业务 authorize URL 是否含 `code_challenge` + `code_challenge_method=S256`？  
- [ ] 业务 token 请求是否含 `code_verifier`？  
- [ ] 是否误关 `require_pkce` 导致「本地偶然成功、文档与其它 RP 不一致」？

---

## 6. Admin 与 API 对照

### 6.1 前端（`frontend/src/views/AdminClientsView.vue`）

| API 字段 | 表单中文标签（已落地） | 表单帮助（已落地） | 列表列 |
|----------|------------------------|--------------------|--------|
| `skip_consent` | 跳过用户授权确认页（仅第一方应用） | 已登录后不展示同意页；不跳过登录；回调域名须在第一方白名单 | **跳过同意**（是/否） |
| `require_pkce` | 强制 PKCE（强烈建议开启） | 授权 challenge + 换票 verifier；保持开启 | **PKCE**（是/否；`null` 按是） |

redirect 表单项另有一句：仅 https 或本地 localhost/127.0.0.1，且须与业务回调完全一致。

### 6.2 API

```http
POST /api/admin/clients
Content-Type: application/json
X-Admin-Api-Key: …   # 或管理员 session Cookie

{
  "name": "my-app-web",
  "redirect_uris": ["https://lucky.eforge.xyz/auth/callback"],
  "skip_consent": true,
  "require_pkce": true
}
```

```http
PATCH /api/admin/clients/:clientId
{
  "redirect_uris": ["…"],
  "skip_consent": false,
  "require_pkce": true
}
```

失败示例（非第一方仍 skip）：

- 消息含：`skip_consent 仅限第一方域名（…）；拒绝主机 …`

审计：

- 创建：`client.create`，meta 含 `skipConsent` 等  
- 更新：`client.update` / `client.enable` / `client.disable`

### 6.3 库字段

| 列 | 类型 | 说明 |
|----|------|------|
| `oauthClient.skipConsent` | integer boolean | 可 null；DTO 当 false |
| `oauthClient.requirePKCE` | integer boolean | 可 null；DTO/BA 当 true |

---

## 7. 端到端时序（便于排障）

### 7.1 skip_consent = true（第一方、已登录）

```text
RP → GET /api/auth/oauth2/authorize?client_id&redirect_uri&…&code_challenge&…
AS 校验 client、redirect、PKCE 参数
有 session
client.skipConsent → 写 authorization_code → 302 redirect_uri?code&state&iss
RP 后端 → POST /oauth2/token + code_verifier [+ secret] → tokens
```

### 7.2 skip_consent = false（无历史 consent）

```text
… 同上至有 session
无 skip → 查 oauthConsent 不足
→ 302 /consent?…
用户 Accept → /api/auth/oauth2/consent
→ 最终仍发 code 回 redirect_uri
```

### 7.3 require_pkce 触发失败（常见）

| 现象 | 可能原因 |
|------|----------|
| authorize 立刻 error `invalid_request` / PKCE required | 缺 challenge，或 client 强制 PKCE |
| token `PKCE is required for this client` | 有 code 但无 verifier |
| `code verification failed` | verifier 与授权时 challenge 不匹配 |
| `code_verifier provided but PKCE was not used` | 授权未带 challenge、token 却带了 verifier |

---

## 8. 与相关文档的边界

| 文档 | 关系 |
|------|------|
| docs/014 RP 接入手册 | 原则：第一方才 skip；协议 Code+PKCE；本文展开字段级语义 |
| docs/022 P2 运营加固 | 落地 redirect/https 与 skip 第一方门禁的实施记录 |
| docs/020 审查 R4 | 历史问题：曾无第一方约束；已由 022 修复 |
| docs/006 / 012 | 早期 skip 需 adminUpdate / 脚本；现以 Admin API 为准 |
| docs/026 社交 Phase A | **无关**：社交启用/排序是入站 IdP，不是本两字段 |
| docs/003 schema | 字段存在性；语义以本文 + BA 为准 |

---

## 9. 反幻觉核对（事实 vs 勿臆测）

| 已用代码/配置核实 | 未在本文断言 / 勿当成事实 |
|-------------------|---------------------------|
| skip 时 BA 直接发 code（`client.skipConsent` 分支） | 「skip 后永不写 oauthConsent」的持久化细节以插件 consent POST 为准，运维以「用户是否见到 /consent」为准即可 |
| 第一方校验只比 **hostname**，不比完整 origin 路径 | 子域需**单独**进白名单（`app.eforge.xyz` ≠ `eforge.xyz`） |
| PKCE method 仅 S256 | 未支持 plain |
| Admin 创建 default require true | 未保证历史手工改库的 null/false 业务都已审计 |
| consent 页路径 `/consent` | 未把 consent 页 UX 文案当作安全边界 |
| 多 RP 隔离见 docs/014 与 `multi-rp-isolation.test.ts` | 未声称 skip 改变 token 受众（`aud` 仍为 client） |

**单测锚点**

- `src/oauth-client-validation.test.ts`：redirect + skip 第一方  
- `src/admin-api.test.ts`：redirect / skip_consent 仅第一方  
- `src/oauth-provider.test.ts`：已登录 + skip_consent → code → token → userinfo  

---

## 10. 建议决策表（复制即用）

| 应用类型 | skip_consent | require_pkce | 备注 |
|----------|--------------|--------------|------|
| lucky / 其它 eforge 第一方 Web | 可 true | **true** | 先确保 hosts 在白名单 |
| 本地开发 localhost | 可 true | **true** | 仅 dev redirect |
| 外部合作方 https RP | **false** | **true** | 必须同意页 |
| 原生 / 公共客户端 | false（通常） | true（且 BA 强制） | 本 Admin 默认机密 web；改 public 需另审 |
| 不确定 | **false** | **true** | 默认安全侧 |

---

## 11. 后续与已落地

**已落地（与 §6.1 同步）**

- Admin 新建/编辑：中文标签 + `field-hint` 说明  
- 列表：「跳过同意」「PKCE」两列  

**已落地（运维摩擦 P1/P2，2026-08-04 续）**

- Admin 创建 client 响应含 `envSnippet` / `issuer`；SPA「复制 env 片段」  
- `GET /api/admin/health` 只读 `firstPartyRedirectHosts`；Clients 表单展示  
- 会话：`GET /api/admin/sessions?q=` 支持邮箱或 userId  

**仍可选**

- 新业务域 onboarding 时把更新 `FIRST_PARTY_REDIRECT_HOSTS` 写入部署清单勾选  
- 生产部署后用 `bash local-deploy.sh` 发布 Admin SPA

---

## 12. 权威代码索引

| 主题 | 路径 |
|------|------|
| 第一方 / redirect 校验 | `src/lib/oauth-client-validation.ts` |
| Admin create/patch | `src/routes/admin.ts` |
| DTO 默认 | `src/lib/oauth-client-dto.ts` |
| OAuth 插件页配置 | `src/lib/auth.ts` |
| Consent HTML | `src/routes/pages.ts`（`/consent`） |
| Schema | `src/db/schema.ts` → `oauthClient` |
| 生产白名单 | `wrangler.jsonc` → `FIRST_PARTY_REDIRECT_HOSTS` |
| Admin UI | `frontend/src/views/AdminClientsView.vue` |
| BA 运行时 | `node_modules/@better-auth/oauth-provider/dist/index.mjs`（authorize skipConsent；token PKCE）、`utils-*.mjs`（`isPKCERequired`） |
