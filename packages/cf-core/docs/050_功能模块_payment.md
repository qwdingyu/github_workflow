# payment — 支付功能模块

## 包含

- `PaymentProvider` 接口（统一支付渠道抽象）
- `ProviderRegistry` + `ProviderFactory`（per-request 工厂）
- `AlipayProvider`（支付宝当面付，RSA2 签名）
- `signRSA2` / `verifyRSA2`（Web Crypto API 签名工具）

## 快速使用

```ts
import { AlipayProvider } from "@eforge/cf-core/features/payment";

const alipay = new AlipayProvider({
  appId: env.ALIPAY_APP_ID,
  privateKey: env.ALIPAY_PRIVATE_KEY,
  alipayPublicKey: env.ALIPAY_PUBLIC_KEY,
});

// 创建支付
const result = await alipay.createPayment({
  orderNo: "ORDER_001",
  amountCents: 9900,
  currency: "CNY",
  notifyUrl: "https://your-domain.com/api/pay/callback/alipay",
});
// result.qrCode → 支付宝二维码 URL

// 验证回调
const callback = await alipay.verifyCallback(callbackParams);
// callback.orderNo / callback.amountCents / callback.paidAt
```

## Registry 模式（多渠道自动选择）

```ts
import { createProviderRegistry, alipayFactory } from "@eforge/cf-core/features/payment";

const registry = createProviderRegistry(env, [alipayFactory]);
const provider = registry.selectOnline(); // 自动选择已配置的渠道
```

## 添加新支付渠道

实现 `PaymentProvider` 接口 + 创建 `ProviderFactory`：

```ts
import type { PaymentProvider, ProviderFactory } from "@eforge/cf-core/features/payment";

class StripeProvider implements PaymentProvider { /* ... */ }

export const stripeFactory: ProviderFactory = {
  name: "stripe",
  priority: 50, // 比 alipay(100) 优先
  isAvailable: (env) => !!env.STRIPE_SECRET_KEY,
  create: (env) => new StripeProvider({ secretKey: env.STRIPE_SECRET_KEY }),
};
```
