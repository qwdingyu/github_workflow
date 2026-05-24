# Vibox 虚拟资料落地页设计与部署方案

日期：2026-05-24

## 背景

需要在根目录下构建一个适合视频会员、虚拟资料购买、宣传拉新和促活的轻量项目，目标域名为：

```text
shop.eforge.xyz
```

项目必须符合已有部署最佳实践：

- 不做大而全系统。
- 第一版围绕核心转化闭环。
- 所有购买动作先跳转，不自建订单和支付。
- Telegram 群作为私域承接和促活入口。
- 静态部署优先，减少维护成本。

## 命名

采用项目名：

```text
Vibox
```

理由：

- 短小好记。
- `Vi` 可以理解为 video / virtual。
- `box` 对应资料盒、会员盒、资源盒。
- 不和 `shop.eforge.xyz` 的域名定位冲突。
- 后续可以扩展为多个资料包和会员包，但第一版不需要复杂品牌系统。

## 第一版目标

第一版只做四件事：

1. 展示视频会员和虚拟资料商品。
2. 点击购买按钮跳转外部购买链接。
3. 展示 Telegram 群并引导加入。
4. 部署到 Cloudflare Pages 并绑定 `shop.eforge.xyz`。

当前购买跳转 URL 使用 `https://www.baidu.com/` 公开网站作为展示占位。上线前必须替换为真实收款页、表单、客服链接或平台商品页。

## 不做什么

第一版明确不做：

- 登录。
- 支付。
- 订单。
- 卡密发放。
- 用户数据库。
- 后台管理。
- 分销系统。
- 多语言系统。

原因：

```text
当前最重要的是验证流量、商品表达、购买点击和 Telegram 承接。
没有验证转化前，自建交易系统会拖慢上线并增加运维成本。
```

## 项目结构

```text
shop/
  package.json
  wrangler.toml
  README.md
  scripts/
    check.mjs
  src/
    index.html
    styles.css
    app.js
    _headers
```

说明：

- `src/index.html` 是落地页主文件。
- `src/app.js` 集中配置商品、购买链接和 Telegram 群链接。
- `src/styles.css` 控制视觉和响应式布局。
- `src/_headers` 提供 Cloudflare Pages 安全响应头。
- `wrangler.toml` 为 Cloudflare Pages 部署配置。
- `scripts/check.mjs` 做静态检查，避免漏掉核心入口。

## 商品配置

商品集中配置在：

```text
shop/src/app.js
```

上线前必须替换：

```text
config.telegram.handle
config.telegram.url
products[].buyUrl
```

当前内置三类商品：

- 视频会员月卡。
- 效率资料包。
- 会员资料组合包。

这三个商品覆盖了最小转化模型：

```text
低价体验 -> 单资料购买 -> 组合包提升客单价
```

## Telegram 群策略

Telegram 不只作为“联系我们”，而是作为后续促活入口：

- 资料更新通知。
- 会员权益说明。
- 售后公告。
- 新活动提醒。
- 新用户引导。

注意：

- 不要在公开页面写过度承诺。
- 不要把 Telegram 群当订单系统。
- 如果涉及付费资料交付，仍需要真实交付链路或人工确认。

## 部署方案

推荐 Cloudflare Pages。

Pages 配置：

```text
Project name: vibox-shop
Build command: 留空
Build output directory: shop/src
Custom domain: shop.eforge.xyz
```

如果使用 Wrangler：

```bash
cd shop
npm run deploy
```

Cloudflare 域名绑定：

```text
Pages project: vibox-shop
Custom domain: shop.eforge.xyz
DNS: CNAME -> Cloudflare Pages 自动目标
SSL/TLS: Cloudflare 自动签发
```

## 上线前检查清单

上线前必须确认：

- `shop/src/app.js` 中 Telegram 群链接已替换。
- 所有 `buyUrl` 已替换为真实购买链接。
- 页面在手机端首屏可读。
- 商品价格与实际收款页一致。
- Telegram 群可打开。
- Cloudflare Pages 自定义域名状态为 Active。
- HTTPS 正常。
- `npm run check` 通过。

## 后续演进

只有在点击和购买有数据后，再考虑增强：

```text
第一阶段：静态页 + 跳转购买 + Telegram
第二阶段：表单收集 + 人工确认
第三阶段：第三方支付/商品平台
第四阶段：自建订单和自动发货
```

推荐先接第三方，而不是自建支付：

- Lemon Squeezy。
- Stripe Payment Link。
- Creem。
- Paddle。
- 飞书表单/金数据/Notion 表单。

只有当订单量稳定、支付渠道明确、交付规则清晰时，才考虑自建后端。

## 采坑记录

### 背景

虚拟资料项目很容易一开始就做成完整电商系统。

### 原因

登录、订单、支付、发货、售后、分销都会引入持续维护成本。

### 排查过程

当前真实目标是宣传、拉新、促活和购买跳转，并没有要求立刻完成自动交易闭环。

### 解决方案

采用纯静态落地页：

```text
商品展示 -> 购买跳转 -> Telegram 承接
```

### 建议

不要在没有真实订单数据前自建复杂后端。先验证商品、价格、文案和转化，再决定是否接入订单系统。
