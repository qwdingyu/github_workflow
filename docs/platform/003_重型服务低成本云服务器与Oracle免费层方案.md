# 重型服务低成本云服务器与 Oracle 免费层方案

日期：2026-05-24

## 结论

对 `new-api` 这类重型服务，最优策略不是继续塞进 Cloudflare Workers/Vercel，而是走“低成本长驻主机”车道。

推荐顺序：

```text
第一选择：Oracle Cloud Always Free A1，能申请到就用
第二选择：Hetzner / Netcup / OVH 低价 VPS
第三选择：Contabo 高配置低价 VPS，但只放非关键或有备份的服务
第四选择：DigitalOcean / Vultr / Linode，价格更高但体验稳定
```

对 `new-api` 最推荐的低成本架构：

```text
Cloudflare DNS / HTTPS / WAF
-> Oracle A1 或低价 VPS
-> Docker Compose
-> new-api
-> SQLite volume 或 Supabase Postgres
-> R2 备份
-> Uptime curl 监控
```

Oracle 免费层值得尝试，但不能作为唯一兜底。它最大的问题不是配置不够，而是：

- 注册卡验证严格。
- A1 免费资源经常遇到容量不足。
- Always Free 计算资源可能因空闲被回收。
- Free Tier 没有 SLA，也没有完整工单支持。
- 误建非 Always Free 资源可能产生费用或 trial 到期被回收。

所以最终落地应该是：

```text
先申请 Oracle A1
能稳定拿到资源就跑 new-api
同时准备一套低价 VPS 迁移方案
所有数据每日备份到 R2
```

## new-api 的主机要求

`new-api` 属于 Docker 长驻服务。它至少需要：

- Linux 主机。
- Docker / Docker Compose。
- 持久化数据目录。
- 反向代理或 Cloudflare 入口。
- 数据库：SQLite、本机 MySQL/PostgreSQL，或远程 MySQL/PostgreSQL。
- 可选 Redis。
- 备份和恢复策略。

低负载个人使用建议：

```text
2 vCPU
2GB-4GB RAM
40GB+ disk
Docker Compose
SQLite volume
每日 R2 备份
```

如果要跑更多模型网关、日志、Redis、监控，建议：

```text
2-4 vCPU
4GB-8GB RAM
80GB+ disk
Postgres 或 Supabase Postgres
```

## Oracle Cloud Always Free 是否适合

适合。

尤其是 Ampere A1：

- 官方 Always Free 给到 3,000 OCPU hours/month 和 18,000 GB hours/month。
- 对 Always Free tenancy 等价于 4 OCPU + 24GB RAM。
- 可以做成 1 台大实例，也可以拆成多台小实例。
- 总 block volume Always Free 为 200GB。

这对 `new-api` 很够用。

更重要的是，`new-api` Docker 镜像已有 arm64 版本，例如 Docker Hub 上有 `latest-arm64`，GitHub package 也显示有 `linux/arm64` 镜像。因此 Oracle A1 的 ARM 架构不是天然阻塞点。

但必须注意：

```text
ARM 主机必须确认每个 Docker 镜像都有 arm64 版本。
new-api 本体可以，其他附属服务也要确认。
```

如果使用 SQLite 单容器，Oracle A1 很合适。

如果使用 MySQL/Postgres/Redis 多容器，也能跑，但要更认真地做内存和磁盘规划。

## Oracle Free Tier 官方限制

### 账号资格

Oracle 官方要求：

- 每人只允许一个 Oracle Cloud Free Trial 或 Always Free 账号。
- 禁止创建或尝试创建多个免费账号。
- 联系和账单信息必须准确、有效，并且在账号有效期间得到授权。
- 账号空闲 30 天或更久，可能被视为 abandoned，具备被暂停或终止的风险。

### 银行卡验证

Oracle 官方说明：

- 注册时多数用户需要手机号和信用卡/借记卡。
- Oracle 会用联系信息和信用卡/借记卡信息做身份验证。
- Oracle 可能周期性检查卡片有效性，造成临时 authorization hold。
- 这类授权保留通常由银行在 3-5 天内移除，不会形成实际收费。

Oracle 接受：

```text
credit cards
debit cards that function like credit cards
```

Oracle 不接受：

```text
debit cards with a PIN
virtual cards
single-use cards
prepaid cards
```

这就是申请时最常见的坑。

### 资源限制

Always Free Compute：

