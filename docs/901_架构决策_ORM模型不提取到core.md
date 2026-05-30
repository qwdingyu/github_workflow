# 架构决策记录：ORM Model 不提取到 cf-core

> 日期：2026-05-30  
> 决策者：架构师  
> 状态：✅ 已确认

## 背景

在多项目开发中，一个常见的架构问题是：是否需要将每个项目的 ORM Model 定义和业务逻辑提取到共享的 core 包中？

## 当前架构

```
@eforge/cf-core/src/db/schema.ts   ← 5 张公共表
├── systemConfig        (KV 配置)
├── adminAuditLogs      (审计日志)
├── rateLimitWindows    (限流窗口)
├── idempotencyKeys     (幂等键)
└── apiKeys             (API Key 认证)

templates/cf-shop/src/db/schema.ts   ← 10 张业务表 + re-export 5 张公共表
templates/cf-form/src/db/schema.ts   ← 3 张业务表 + re-export 3 张公共表
templates/cf-tools/src/db/schema.ts  ← 3 张业务表 + re-export 5 张公共表
templates/cf-api/src/db/schema.ts    ← 5 张业务表 + re-export 5 张公共表
```

## 决策

**不提取业务表和业务逻辑到 cf-core。保持当前分层。**

## 理由

### 1. 业务表之间没有任何重叠

四个模板的 21 张业务表没有一张是重复的：

| cf-shop | cf-form | cf-tools | cf-api |
|---------|---------|----------|--------|
| products | forms | users | tokens |
| cardBatches | submissions | tools | channels |
| cards | requestLogs | toolUsageLogs | serviceLogs |
| orders | | | priceHistory |
| orderEvents | | | priceSnapshot |
| coupons | | | |
| emailLogs | | | |
| cardLogs | | | |
| voucherCodes | | | |
| userBalances | | | |

如果硬要提取，只会出现两种坏结果：
- 提取一个不需要的表到 core → 其他项目被迫建不需要的表，浪费存储
- 提取一半字段 → 各项目还得扩展字段，增加复杂度

### 2. 当前分层符合行业最佳实践

```
Layer 0: drizzle-orm/sqlite-core    ← ORM 框架（第三方）
Layer 1: @eforge/cf-core/db/schema  ← 公共基础设施表（5 张）
Layer 2: templates/*/db/schema      ← 业务表（各项目独立）
```

对标行业标准：
- **Next.js** 不会把业务 Model 放到框架里
- **Rails** 的 ActiveRecord 在框架层，但具体 Model 在项目里
- **Django** 的 ORM 在框架层，但具体 Model 在各 app 里

我们当前的设计 = 框架层提供 ORM + 公共表，项目层定义业务表。**这已经是正确的分层。**

### 3. 业务逻辑更不应该提取

各模板的服务层代码（order-service / form-service / tool-service）：
- 依赖各自的业务表（不同项目表结构完全不同）
- 有各自的业务规则（发卡 vs 表单提交 vs 工具调用）
- 没有可复用的逻辑

把它们提取到 core 就像把"餐厅菜单"放到"厨房设备供应商"里 — 两个完全不同的领域。

### 4. 唯一值得考虑的场景

如果未来出现以下情况，**才**需要考虑提取：

| 场景 | 提取什么 | 判断标准 |
|------|---------|---------|
| 多个电商项目共用 | products/orders/coupons | 确实有 2+ 个项目需要完全相同的表 |
| 多个项目都有用户系统 | users 表 + 认证服务 | 确实有 2+ 个项目用相同的用户模型 |
| 多个项目都有表单 | forms/submissions | 确实有 2+ 个项目需要动态表单 |

**当前不满足以上任何一个条件。**

## 未来演进路径

```
当前（正确）:
  cf-core = 公共基础设施（5 表 + 中间件 + 工具函数）
  模板    = 业务表 + 业务逻辑

未来（如果出现复用需求）:
  cf-core = 公共基础设施
  @eforge/cf-shop-core  = 电商公共表 + 服务（products/orders/payments）  ← 新建包
  @eforge/cf-form-core  = 表单公共表 + 服务（forms/submissions）          ← 新建包
  模板    = 薄壳（只做定制化配置 + UI）

而不是:
  cf-core = 公共基础设施 + 所有业务表 ❌（会变成巨型单体）
```

## 结论

**当前架构是正确的。cf-core 已经提取了所有项目共用的 5 张公共表。业务表和业务逻辑不应该提取到 core — 它们是每个项目的核心竞争力，不是公共基础设施。过早抽象是万恶之源。**

## 参考

- 《900 深度架构评审与重构建议》第 8 条：Feature 接口风格不统一（已确认不需要统一）
- 行业对标：Next.js / Rails / Django 的分层设计
