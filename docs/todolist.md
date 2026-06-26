# cf-shop 前端迁移待办清单

> 基于 2026-06-25 代码核查，以下待办项均为**真实缺口**，已排除已实现/已对齐项。
> 执行前请先确认当前线上生效的前端构建产物（`public/_app/` 是否存在）。

---

## P0 — 必须立即做（功能不可用）

### 1. `unifiedPay()` 补全兼容参数
- **现状**：`frontend/src/api/index.ts` 中 `unifiedPay()` payload 只有 `productId/buyerEmail/couponCode/campaignCode/referralCode/turnstileToken/balancePayment`，**缺少** `quantity?` 和 `idempotencyKey?`。
- **旧前端依赖**：`public/index.html` 下单时传 `quantity` 和 `idempotencyKey`（后者通过 header `idempotency-key` 传递）。
- **动作**：
  - `frontend/src/api/index.ts`: `unifiedPay` payload 增加可选 `quantity?: number`、`idempotencyKey?: string`
  - 若后端 `/api/pay/unified` 不接收这两个字段，需确认是前端保留兼容还是后端也需接收
- **验证**：`pnpm type-check` 通过

### 2. 全局 Toast composable
- **现状**：仅 `ShopView.vue` 有本地 `showToast(msg)` 函数，其他页面无统一提示。
- **动作**：
  - 新增 `frontend/src/composables/useToast.ts`
  - 提供 `showToast(msg, type?)` 方法（type: 'success' | 'error' | 'info'）
  - `ShopView.vue` 替换为全局 composable
- **验证**：`pnpm build` 通过

### 3. ShopView 恢复数量选择器
- **现状**：`ShopView.vue` 无数量选择器，`ProductCard.vue` 已有 `originalPriceCents`/`isOutOfStock`/`isLowStock` 展示逻辑。
- **动作**：
  - `ShopView.vue` 增加数量输入（min=1, max=stock）
  - 点击"去支付"时把 quantity 传给 `unifiedPay()`
- **验证**：手动点击商品→调整数量→打开支付弹窗，确认 payload 包含 quantity

---

## P1 — 高优先级（管理后台可用）

### 4. Admin API 层封装
- **现状**：`frontend/src/api/` 下无 admin 模块。
- **后端路由**：`src/routes/admin.ts` + `admin-payment.ts` + `admin-system-config.ts` + `admin-vouchers.ts`，前缀 `/api/admin/*`，认证方式 `Authorization: Bearer ${ADMIN_TOKEN}`。
- **动作**：
  - 新增 `frontend/src/api/admin.ts`
  - 封装以下接口（按旧前端 `public/admin.html` 实际调用对齐）：
    - `POST /api/admin/verify-jwt` → `adminLogin(jwt)`
    - `GET /api/admin/summary` → `fetchAdminSummary()`
    - `GET /api/admin/products` + `POST /api/admin/products` + `PATCH /api/admin/products/:id` + `DELETE /api/admin/products/:id`
    - `GET /api/admin/cards` + `POST /api/admin/cards/import` + `PATCH /api/admin/cards/:id` + `POST /api/admin/cards/batch-disable`
    - `GET /api/admin/orders` + `GET /api/admin/orders/:id` + `POST /api/admin/orders/:id/mark-paid` + `POST /api/admin/orders/:id/cancel` + `GET /api/admin/orders/export`
    - `GET /api/admin/coupons` + `POST /api/admin/coupons` + `POST /api/admin/coupons/generate` + `PATCH /api/admin/coupons/:code` + `DELETE /api/admin/coupons/:code`
    - `GET /api/admin/balance-transactions`
    - `GET /api/admin/system-config` + `PUT /api/admin/system-config` + `DELETE /api/admin/system-config/:key`
    - `GET /api/admin/payment/providers` + `GET /api/admin/payment/configs` + `PUT /api/admin/payment/configs` + `DELETE /api/admin/payment/configs/:id`
    - `GET /api/admin/batches` + `GET /api/admin/low-stock-products`
    - `POST /api/admin/test-email` + `GET /api/admin/email-logs`
    - `GET /api/admin/campaigns` + `POST /api/admin/campaigns` + `PATCH /api/admin/campaigns/:id` + `DELETE /api/admin/campaigns/:id`
    - `GET /api/admin/referral-codes` + `POST /api/admin/referral-codes` + `PATCH /api/admin/referral-codes/:id` + `DELETE /api/admin/referral-codes/:id`
    - `POST /api/admin/cleanup`
- **验证**：`pnpm type-check` 通过

### 5. Admin 类型定义
- **现状**：`frontend/src/types/` 下无 admin 类型。
- **动作**：
  - 新增 `frontend/src/types/admin.ts`
  - 定义接口（基于后端实际返回字段）：
    - `AdminProduct`、`AdminCard`、`AdminOrder`、`AdminCoupon`、`AdminBalanceTransaction`、`AdminSystemConfig`、`AdminPaymentProvider`、`AdminPaymentConfig`、`AdminBatch`、`AdminEmailLog`、`AdminCampaign`、`AdminReferralCode`、`AdminSummary`