- AMD Micro：最多 2 台 `VM.Standard.E2.1.Micro`。
- Arm Ampere A1：每月 3,000 OCPU hours + 18,000 GB hours，等价 4 OCPU + 24GB RAM。
- 最多可创建到 4 台 A1 实例，取决于 OCPU、内存和 boot volume 分配。
- Always Free block volume 总计 200GB。

### 容量不足

Oracle 官方承认：

```text
out of host capacity
```

表示 home region 中 Always Free shape 暂时没有容量。处理方式：

1. 换 availability domain。
2. 等几天再试。
3. 升级 Pay As You Go 可获得更多容量类型。

实际落地含义：

```text
Oracle 免费 A1 不是随时都能开到。
```

### 空闲回收

Oracle 官方说明：Idle Always Free compute instances may be reclaimed。

Oracle 判定 7 天期间满足以下条件时可视为空闲：

- CPU utilization 95th percentile < 20%。
- Network utilization < 20%。
- Memory utilization < 20%，仅 A1 shapes。

这对个人低负载服务是风险点。

建议：

- 不要把 Oracle Always Free 当唯一生产节点。
- `new-api` 真实使用低时，要至少保持正常健康检查、日志、备份。
- 不要用无意义高负载脚本“骗活跃”，这不稳，也可能违反使用精神。
- 关键服务准备低价 VPS 迁移方案。

### 支持与 SLA

Oracle Free Tier：

- 没有 SLA。
- Always Free 用户不享受完整 Oracle Support。
- 有 Community support。

结论：

```text
可以用于个人项目和低负载服务。
不建议作为商业关键服务唯一主机。
```

## Oracle 申请流程

### 申请前准备

准备：

- 真实姓名。
- 可接收短信的手机号。
- 真实地址。
- 一张可做国际在线支付验证的实体信用卡，或像信用卡一样处理的实体借记卡。
- 不要使用虚拟卡、一次性卡、预付卡。
- 不要使用代理、虚假地址、乱填信息。

银行卡建议：

```text
优先实体信用卡
其次支持国际网络支付的实体借记卡
不要用虚拟卡/预付卡/一次性卡
```

申请前确认：

- 卡片支持 Visa/Mastercard/Amex 等国际网络。
- 银行没有关闭境外线上交易。
- 银行短信/3DS 验证可用。
- 卡内有少量余额用于临时授权保留。

### 注册步骤

1. 打开 Oracle Cloud Free Tier 官网。
2. 使用真实邮箱注册 Oracle 账号。
3. 填写真实国家/地区、姓名、地址、手机号。
4. 完成手机号验证。
5. 选择 home region。
6. 添加银行卡进行验证。
7. 注册成功后进入 OCI Console。

### home region 怎么选

非常重要。

Oracle 官方说明 Always Free compute 只能在 home region 中创建。

选择原则：

```text
优先选择离主要用户近的区域
其次选择 A1 容量相对容易开的区域
不要随意选，后续无法简单改 home region
```

如果主要入口走 Cloudflare，低负载场景下延迟不是第一矛盾；能稳定开到 A1 更重要。

### 创建 A1 实例建议

推荐起步：

```text
VM.Standard.A1.Flex
2 OCPU
12GB RAM
Ubuntu 22.04/24.04
Boot volume 80GB-100GB
```

原因：

- 对 `new-api` 足够。
- 不一次吃满 4C/24G，后续留余地。
- boot volume 不要小于实际数据和备份需求。

如果容量难抢：

```text
1 OCPU + 6GB RAM
```

先跑起来，再扩。

## new-api 在 Oracle A1 的部署建议

### 最小 Docker Compose

```yaml
services:
  new-api:
    image: calciumion/new-api:latest-arm64
    container_name: new-api
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - TZ=Asia/Shanghai
      - SESSION_SECRET=${SESSION_SECRET}
      - CRYPTO_SECRET=${CRYPTO_SECRET}
    volumes:
      - ./data:/data
```

注意：

- ARM 主机优先使用 `latest-arm64`。
- 如果官方多架构 `latest` 已正确匹配，也可以用 `latest`，但文档里建议显式标注架构。
- `SESSION_SECRET` 和 `CRYPTO_SECRET` 必须生成强随机值。
- `./data` 必须备份。

### Cloudflare 入口

推荐：

```text
api.eforge.xyz
-> Cloudflare DNS proxied
-> Oracle A1 public IP
-> Caddy / Nginx
-> localhost:3000
```

优先 Caddy：

