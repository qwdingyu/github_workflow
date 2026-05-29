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

### 3.5 CSP img-src 不允许外部图片 URL

**问题**：管理员设置 `coverUrl` 为外部 CDN 图片 URL 时，前端页面被浏览器 CSP 拦截，图片显示空白。

**根因**：`src/index.ts` CSP 配置 `img-src 'self' data:` 只允许本站和 data: URI。

**修复**：改为 `"img-src 'self' data: https:"` 允许所有 HTTPS 图片源。

**铁律**：CSP 白名单必须覆盖所有用户可输入的外部资源 URL。

### 3.6 Admin Loading 遮罩卡住 — MutationObserver 不可靠 + HTML 非法

**问题**：`/admin` 页面加载后一直显示"正在加载管理后台…"遮罩，Vue 模板内容被完全遮盖。

**根因 1（HTML 非法）**：`<div id="admin-loading">` 被错误地放在 `<head>` 标签内。`<head>` 只能包含元数据元素（`<meta>`, `<link>`, `<script>`, `<style>` 等），`<div>` 是流内容，浏览器会自动纠正 DOM 结构，导致 `#admin-loading` 的实际位置与预期不符。

**根因 2（MutationObserver 不可靠）**：原方案用 `MutationObserver` 监听 `#app` 的 `v-cloak` 属性移除来触发 loading 消失。但：
- Observer 连接时机不确定（可能在 Vue 挂载前/后）
- `v-cloak` 移除是属性变化，但 `<div v-cloak>` 在自定义指令中是通过 `el.removeAttribute('v-cloak')` 操作的，Observer 配置 `attributes: true` 能捕获，但前提是 DOM 结构正确
- 当 `#admin-loading` 被浏览器纠正到 `<body>` 外时，`loader.remove()` 虽然能执行，但 Observer 回调本身可能从未触发

**修复**：
```html
<!-- ❌ 错误：loading div 在 <head> 内 -->
<head>
  <div id="admin-loading">...</div>
  ...
</head>

<!-- ✅ 正确：loading div 在 <body> 开头 -->
<body>
  <div id="admin-loading">...</div>
  <div id="app" v-cloak>...</div>
  ...
</body>
```
```js
// ❌ 错误：MutationObserver 方案（不可靠）
const observer = new MutationObserver(function(mutations) {
  mutations.forEach(function(m) {
    if (m.attributeName === 'v-cloak') {
      var loader = document.getElementById('admin-loading');
      if (loader && !loader.hasAttribute('v-cloak')) {
        observer.disconnect();
        loader.remove();
      }
    }
  });
});
observer.observe(document.getElementById('app'), { attributes: true });

// ✅ 正确：app.mount() 后 nextTick 直接移除
app.mount('#app');
Vue.nextTick(function() {
  var loader = document.getElementById('admin-loading');
  if (loader) loader.remove();
});
```

**铁律**：
1. **Loading 遮罩移除必须绑定到确定性事件**（`app.mount()` 回调），不要用 MutationObserver 监听 DOM 变化——时机不确定、易遗漏。
2. **`<head>` 内严禁放 `<div>` 等流内容元素**——浏览器纠正 DOM 后会导致选择器失效、事件监听错位。
3. **始终保留超时兜底**（`setTimeout` 10s）——防止 JS 异常导致遮罩永久存在。

### 3.7 Admin 后台功能断层（待修复）

**问题 1**：订单状态机有 `canceled`/`refunded` 状态，但没有 API 触发路径（死状态）。

- 前端订单筛选器有"已取消"/"已退款"选项
- 但管理后台没有"取消订单"/"退款"按钮
- 后端没有 `POST /admin/orders/:id/cancel` 和 `/refund` 路由
- 管理员如果需要处理纠纷或取消误创建订单，只能手动操作数据库

**问题 2**：商品列表缺少 `issueMode`（发卡模式）列。

- `issueMode`（direct/manual）是影响购买流程的核心字段
- 编辑表单有该字段，但列表未展示
- 管理员无法一眼看出哪些商品是自动发卡、哪些需人工确认

**问题 3**：商品删除功能缺失。

- 管理端只有"上架/下架"和"编辑"，无"删除"
- 废弃商品只能下架，数据永久存在
- 如有订单关联则不可物理删除（外键约束）

**问题 4**：`fulfillmentMode` 硬编码。

- `createProduct` 中 `fulfillmentMode: "card"` 硬编码
- 前端编辑表单和 Zod schema 中都没有该字段
- 未来扩展非卡密发卡模式时需改代码

**优先级**：问题 1（P1），问题 2-4（P2，当前不影响核心功能）

---

## 四、完整邮件触发矩阵

| 事件 | 模板 | 触发位置 | 前置条件 |
|------|------|----------|----------|
| direct 发卡成功 | `order_issued` | `createOrder` direct 分支 | `RESEND_API_KEY` + `buyerEmail` 含 `@` |
| manual 下单 | `order_pending` | `createOrder` manual 分支 | 同上 |
| 线下支付下单 | `order_pending` | `createOfflineOrder`（pay.ts） | 同上 |
| 管理员确认发卡 | `order_issued` | `markPaidAndIssue`（admin.ts） | 同上 |
| 支付宝回调发卡 | `order_issued` | `markPaidAndIssue`（pay callback） | 同上 |
| /pay/status 过期 | `order_expired` | `checkAndExpireOrder`（pay.ts） | 同上 |
| GitHub Actions 定时清理过期 | `order_expired` | `checkAndExpireOrder`（cleanup-service） | 同上 |
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