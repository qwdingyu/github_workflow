# Vibox Shop

`Vibox` 是面向视频会员、虚拟资料、社群引流的轻量落地页项目，目标域名为 `shop.eforge.xyz`。

## 定位

- 宣传视频会员和虚拟资料包。
- 展示购买入口，当前购买 URL 使用公开站点作为占位。
- 展示 Telegram 群入口，用于拉新、促活和售后通知。
- 保持纯静态，不接入支付、不存储用户数据、不维护后台。

## 本地开发

```bash
npm run dev
```

本地校验：

```bash
npm run check
```

## 部署

Cloudflare Pages 推荐配置：

```text
Project name: vibox-shop
Build command: 无
Build output directory: shop/src
Custom domain: shop.eforge.xyz
```

也可以在 `shop/` 目录下直接使用 Wrangler：

```bash
npm run deploy
```

## 上线前必须替换

在 `src/app.js` 中替换：

- `telegram.url`
- `telegram.handle`
- 每个商品的 `buyUrl`

当前购买链接使用 `https://www.baidu.com/` 公开地址做演示，不代表真实支付渠道。

## 边界

这个项目只做落地页和跳转，不做：

- 用户登录。
- 在线支付。
- 订单系统。
- 卡密发放。
- 后台管理。

如果后续验证有转化，再单独接入 Lemon Squeezy、Stripe、Creem、Paddle、飞书表单、Notion 表单或自建订单系统。