```text
api.eforge.xyz {
  reverse_proxy 127.0.0.1:3000
}
```

如果不想暴露源站 IP，可后续使用 Cloudflare Tunnel，但第一版不要把部署复杂度拉高。

### 防护

必须做：

- 管理后台强密码。
- Cloudflare WAF 基础规则。
- 限制敏感路径访问。
- 关闭公开注册，除非明确需要。
- 配置用量限制。
- 定期清理日志。

### 备份

最低要求：

```text
每天 tar ./data
上传到 Cloudflare R2
保留 7-14 天
每次升级前手动备份一次
```

备份检查：

- 不能只备份脚本，要验证能恢复。
- 至少每月做一次恢复演练。

## 低价 VPS 备选

以下价格和规格按 2026-05-24 可核查公开页面整理。VPS 价格会受税费、机房、汇率、促销、库存、合同时长影响，下单前必须以官网最终结算页为准。

### 底价 VPS 推荐结论

如果目标是“成本低、性能够用、速度和稳定性不能太差”，推荐顺序如下：

```text
首选：Hetzner CX23 / CPX 系列
备选：OVHcloud VPS-1
欧洲低价高盘：Netcup VPS 500 G12
多地区低价：HostHatch NVMe 4GB
低成本但偏折腾：BuyVM 2GB/4GB Slice
只做非关键或有备份服务：Contabo
```

最适合 `new-api` 低负载的购买规格：

```text
最低可用：2 vCPU / 4GB RAM / 40GB disk
推荐起步：2-4 vCPU / 4GB-8GB RAM / 60GB+ disk
舒服运行：4 vCPU / 8GB RAM / 80GB+ disk
```

不要为了省每月 1-2 美元买 1GB 内存的小鸡来跑 `new-api`。Docker、日志、升级、压缩备份、临时构建都会吃内存。1GB 适合反代、探针、小脚本，不适合作为重型服务主机。

### 推荐清单

| 排名 | 服务商 | 推荐规格 | 公开价格口径 | 适合场景 | 主要风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | Hetzner | CX23：2 vCPU / 4GB / 40GB | 价格调整后德国/芬兰约 EUR 3.99/月起，不含 VAT；美国区域约 USD 4.99/月起 | 个人生产、小工具矩阵、`new-api` 低负载 | 亚洲访问延迟取决于区域；注册风控；价格已在 2026 年调整 |
| 2 | OVHcloud | VPS-1：4 vCore / 8GB / 75GB SSD | 法国官网显示 EUR 5.52/月起，不含 VAT | 想要大厂背景、较高配置、稳定低价 | 控制台体验一般；不同地区价格不同 |
| 3 | Netcup | VPS 500 G12：2 vCore / 4GB DDR5 ECC / 128GB NVMe | 官网显示 EUR 0.010/小时，支持按小时或 12 个月账单 | 欧洲低价长期服务、需要更大磁盘 | 位置买定后不能直接改；合同/取消规则要看清 |
| 4 | HostHatch | NVMe 4GB：2 AMD EPYC fair-share / 4GB / 20GB | 官网显示 USD 6/月起 | 需要更多全球区域、价格明确 | 磁盘偏小；库存和区域可用性要核查 |
| 5 | BuyVM | Slice 2048 或 4096 | 2GB 为 USD 7/月；4GB 为 USD 15/月 | 想要相对可预测性能、DDoS/大存储附加能力 | 2GB 对 `new-api` 偏紧；热门区域常缺货 |
| 6 | Contabo | Cloud VPS 10/20 | 官网最终结算为准；短期入门计划可能有一次性 setup fee | 测试、低负载、可随时迁移的服务 | 共享资源波动、I/O/CPU 稳定性要实测，不建议唯一生产 |

### 我的实际采购建议

对你的场景，最优选择不是买最便宜，而是买“便宜但不会浪费你时间”的主机：

```text
第一档：Oracle A1 免费
第二档：Hetzner CX23
第三档：OVHcloud VPS-1
第四档：Netcup VPS 500 G12
```

如果 Oracle A1 申请成功：

```text
Oracle A1 跑 new-api
Cloudflare 负责 DNS/HTTPS/WAF
R2 做备份
暂不购买 VPS
```

如果 Oracle A1 申请失败、开不出 A1、或者不想等容量：

```text
优先买 Hetzner CX23
如果需要更大内存/配置，买 OVHcloud VPS-1
如果主要在欧洲并且想要大磁盘，买 Netcup VPS 500 G12
```

