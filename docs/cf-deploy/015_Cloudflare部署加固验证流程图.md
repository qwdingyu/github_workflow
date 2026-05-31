# Cloudflare 部署加固验证流程图

## 背景

这次从 GitHub、Cloudflare Pages、Workers、D1、DNS、WAF、安全脚本一路跑下来，真正有价值的不是某一条命令，而是完整流程：

```text
判断项目类型
-> 选择部署车道
-> 绑定域名
-> 验证 HTTPS
-> 配置 WAF
-> 验证危险路径
-> 验证业务接口
-> 记录踩坑
-> 提交推送
```

本文用流程图固化这套经验。后续新项目不要重新摸索，直接按图执行。

## 是否需要删除 Cloudflare 资源重建

结论：

```text
当前没有必要删除已托管内容再重新部署。
```

原因：

```text
1. ai.eforge.xyz、acctbox.eforge.xyz、tool.eforge.xyz、shop.eforge.xyz 都已 HTTP 200。
2. 四个域名已经合并到同一套 WAF 规则。
3. Workers 域名危险路径已返回 403。
4. Pages 域名切 proxied=true 后危险路径也返回 403。
5. 删除重建会引入新的 DNS、证书、Pages active、缓存、构建触发风险。
```

删除重建只适合以下情况：

```text
1. 项目名、仓库、Cloudflare project/service 对应关系完全错乱。
2. 误绑定到错误域名，且无法通过更新绑定修复。
3. 误泄露生产密钥，需要整体轮换并重建环境。
4. 资源状态损坏，Cloudflare API 和 Dashboard 都无法修复。
5. 明确做灾备演练，而且已经备份配置、DNS、D1、R2、Secrets。
```

流程图：

```mermaid
flowchart TD
  A[发现部署或安全问题] --> B{线上主入口是否可访问}
  B -->|可访问| C{能否用脚本/API 修复}
  C -->|能| D[修复配置并验证]
  C -->|不能| E{是否资源映射错乱或状态损坏}
  E -->|否| F[继续排查，不删除]
  E -->|是| G[备份配置和数据]
  G --> H[新建资源并灰度验证]
  H --> I{新资源验证通过}
  I -->|是| J[切换域名]
  I -->|否| K[回滚旧资源]
  B -->|不可访问| L[先查 DNS/证书/构建/WAF]
  L --> C
```

## 项目类型选择流程

```mermaid
flowchart TD
  A[新项目] --> B{是否纯静态}
  B -->|是| C[Cloudflare Pages 或 Workers Static Assets]
  B -->|否| D{是否少量 API/表单/轻量数据}
  D -->|是| E[Workers + Static Assets + D1/KV]
  D -->|否| F{是否重型服务或长连接/容器依赖}
  F -->|是| G[VPS/Dokploy/容器 + Cloudflare DNS/WAF]
  F -->|否| H[先按 Workers 轻量应用试点]
  E --> I{是否有文件资料下载}
  I -->|是| J[增加 R2 私有存储]
  I -->|否| K[D1/KV 即可]
```

当前实践映射：

| 项目 | 类型 | 车道 |
| --- | --- | --- |
| `ai.eforge.xyz` | Workers 静态/工具 | Workers Custom Domain |
| `acctbox.eforge.xyz` | Workers + Static Assets + D1 | 带存储轻量应用 |
| `tool.eforge.xyz` | Pages 静态工具 | Pages + CNAME |
| `shop.eforge.xyz` | Pages 落地页 | Pages + CNAME |

## Pages 标准流程

```mermaid
flowchart TD
  A[本地项目] --> B[独立 git 仓库]
  B --> C[推送 GitHub]
  C --> D[Cloudflare Pages 绑定 GitHub]
  D --> E[读取 project.subdomain]
  E --> F[创建 Pages custom domain]
  F --> G[创建 DNS-only CNAME]
  G --> H{Pages domain active}
  H -->|否| I[检查 CNAME target 和 GitHub App 权限]
  I --> H
  H -->|是| J[验证首页 HTTPS 200]
  J --> K[切换 CNAME proxied=true]
  K --> L[验证首页仍 200]
  L --> M[执行/更新 WAF 基线]
  M --> N[验证 /.env 403 和 /admin challenge]
```

