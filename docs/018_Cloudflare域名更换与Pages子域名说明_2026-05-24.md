# Cloudflare 域名更换与 Pages 子域名说明

## 背景

本次需要确认两个问题：

1. `tool.eforge.xyz -> xtools-7nq.pages.dev` 为什么不是 `tool.eforge.xyz -> xtools.pages.dev`。
2. 现有工具和脚本是否支持把 `ai.eforge.xyz` 更换到 `auth.eforge.xyz`。

## 结论

### tool.eforge.xyz 为什么指向 xtools-7nq.pages.dev

这是 Cloudflare Pages 自动分配给项目的真实默认子域名，不是本地脚本生成的。

当前 API 和线上验证结果：

```text
Pages project: xtools
Cloudflare returned subdomain: xtools-7nq.pages.dev
Custom domain: tool.eforge.xyz
DNS: tool.eforge.xyz CNAME xtools-7nq.pages.dev
HTTPS: https://tool.eforge.xyz -> HTTP/2 200
```

`vibox-shop` 的默认域名刚好是：

```text
vibox-shop.pages.dev
```

但 `xtools` 的默认域名是：

```text
xtools-7nq.pages.dev
```

所以不能把规则写死成 `<project>.pages.dev`。

最佳实践：

```text
永远读取 Cloudflare Pages API 返回的 project.subdomain。
DNS CNAME 永远指向这个真实 subdomain。
```

这也是当前 `pages_github_domain_workflow.mjs` 的实现方式。

## 官方依据

Cloudflare Pages 官方文档说明，自定义 CNAME 应指向你的 Cloudflare Pages 子域名，例如 `<YOUR_SITE>.pages.dev`。实际项目的 `<YOUR_SITE>.pages.dev` 必须以 Cloudflare 返回的真实项目子域名为准。

Cloudflare Workers 官方文档说明，Custom Domains 可以把 Worker 连接到域名或子域名；添加后 Cloudflare 会代为创建 DNS 记录并签发证书。一个 Worker 可以添加多个 Custom Domain。

参考：

- Cloudflare Pages Custom Domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
- Cloudflare Workers Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare Workers Domains API: https://developers.cloudflare.com/api/resources/workers/

## ai.eforge.xyz 更换到 auth.eforge.xyz

### 当前状态

已确认：

```text
Workers custom domain:
ai.eforge.xyz -> gptsession2cpaandsub2api (production)

DNS:
ai.eforge.xyz AAAA 100:: proxied=true read_only=true

auth.eforge.xyz:
DNS records: []
HTTPS: 当前不可访问
```

因此 `auth.eforge.xyz` 当前没有 DNS 冲突，可以作为新的 Worker Custom Domain 目标。

### “新增绑定”和“真正更换”的区别

新增绑定：

```text
保留 ai.eforge.xyz
新增 auth.eforge.xyz -> gptsession2cpaandsub2api
两个域名同时可访问
```

真正更换：

```text
第一步：新增 auth.eforge.xyz
第二步：curl 验证 auth.eforge.xyz 正常
第三步：更新项目文档、外部入口、回调地址、书签、脚本配置
第四步：确认没有依赖 ai.eforge.xyz
第五步：删除 ai.eforge.xyz Workers custom domain
```

最佳实践是先新增、验证，再删除旧域名。不要直接删除旧域名后再绑定新域名。

## 脚本支持情况

脚本：

```text
scripts/cloudflare/workers_custom_domain_bind.mjs
```

当前已支持：

```text
1. 使用 CF_API_TOKEN 鉴权。
2. 使用 CF_AUTH_EMAIL + CF_GLOBAL_API_KEY 鉴权。
3. 如果账号只有一个，自动推导 CF_ACCOUNT_ID。
4. 从 CF_CUSTOM_DOMAIN 自动推导 zone name，并查询 CF_ZONE_ID。
5. 从 CF_SOURCE_CUSTOM_DOMAIN 推导 Worker service、environment、zone。
6. 幂等绑定目标 custom domain。
7. 默认不删除旧域名。
8. 只有显式设置删除开关和确认字符串时才删除旧域名。
```

## 推荐执行方式

### 方式 A：先新增 auth.eforge.xyz，不删除 ai.eforge.xyz

这是推荐方式。

```bash
CF_AUTH_EMAIL="<cloudflare-email>" \
CF_GLOBAL_API_KEY="<global-api-key>" \
CF_SOURCE_CUSTOM_DOMAIN="ai.eforge.xyz" \
CF_CUSTOM_DOMAIN="auth.eforge.xyz" \
node scripts/cloudflare/workers_custom_domain_bind.mjs
```

脚本会从 `ai.eforge.xyz` 推导：

```text
Worker service: gptsession2cpaandsub2api
Environment: production
Zone: eforge.xyz
```

然后新增：

```text
auth.eforge.xyz -> gptsession2cpaandsub2api
```

验证：

```bash
rtk curl -sS -I https://auth.eforge.xyz/
rtk curl -sS https://auth.eforge.xyz/ | rtk rg "<关键页面标识>"
```

### 方式 B：验证新域名后删除旧域名

只有确认 `auth.eforge.xyz` 完全可用，且没有外部依赖 `ai.eforge.xyz` 后才执行。

```bash
CF_AUTH_EMAIL="<cloudflare-email>" \
CF_GLOBAL_API_KEY="<global-api-key>" \
CF_SOURCE_CUSTOM_DOMAIN="ai.eforge.xyz" \
CF_CUSTOM_DOMAIN="auth.eforge.xyz" \
CF_DELETE_SOURCE_CUSTOM_DOMAIN=true \
CF_REPLACE_CONFIRM="ai.eforge.xyz->auth.eforge.xyz" \
node scripts/cloudflare/workers_custom_domain_bind.mjs
```

删除旧域名是破坏性操作。执行前必须确认：

```text
1. auth.eforge.xyz 已返回 HTTP/2 200。
2. auth.eforge.xyz 页面内容与 ai.eforge.xyz 一致。
3. GitHub、Cloudflare、文档和所有外部入口已改用 auth.eforge.xyz。
4. 没有 OAuth callback、Webhook、第三方配置、用户书签或历史链接依赖 ai.eforge.xyz。
```

## 最小配置策略

为了降低认知负担，推荐把变量分成两类。

日常新增域名只需要：

```text
CF_AUTH_EMAIL
CF_GLOBAL_API_KEY
CF_SOURCE_CUSTOM_DOMAIN
CF_CUSTOM_DOMAIN
```

只有多账号、多 zone、特殊 Worker 名称、或需要删除旧域名时才加：

```text
CF_ACCOUNT_ID
CF_ZONE_ID
CF_WORKER_SERVICE
CF_WORKER_ENVIRONMENT
CF_DELETE_SOURCE_CUSTOM_DOMAIN
CF_REPLACE_CONFIRM
```

## 本次没有直接执行的操作

本次只做研究、脚本增强和幂等验证，没有把 `auth.eforge.xyz` 绑定到 Worker，也没有删除 `ai.eforge.xyz`。

原因：

```text
域名更换属于线上入口变更。
安全路径应先确认用户希望执行“新增绑定”还是“新增后删除旧绑定”。
```

如果后续执行，优先执行“方式 A：新增绑定”，验证无误后再决定是否删除旧域名。