如果应用面向中国大陆用户：

```text
不要只看价格。
优先测试东京、新加坡、洛杉矶、圣何塞、香港附近机房。
Cloudflare 可以优化入口和静态资源，但不能消除动态 API 到源站的物理延迟。
```

### 为什么不推荐纯底价年付小鸡做主力

很多低价年付 VPS 可以做到 USD 10-30/年，但它们适合：

- 跑 uptime 探针。
- 跑轻量脚本。
- 跑临时反向代理。
- 跑备用节点。
- 跑静态资源同步。

不适合做 `new-api` 主力，因为：

- 内存常见只有 512MB-2GB。
- CPU fair-share，长期稳定性不可控。
- 磁盘 I/O 可能波动。
- 续费价格、库存、商家长期可靠性不稳定。
- 出问题时排查成本高于省下的钱。

底价小鸡可以作为工具箱的一部分，但不要作为核心收入或核心账号服务的唯一节点。

### Hetzner

适合：

- 稳定低价。
- 欧洲、美国、部分亚洲区域用户，或可接受跨境线路。
- Docker 服务、小数据库、小型产品。

特点：

- 当前更应按 CX23/CAX11/CPX 等新系列核对价格。
- CX23 级别适合作为 `new-api` 低负载起步主机。
- CPX 系列通常比 CX 系列更适合需要更稳 CPU 的服务。
- 流量额度通常较大。
- Hetzner 已在 2026 年发布价格调整，购买前必须看实时价格。

建议：

```text
new-api 低负载：CX23 级别起步
多服务：4 vCPU / 8GB 更稳
```

### Netcup

适合：

- 欧洲低价 VPS。
- 更看重价格/配置。
- 能接受合同、账单和控制台体验差异。

注意：

- 看清合同周期、设置费、取消规则。
- 适合长期固定小服务。

### OVHcloud

适合：

- 想要大厂背景。
- 低价 VPS。
- 欧洲/北美区域。

特点：

- VPS-1 当前公开规格对个人开发者很有吸引力：4 vCore / 8GB / 75GB SSD。
- 适合 `new-api` 低负载和多个轻服务共用一台机器。
- 价格和规格经常调整，购买前以官网为准。

### Contabo

适合：

- 想用很低价格拿较大内存/磁盘。
- 非关键服务。
- 有备份、有迁移准备。

注意：

- 低价高配往往意味着共享和超售风险。
- I/O 和 CPU 稳定性需要自己验证。
- 近期 entry-level 短期合同可能有 setup fee。

建议：

```text
适合测试、低负载、可迁移服务。
不建议作为唯一关键生产主机。
```

### HostHatch

适合：

- 需要多地区选择。
- 想要明确低价月付。
- 可以接受 fair-share CPU。

建议：

```text
new-api 起步至少选 NVMe 4GB。
如果日志和数据多，单独规划对象存储或备份，不要依赖 20GB 小盘长期堆数据。
```

### BuyVM

适合：

- 小而稳定的服务。
- 需要附加 DDoS 防护或低价 block storage。
- 可以接受库存不稳定。

注意：

- 2GB Slice 对 `new-api` 只算勉强可用。
- 4GB Slice 性能更稳，但价格已经到 USD 15/月，性价比不如 Hetzner/OVH/Netcup。

### DigitalOcean / Vultr / Linode

适合：

- 需要稳定体验和清晰账单。
- 不想折腾便宜 VPS 的隐藏成本。
- 个人商业项目已经有少量收入。

缺点：

- 同等配置价格通常高于 Hetzner/Netcup/Contabo。

## 最优推荐组合

### 个人低负载但要长期跑

```text
Oracle A1 作为主机
Cloudflare 作为入口
R2 作为备份
Hetzner/Netcup 作为迁移兜底
```

### 不想被 Oracle 申请和容量折腾

```text
Hetzner CX/CPX 或 Netcup VPS
Cloudflare DNS/WAF
Docker Compose
R2 备份
```

### 要尽量大内存但不关键

```text
Contabo VPS
Cloudflare DNS/WAF
强制备份
准备迁移脚本
```

### 真正要稳定生产

```text
付费 VPS
Cloudflare
R2 备份
Uptime 监控
Supabase/Postgres 或本机 SQLite + 备份
```

不要把完全免费的 Oracle A1 作为唯一生产保障。

## Oracle 常见坑

### 坑 1：卡验证失败

原因：