- **验证**：`pnpm type-check` 通过

### 6. Admin 路由与布局
- **现状**：`frontend/src/router/index.ts` 只有 `/shop`、`/redeem`、`/lookup`、`/order`，无 admin 路由。
- **动作**：
  - `frontend/src/router/index.ts` 新增 `/admin/*` 路由（需认证守卫）
  - 新增 `frontend/src/views/AdminLoginView.vue`
  - 新增 `frontend/src/views/AdminLayout.vue`（侧边栏/标签页/统计卡片）
- **验证**：`pnpm build` 通过，路由可访问

### 7. Admin 业务视图（7 个）
- **现状**：不存在。
- **动作**：基于 `public/admin.html` 的实际功能，新建以下视图：
  - `frontend/src/views/admin/ProductsView.vue` — 商品 CRUD + 上下架
  - `frontend/src/views/admin/CardsView.vue` — 卡密列表 + 批量导入 + 禁用
  - `frontend/src/views/admin/OrdersView.vue` — 订单列表 + 标记已付 + 取消 + 导出
  - `frontend/src/views/admin/CouponsView.vue` — 优惠码列表 + 生成 + 编辑 + 删除
  - `frontend/src/views/admin/BalanceView.vue` — 余额流水列表 + 筛选
  - `frontend/src/views/admin/ConfigView.vue` — 系统配置读写删
  - `frontend/src/views/admin/PaymentView.vue` — 支付供应商/配置管理
- **验证**：每个视图能正常调用 API 并渲染数据

### 8. Admin 通用组件
- **现状**：不存在。
- **动作**：
  - `frontend/src/components/admin/AdminTable.vue` — 统一表格（支持排序/筛选/操作列）
  - `frontend/src/components/admin/Pagination.vue` — 分页组件
  - `frontend/src/components/admin/FilterBar.vue` — 筛选栏（搜索/状态/日期）
- **验证**：组件可在多个 admin 视图复用

---

## P2 — 中优先级（体验完善）

### 9. 商品列表增强
- **现状**：`fetchProducts` 已有分页/筛选参数，`ProductCard.vue` 已有折扣/库存徽章。
- **动作**：
  - `ShopView.vue` 增加分类筛选、搜索、分页控件
  - 确保 `availableStock`、`isOutOfStock`、`isLowStock` 正确影响按钮禁用状态
- **验证**：筛选/搜索/分页可用

### 10. 卡密批量导入对话框
- **现状**：后端 `/admin/cards/import` 已实现。
- **动作**：
  - `CardsView.vue` 增加批量导入弹窗（CSV/文本粘贴）
  - 显示导入进度和错误行
- **验证**：导入 100+ 卡密不卡顿，错误行高亮

### 11. 优惠码批量生成
- **现状**：后端 `/admin/coupons/generate` 已实现。
- **动作**：
  - `CouponsView.vue` 增加批量生成表单（前缀/数量/有效期/折扣类型）
- **验证**：生成 50+ 优惠码成功

### 12. 余额流水筛选/分页
- **现状**：后端 `/admin/balance-transactions` 已实现。
- **动作**：
  - `BalanceView.vue` 增加日期范围、邮箱搜索、分页
- **验证**：筛选结果正确

### 13. 支付配置动态表单
- **现状**：后端 `/admin/payment/configs` 已实现。
- **动作**：
  - `PaymentView.vue` 根据供应商类型动态渲染配置表单（ZPay/EasyPay/Stripe 字段不同）
- **验证**：配置保存后重启生效

---

## 验证步骤（全部待办完成后执行）

1. `pnpm type-check` — 类型通过
2. `pnpm build` — 构建通过
3. 客户前台 smoke test：
   - 商品展示 → 调整数量 → 打开支付弹窗 → 下单（余额/线上/线下） → 订单查询 → 查看结果
4. 管理后台 smoke test：
   - 登录 → 商品 CRUD → 卡密导入 → 订单标记已付/取消 → 优惠码生成 → 支付配置
5. `node scripts/validate-architecture.mjs` — 架构合规
6. 确认线上生效前端：检查 `public/_app/` 是否存在，若不存在需执行 `pnpm run frontend:build`

---

## 已排除项（无需再做）

| 项目 | 理由 |
|------|------|
| Product 类型补字段 | `frontend/src/types/index.ts` 已包含 originalPriceCents/availableStock/isOutOfStock/isLowStock/description/salesCopy/tagsJson/issueMode/category/sortOrder/active |
| Order 类型补字段 | `Order` 接口已包含 paidCents/expiresAt/productName/cards/delivery |
| 后端 admin 文件拆分 | 后端为单文件 `admin.ts` + 3 个子路由，路由完整，无需改动 |
| 支付命名 method→mode | 前端已统一为 `mode: 'online' | 'offline' | 'balance'`，无残留引用 |