关键命令：

```bash
CF_AUTH_EMAIL="<email>" \
CF_GLOBAL_API_KEY="<global-api-key>" \
CF_CUSTOM_DOMAIN="tool.eforge.xyz" \
rtk node ../scripts/cloudflare/pages_github_domain_workflow.mjs
```

Pages active 后切橙云：

```bash
CF_AUTH_EMAIL="<email>" \
CF_GLOBAL_API_KEY="<global-api-key>" \
CF_CUSTOM_DOMAIN="tool.eforge.xyz" \
CF_DNS_PROXIED=true \
rtk node ../scripts/cloudflare/pages_github_domain_workflow.mjs
```

坑点：

```text
1. 初始验证阶段，DNS-only 更稳。
2. WAF 生效阶段，必须 proxied=true。
3. 不要猜 <project>.pages.dev，必须读取 project.subdomain。
```

## Workers 标准流程

```mermaid
flowchart TD
  A[本地 Workers 项目] --> B[wrangler.jsonc 设置 name/main/assets]
  B --> C[本地 check/build]
  C --> D[git commit + push]
  D --> E[wrangler deploy 或 Workers Builds]
  E --> F[绑定 Workers Custom Domain]
  F --> G[Cloudflare 自动创建只读 AAAA 100::]
  G --> H[验证正式域名 HTTPS 200]
  H --> I[执行/更新 WAF 基线]
  I --> J[验证 /.env 403 和 /admin challenge]
```

关键命令：

```bash
CF_AUTH_EMAIL="<email>" \
CF_GLOBAL_API_KEY="<global-api-key>" \
CF_WORKER_SERVICE="acctbox" \
CF_CUSTOM_DOMAIN="acctbox.eforge.xyz" \
rtk node scripts/cloudflare/workers_custom_domain_bind.mjs
```

坑点：

```text
1. Workers Custom Domain 不是 Pages CNAME。
2. 不要手动改 Cloudflare 创建的 AAAA 100:: read_only 记录。
3. Workers Custom Domain 默认走 Cloudflare 代理层，WAF 可直接生效。
```

## WAF 合并规则流程

这是本次最重要的最佳实践之一。

不要为每个域名单独创建规则。免费层 WAF Custom Rules 数量有限，同一个 zone 下的多个域名应该合并到一套规则。

```mermaid
flowchart TD
  A[收集同一 zone 下的上线域名] --> B[区分 Workers 和 Pages]
  B --> C[确认 Workers Custom Domain 已可访问]
  B --> D[确认 Pages CNAME 已 proxied=true]
  C --> E[拼接 CF_TARGET_HOSTNAMES]
  D --> E
  E --> F[执行 security_baseline.mjs]
  F --> G[只生成 2 条 WAF 规则]
  G --> H[危险路径 block]
  G --> I[管理路径 managed_challenge]
  H --> J[逐域名验证 /.env 403]
  I --> K[逐域名验证 /admin challenge]
```

当前统一命令：

```bash
CF_TARGET_HOSTNAMES="acctbox.eforge.xyz,ai.eforge.xyz,tool.eforge.xyz,shop.eforge.xyz" \
CF_SECURITY_SCENARIO="app" \
CF_ENABLE_ZONE_SETTINGS=false \
CF_APPLY=true \
rtk node scripts/cloudflare/security_baseline.mjs
```

当前结果：

```text
规则集：f11832fb70494c2bbe5f6e566264fa70
规则数量：2
覆盖域名：acctbox、ai、tool、shop
```

## 安全验证流程