- 使用虚拟卡。
- 使用预付卡。
- 使用一次性卡。
- 使用需要 PIN 的 debit card。
- 银行关闭境外线上交易。
- 账单信息与卡信息不一致。
- 使用代理/VPN 导致地区、手机号、卡片国家不一致。

处理：

- 换实体信用卡。
- 开启境外线上交易。
- 使用真实账单地址。
- 不使用代理。
- 不反复用错误信息申请。

### 坑 2：临时授权保留被误以为扣费

Oracle 官方说这是 authorization hold，通常 3-5 天银行会移除，不是实际收费。

处理：

- 等银行释放。
- 不要重复提交多次造成多个授权保留。

### 坑 3：A1 开不出来

原因：

- home region 没有 Always Free A1 容量。

处理：

- 换 availability domain。
- 等几天再试。
- 尝试更小规格。
- 付费 VPS 兜底。

### 坑 4：选错 home region

Always Free compute 只能在 home region 开。

处理：

- 注册前认真选。
- 不要只看离自己近，也要考虑容量。

### 坑 5：误开付费资源

处理：

- 只创建标有 Always Free Eligible 的资源。
- 创建前看 shape。
- 不开非 Always Free 镜像。
- 不额外创建付费 block volume/load balancer。
- 设置预算告警。
- 免费试用期内不要乱开大规格资源。

### 坑 6：Free Trial 到期资源被回收

Oracle 官方说明，Free Trial 付费资源到期未升级可能被 reclaim，且不可恢复。

处理：

- 只依赖 Always Free 标记资源。
- Trial 到期前检查资源是否超出 Always Free。
- A1 总量必须控制在 4 OCPU/24GB RAM 内。

### 坑 7：空闲资源被回收

低负载服务可能被判定 idle。

处理：

- 真实运行服务。
- 做正常健康检查。
- 定期登录和检查。
- 不把它作为唯一生产主机。

## 极致省钱但不失控的方案

### 第 1 阶段：申请 Oracle

```text
申请 Oracle Free Tier
选择 home region
创建 A1 2C/12G
部署 new-api
绑定 Cloudflare 子域名
配置 R2 备份
```

### 第 2 阶段：稳定性观察

观察 7-14 天：

- 是否被回收。
- 是否重启。
- 延迟是否可接受。
- Docker 是否稳定。
- 备份是否正常。
- 登录和 API 是否正常。

### 第 3 阶段：准备迁移兜底

准备：

- `docker-compose.yml`。
- `.env.example`。
- `backup.sh`。
- `restore.sh`。
- Caddyfile。
- 迁移文档。

确保：

```text
拿到任意低价 VPS 后 30 分钟内能恢复 new-api。
```

### 第 4 阶段：付费兜底

如果 Oracle 不稳定：

```text
迁移到 Hetzner / Netcup / OVH
Cloudflare DNS 切换 A 记录
R2 恢复数据
curl 验证
docs 记录
```

## 最终决策

对于你的情况：

```text
轻量应用：Cloudflare Workers 应用工厂
产品型单体：Vercel/Next.js 或 Cloudflare + Supabase/Turso
重型服务：Oracle A1 优先尝试，低价 VPS 兜底
```

`new-api` 这类服务最优路线：

```text
先用 Oracle A1 免费资源尝试
但从第一天就按可迁移设计
备份到 R2
Cloudflare 做入口
准备 Hetzner/Netcup/OVH 迁移方案
```

这比直接买昂贵云服务器省钱，也比把重服务硬塞进 serverless 平台靠谱。

## 官方参考

- Oracle Cloud Free Tier FAQ: https://www.oracle.com/cloud/free/faq/
- Oracle Always Free Resources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Oracle Cloud Free Tier Docs: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm
- Docker Hub new-api arm64 image: https://hub.docker.com/r/calciumion/new-api/tags
- QuantumNous new-api README: https://github.com/QuantumNous/new-api/blob/main/README.md
- Hetzner Cloud pricing: https://www.hetzner.com/cloud/
- Netcup VPS: https://www.netcup.com/en/server/vps
- OVHcloud VPS: https://www.ovhcloud.com/fr/vps
- HostHatch pricing: https://hosthatch.com/pricing
- BuyVM KVM slices: https://www.buyvm.net/kvm-dedicated-server-slices/
- Contabo VPS: https://contabo.com/en/vps/
- Contabo setup fee note: https://help.contabo.com/en/support/solutions/articles/103000398194-why-is-there-a-setup-fee-on-my-cloud-vps-10-order-
