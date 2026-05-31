# eshop 部署踩坑记录与操作手册

## 一、踩过的坑（血泪教训）

### 坑1: node_modules 路径损坏
- **现象**: `Error: Cannot find module '/Users/.../eshop/node_modules/wrangler-dist/cli.js'`
- **原因**: 复制项目目录时连带复制了 `node_modules`，内部软链接指向旧位置
- **解决**: `rm -rf node_modules && npm install`，**不要复制 node_modules**

### 坑2: system_config 缺少 offline_pay_hint 默认值
- **现象**: smoke-readonly 失败，`system_config` 返回空对象
- **原因**: schema.sql 中缺少 `offline_pay_hint` 初始数据
- **解决**: 在 deploy-full.mjs 的 `insertSystemConfig` 中添加该 INSERT

### 坑3: Drizzle-zod 生成的 Schema 缺少数据库默认值
- **现象**: POST `/api/admin/products` 返回 400 验证失败
- **原因**: Drizzle schema 的 `createdAt` 有 `notNull()` 但没有 `.default()`，drizzle-zod 认为是必填
- **解决**: 所有有 SQL `DEFAULT` 的字段，在 Drizzle schema 中同步声明 `.default()`

### 坑4: D1 CHECK 约束缺少 'locked' 状态
- **现象**: 创建 manual 订单时 500，`CHECK constraint failed`
- **原因**: `cards` 表的 CHECK 约束只允许 `('available', 'issued', 'disabled')`，但业务代码使用了 `'locked'`
- **解决**: 修改 CHECK 约束为 `IN ('available', 'issued', 'disabled', 'locked')`

### 坑5: 幂等键 saveIdempotentResponse 使用 UPDATE 而非 UPSERT
- **现象**: 重复请求创建两个订单，幂等性失效
- **原因**: `saveIdempotentResponse` 用 `orm.update()` 更新不存在的记录，0 行静默失败
- **解决**: 改为 `INSERT ... ON CONFLICT(key, action) DO UPDATE SET`（UPSERT）

### 坑6: wrangler deploy --custom-domain 参数名变更
- **现象**: `[ERROR] Unknown arguments: custom-domain`
- **原因**: Wrangler 4.x 中 `--custom-domain` 已改为 `--domains`
- **解决**: 使用 `npx wrangler deploy --domains eshop.eforge.xyz`

### 坑7: Cloudflare Workers Static Assets html_handling 陷阱
- **现象**: `/admin` 被 307 重定向到 `/`
- **原因**: `html_handling` 默认 `"auto"` 导致 Static Assets 截获了 `/admin` 路径
- **解决**: `wrangler.jsonc` 中设置 `"html_handling": "none"`

### 坑8: GitHub Actions YAML if 条件运算符优先级
- **现象**: Turso 模式下 D1 backup job 仍然执行
- **原因**: `if: ${{ inputs.provider || 'd1' == 'd1' }}` 中 `==` 优先级高于 `||`
- **解决**: **始终用括号**包裹 `||` 和 `&&` 组合

### 坑9: Turso CLI 不是 npm 包
- **现象**: `npx turso` 报 "package not found"
- **原因**: `@turso/cli` npm 包不存在，Turso CLI 只能通过 shell 安装脚本
- **解决**: `curl -sSfL https://get.tur.so/install.sh | bash`

### 坑10: eforge.xyz 域名未在 Resend 验证
- **现象**: 所有邮件 403 `"Domain eforge.xyz is not verified"`
- **原因**: Resend 要求发件域名必须先验证
- **解决**: 在 Resend Dashboard → Domains → Add Domain → 添加 SPF/DKIM/MX DNS 记录 → Verify

### 坑11: RESEND_API_KEY 和 EMAIL_FROM 未配置为 Workers Secrets
- **现象**: 部署后邮件静默跳过（`sendEmail` 返回 `"邮件服务未配置"`）
- **原因**: Workers Secrets 必须手动配置，不会随代码部署自动设置
- **解决**: `echo "xxx" | npx wrangler secret put RESEND_API_KEY` 和 `EMAIL_FROM`

### 坑12: pay.ts callback 和 admin.ts mark-paid 遗漏 EMAIL_FROM
- **现象**: 部署后邮件发件人地址无法通过环境变量自定义
- **原因**: `markPaidAndIssue` 签名增加 `EMAIL_FROM` 后，两个调用方没有同步更新
- **解决**: 全局搜索 `markPaidAndIssue` 所有调用方，确保传入 `EMAIL_FROM`

### 坑13: 旧模板目录与模板变量命名不一致
- **现象**: 两套模板变量名不同（snake_case vs camelCase），代码传的 camelCase 无法替换旧模板
- **原因**: 早期模板用 HTML 文件（snake_case），后迁移到 TypeScript 导出（camelCase），旧文件未清理
- **解决**: 删除旧 `src/templates/` 目录，统一使用 `src/services/templates/`

---

## 二、脚本执行顺序（严格按此顺序）

