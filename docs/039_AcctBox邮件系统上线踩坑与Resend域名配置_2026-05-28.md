# AcctBox 邮件系统上线踩坑与 Resend 域名配置指南

> 日期：2026-05-28
> 背景：eshop（AcctBox V2）邮件系统上线，从域名验证到 Workers Secrets 完整踩坑记录
> 核心结论：邮件系统涉及 4 层配置（DNS → Resend → Workers Secrets → 代码调用），任何一环缺失都会静默失败

---

## 一、Resend 域名验证（前置条件）

### 1.1 为什么要验证域名

Resend 不允许从未验证的域名发送邮件。如果你尝试用 `noreply@eforge.xyz` 发邮件但 `eforge.xyz` 未在 Resend 验证，API 返回 403。

### 1.2 验证步骤

1. 登录 https://resend.com/domains
2. 点击 "Add Domain" → 输入 `eforge.xyz`
3. Resend 生成 DNS 记录：

| 类型 | 主机记录 | 记录值 |
|------|----------|--------|
| TXT | `eforge.xyz` | `v=spf1 include:resend.com ~all` |
| TXT | `resend._domainkey.eforge.xyz` | `v=DKIM1; k=rsa; p=...` |
| MX | `eforge.xyz` | `10 feedback-smtp.resend.com` |

4. 在 DNS 服务商（Cloudflare / 阿里云等）添加以上 3 条记录
5. 回到 Resend 点击 "Verify" → 等待验证通过（通常 5 分钟内）
6. 验证成功后，`xxx@eforge.xyz` 即可用于发送

### 1.3 验证测试

```bash
curl -s -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "eshop <noreply@eforge.xyz>",
    "to": "test@resend.dev",
    "subject": "域名验证测试",
    "html": "<p>验证成功</p>"
  }'
# 成功：{"id":"xxx"}
# 失败：{"statusCode":403,"message":"Domain not verified"}
```

### 1.4 开发阶段替代方案

未验证域名时，可临时使用 Resend 提供的测试域名：
```
from: "AcctBox <onboarding@resend.dev>"
```
**⚠️ 此域名仅能发送到你自己的 Resend 注册邮箱，不能发给任意收件人。**

---

## 二、Cloudflare Workers Secrets 配置

### 2.1 必需的 Secrets

| Secret | 作用 | 示例值 |
|--------|------|--------|
| `RESEND_API_KEY` | Resend API 密钥 | `re_xxx` |
| `EMAIL_FROM` | 发件人地址 | `eshop <noreply@eforge.xyz>` |
| `ADMIN_TOKEN` | 管理员鉴权 | 自定义强密码 |
| `TURSO_URL` | 数据库连接 | `libsql://xxx.turso.io` |
| `TURSO_TOKEN` | 数据库令牌 | `eyJxxx` |

### 2.2 配置命令

```bash
# 一次性配置所有 Secrets
echo "re_xxx" | npx wrangler secret put RESEND_API_KEY
echo "eshop <noreply@eforge.xyz>" | npx wrangler secret put EMAIL_FROM
echo "your-strong-admin-token" | npx wrangler secret put ADMIN_TOKEN
echo "libsql://xxx.turso.io" | npx wrangler secret put TURSO_URL
echo "eyJxxx" | npx wrangler secret put TURSO_TOKEN

# 验证
npx wrangler secret list
```

### 2.3 易遗漏点

- **Workers Secrets 不随代码部署自动设置。** 每次新增环境变量必须手动 `wrangler secret put`。
- **`.dev.vars` 只用于本地开发，不会影响生产环境。**
- **`wrangler.jsonc` 中的 `vars` 只能存放非敏感配置（如 `APP_ORIGIN`），敏感信息必须用 Secrets。**

---

## 三、代码中的坑

### 3.1 markPaidAndIssue 遗漏 EMAIL_FROM

**问题**：`markPaidAndIssue` 函数签名增加了 `EMAIL_FROM` 参数后，两个调用方没有同步更新：
- `src/routes/pay.ts` 第 366 行（PayJS 支付回调）
- `src/routes/admin.ts` 第 204 行（管理员确认付款）

**修复**：
```typescript
// ❌ 修复前
await markPaidAndIssue(db, order.id, { RESEND_API_KEY: c.env.RESEND_API_KEY });

// ✅ 修复后
await markPaidAndIssue(db, order.id, { RESEND_API_KEY: c.env.RESEND_API_KEY, EMAIL_FROM: c.env.EMAIL_FROM });
```

**铁律**：函数签名变更 → 全局搜索所有调用方 → 同步更新。

### 3.2 旧模板目录未清理

**问题**：存在两套模板文件，变量命名不一致（snake_case vs camelCase），导致模板替换失败。

**修复**：删除 `src/templates/` 旧目录，统一使用 `src/services/templates/`。

**铁律**：迁移完成后必须清理旧代码，维护两套是灾难。

### 3.3 manual 下单缺少 pending 邮件

**问题**：用户创建线下支付订单后没有任何邮件通知。

**修复**：在 `createOrder` manual 分支添加 `order_pending` 邮件。

**铁律**：每种订单状态变更都应有对应的用户通知。

### 3.4 订单过期缺少 expired 邮件

**问题**：订单过期后用户完全不知道。

**修复**：给 `checkAndExpireOrder` 增加 `env` 和 `orderInfo` 参数，在过期时发送 `order_expired` 邮件。

**铁律**：状态变更 → 用户通知 必须绑定。

---

## 四、完整邮件触发矩阵

| 事件 | 模板 | 触发位置 | 前置条件 |
|------|------|----------|----------|
| direct 发卡成功 | `order_issued` | `createOrder` direct 分支 | `RESEND_API_KEY` + `buyerEmail` 含 `@` |
| manual 下单 | `order_pending` | `createOrder` manual 分支 | 同上 |
| 线下支付下单 | `order_pending` | `createOfflineOrder`（pay.ts） | 同上 |
| 管理员确认发卡 | `order_issued` | `markPaidAndIssue`（admin.ts） | 同上 |
| PayJS 回调发卡 | `order_issued` | `markPaidAndIssue`（pay callback） | 同上 |
| /pay/status 过期 | `order_expired` | `checkAndExpireOrder`（pay.ts） | 同上 |
| Cron 清理过期 | `order_expired` | `checkAndExpireOrder`（cleanup-service） | 同上 |
| 下单成功（paid） | `order_paid` | — | 模板存在但未使用，行业标准不发 |

---

## 五、部署检查清单

| # | 检查项 | 验证方法 | ✅ |
|---|--------|---------|-----|
| 1 | Resend 域名已验证 | Dashboard 确认 | ✅ |
| 2 | DNS 记录已添加 | `dig TXT eforge.xyz` 确认 SPF | ✅ |
| 3 | RESEND_API_KEY Secret | `wrangler secret list` | ✅ |
| 4 | EMAIL_FROM Secret | `wrangler secret list` | ✅ |
| 5 | curl 发送测试邮件 | 返回 `{"id":"xxx"}` | ✅ |
| 6 | markPaidAndIssue 含 EMAIL_FROM | 代码审查 | ✅ |
| 7 | pay callback 含 EMAIL_FROM | 代码审查 | ✅ |
| 8 | admin mark-paid 含 EMAIL_FROM | 代码审查 | ✅ |
| 9 | TypeScript 编译零错误 | `npx tsc --noEmit` | ✅ |
| 10 | 全量测试通过 | 275 tests | ✅ |
| 11 | 覆盖率达标 | Functions 94%, Lines 96% | ✅ |
| 12 | 生产部署成功 | `wrangler deploy` | ✅ |