```mermaid
flowchart TD
  A[加固后验证] --> B[验证首页 200]
  B --> C[验证危险路径]
  C --> D{/.env 是否 403}
  D -->|是| E[危险路径 block 生效]
  D -->|否| F{域名是否经过 Cloudflare 代理}
  F -->|否| G[Pages CNAME 切 proxied=true]
  F -->|是| H[检查 WAF 表达式 host/path]
  G --> C
  H --> C
  E --> I[验证 /admin]
  I --> J{/admin 是否 challenge}
  J -->|是| K[管理路径保护生效]
  J -->|否| L[检查 admin path 配置]
  K --> M[验证业务 API/页面正常]
```

当前标准验证命令：

```bash
rtk curl -sS -I https://acctbox.eforge.xyz/
rtk curl -sS -I https://acctbox.eforge.xyz/.env
rtk curl -sS -I https://acctbox.eforge.xyz/admin

rtk curl -sS -I https://ai.eforge.xyz/
rtk curl -sS -I https://ai.eforge.xyz/.env
rtk curl -sS -I https://ai.eforge.xyz/admin

rtk curl -sS -I https://tool.eforge.xyz/
rtk curl -sS -I https://tool.eforge.xyz/.env
rtk curl -sS -I https://tool.eforge.xyz/admin

rtk curl -sS -I https://shop.eforge.xyz/
rtk curl -sS -I https://shop.eforge.xyz/.env
rtk curl -sS -I https://shop.eforge.xyz/admin
```

## 带存储项目流程

`acctbox` 这类带 D1 的项目，流程不能只看页面。

```mermaid
flowchart TD
  A[带存储项目开发] --> B[设计数据表]
  B --> C[写 migration]
  C --> D[准备演示 seed]
  D --> E[本地 migrate + seed]
  E --> F[本地 check]
  F --> G[本地/远程 verify]
  G --> H{是否需要验证写链路}
  H -->|是| I[运行 smoke-write]
  H -->|否| J[只读 verify 即可]
  I --> K[注意库存会减少]
  J --> L[部署]
  K --> L
  L --> M[远程 migrate]
  M --> N[远程 verify]
  N --> O[WAF/域名验证]
  O --> P[记录 D1 id、域名、脚本、踩坑]
```

标准：

```text
1. migration 进 Git。
2. seed 只能是演示数据。
3. verify 必须只读。
4. smoke-write 会改变数据，不能当日常巡检。
5. 真实业务必须补 backup/export。
```

## 故障分流流程

```mermaid
flowchart TD
  A[访问失败] --> B{首页是否 200}
  B -->|否| C{DNS 是否正确}
  C -->|否| D[修 DNS/CNAME/Custom Domain]
  C -->|是| E{证书或 TLS 是否异常}
  E -->|是| F[等证书/查代理状态/回滚 proxied]
  E -->|否| G[查 Pages/Workers 部署日志]
  B -->|是| H{危险路径是否 403}
  H -->|否| I{是否 proxied=true}
  I -->|否| J[切 proxied=true]
  I -->|是| K[查 WAF 规则表达式]
  H -->|是| L{业务 API 是否正常}
  L -->|否| M[查 Worker 日志/D1/代码]
  L -->|是| N[流程闭环]
```

## 每次变更闭环

```mermaid
flowchart TD
  A[代码或配置变更] --> B[同步 docs]
  B --> C[本地 check]
  C --> D[必要时线上 verify]
  D --> E[安全路径验证]
  E --> F[git add]
  F --> G[中文 Lore commit]
  G --> H[git push]
  H --> I[记录最终状态]
```

硬规则：

```text
1. 每次代码变更必须提交。
2. 脚本变量变更必须同步脚本头部注释和 docs/025。
3. Cloudflare 配置变更必须记录实际验证结果。
4. 发现坑必须写背景、原因、排查过程、解决方案、建议。
```

## 当前结论

```text
不删除现有 Cloudflare 托管内容。
保留现有成功资源。
用脚本做幂等修复、加固和验证。
把从零部署流程、现有项目加固流程、删除重建决策流程全部固化到文档。
```