```
┌─────────────────────────────────────────────────────────────────┐
│                 eshop 部署流程（8步）                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  第1步: 01-check.mjs            结构检查（文件、配置、迁移）      │
│    ↓                                                            │
│  第2步: 02-deploy-full.mjs      完整部署（D1/Turso → deploy）    │
│    ↓                                                            │
│  第3步: 03-bind-domain.mjs      绑定自定义域名                    │
│    ↓                                                            │
│  第4步: 04-smoke-readonly.mjs   只读冒烟测试                      │
│    ↓                                                            │
│  第5步: 05-smoke-admin.mjs      管理端冒烟测试                    │
│    ↓                                                            │
│  第6步: 06-smoke-write.mjs      写入冒烟测试                      │
│    ↓                                                            │
│  第7步: 07-verify-domain.mjs    域名 HTTPS 握手验证               │
│    ↓                                                            │
│  第8步: 08-setup-local.sh       本地一键部署（编排 01-07）        │
│                                                                 │
│  配置类（首次部署后按需执行）:                                     │
│  09-configure-github.sh         GitHub Actions 配置（主力）       │
│  10-setup-github.sh             GitHub 配置（含支付/邮件 Secrets）│
│  11-setup-resend.sh             Resend API Key 配置               │
│                                                                 │
│  运维类（日常维护）:                                              │
│  12-ops-maintenance.sh          运维工具集（备份/导出/轮换/清理）  │
│  13-apply-turso-migrations.sh   Turso 迁移                        │
│                                                                 │
│  快速更新（已有环境）:                                            │
│  02-deploy-full.mjs --skip-secrets                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、凭证存储位置

```
eshop/
├── .dev.vars               # 本地开发环境变量（git 不会跟踪）
│   ├── ADMIN_TOKEN
│   ├── RESEND_API_KEY
│   ├── EMAIL_FROM
│   ├── TURSO_URL
│   └── TURSO_AUTH_TOKEN
├── .dev.vars.example       # 模板文件（提交到 git，不含真实值）
└── Workers Secrets         # 生产环境（wrangler secret put）
│   ├── ADMIN_TOKEN
│   ├── RESEND_API_KEY
│   ├── EMAIL_FROM
│   ├── TURSO_URL
│   └── TURSO_AUTH_TOKEN
```

---

## 四、脚本清单

| 序号 | 脚本名 | 用途 | 输入 | 输出 |
|------|--------|------|------|------|
| 01 | `01-check.mjs` | 静态结构检查 | 无 | 依赖状态 |
| 02 | `02-deploy-full.mjs` | 完整远程部署 | `CLOUDFLARE_API_TOKEN`, `ADMIN_TOKEN` | Worker URL |
| 03 | `03-bind-domain.mjs` | Workers Custom Domain 绑定 | `CF_API_TOKEN` 或 `CLOUDFLARE_API_TOKEN` | 域名绑定 |
| 04 | `04-smoke-readonly.mjs` | 只读冒烟测试 | `BASE_URL` | 测试结果 |
| 05 | `05-smoke-admin.mjs` | 管理端冒烟测试 | `ADMIN_TOKEN`, `BASE_URL` | 测试结果 |
| 06 | `06-smoke-write.mjs` | 写入冒烟测试 | `BASE_URL`, `ADMIN_TOKEN` | 测试结果 |
| 07 | `07-verify-domain.mjs` | 域名 HTTPS 验证 | `BASE_URL` | 验证结果 |
| 08 | `08-setup-local.sh` | 本地一键部署（编排 01-07） | `CLOUDFLARE_API_TOKEN` | 部署完成 |
| 09 | `09-configure-github.sh` | GitHub Actions 配置（主力精简版） | `CLOUDFLARE_API_TOKEN`, `ADMIN_TOKEN` | Secrets/Variables |
| 10 | `10-setup-github.sh` | GitHub 配置（含可选支付/邮件 Secrets） | 所有凭证 | Secrets/Variables |
| 11 | `11-setup-resend.sh` | Resend API Key 配置 | `RESEND_API_KEY` | Worker Secret |
| 12 | `12-ops-maintenance.sh` | 运维工具集 | 按子命令不同 | 备份/导出/轮换 |
| 13 | `13-apply-turso-migrations.sh` | Turso 迁移 | `TURSO_URL`, `TURSO_AUTH_TOKEN` | 迁移结果 |

### 辅助文件

| 文件 | 用途 |
|------|------|
| `http-client.mjs` | Smoke 测试共享 HTTP 客户端（内部依赖） |

---

## 五、故障排查

### 问题: API 返回 400 / 500
```bash
# 检查 secrets 是否上传
npx wrangler secret list

# 检查数据库是否初始化
npx wrangler d1 execute eshop-db --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

### 问题: 域名无法访问
```bash
# 检查 DNS 解析
dig eshop.eforge.xyz

# 检查 Worker 绑定
node scripts/07-verify-domain.mjs
```

### 问题: 邮件发送失败
```bash
# 检查 Resend 域名验证
curl -s -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"eshop <noreply@eforge.xyz>","to":"test@resend.dev","subject":"测试","html":"<p>ok</p>"}'

# 检查 Workers Secrets
npx wrangler secret list  # 确认 RESEND_API_KEY 和 EMAIL_FROM
```

### 问题: 管理端返回 503
```bash
# 检查 ADMIN_TOKEN 是否配置
npx wrangler secret list | grep ADMIN_TOKEN

# 轮换 token
bash scripts/12-ops-maintenance.sh rotate-admin-token
```