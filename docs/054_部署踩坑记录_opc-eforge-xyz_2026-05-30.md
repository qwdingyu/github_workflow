# 054_部署踩坑记录_opc-eforge-xyz_2026-05-30.md

# 部署踩坑记录：opc.eforge.xyz（freelancer-calc）

> 日期：2026-05-30
> 项目：freelancer-calc（自由职业计算器）
> 域名：opc.eforge.xyz
> 部署模式：Cloudflare Pages

---

## 一、部署结果

### 已完成

| 步骤 | 状态 | 详情 |
|------|------|------|
| 配置更新 | ✅ | siteUrl → opc.eforge.xyz，name → opc-eforge-xyz |
| 页面生成 | ✅ | 15 个页面（8 工具 + 5 博客 + 首页 + sitemap + robots.txt） |
| Step 00: 项目初始化 | ✅ | GitHub 仓库 https://github.com/qwdingyu/freelancer-calc |
| Step 03: 部署 | ✅ | Pages URL: https://freelancer-calc.pages.dev (HTTP 200) |
| Step 04: 域名绑定 | ❌ | API Token 缺少 Zone DNS 权限 |
| Step 06: GitHub Actions | ✅ | Workflows + Secrets + Variables 配置成功 |

### 当前状态

- ✅ Pages 默认域名可访问：https://freelancer-calc.pages.dev
- ❌ 自定义域名不可访问：https://opc.eforge.xyz (HTTP 502)

---

## 二、问题 1：04-bind-domain.sh 不支持 Pages 模式

### 现象

部署脚本 Step 04 失败，域名绑定未完成。

### 根因

`04-bind-domain.sh` 原本只支持 Workers 模式（Workers Custom Domain API），不支持 Pages 模式（Pages Custom Domain API + Zone DNS CNAME 记录）。

### 修复

重写 `04-bind-domain.sh`，添加：

1. **部署模式检测**：`detect_deploy_mode` 判断 workers/pages
2. **Pages 模式流程**：
   - 添加域名到 Pages 项目（Pages Custom Domain API）
   - 创建 Zone DNS CNAME 记录（Zone DNS API）→ 指向 `<project>.pages.dev`
   - 自动删除冲突的 A 记录
3. **Workers 模式流程**：保持原有 Workers Custom Domain API 逻辑
4. **Token 权限预检**：部署前验证 Token 是否有 Zone DNS 权限，不足时给出明确的权限配置指引
5. **SSL 等待逻辑**：轮询 HTTPS 可用性，支持更长等待时间（36 次 × 5 秒 = 180 秒）

### 同步状态

已同步到全部 7 份副本（MD5: `b1f091e39f6aa5be1d9fe221bdcc0e5e`）：
- `templates/.deploy/04-bind-domain.sh`（共享源）
- `templates/cf-shop/.deploy/04-bind-domain.sh`
- `templates/cf-api/.deploy/04-bind-domain.sh`
- `templates/cf-tools/.deploy/04-bind-domain.sh`
- `templates/cf-static/.deploy/04-bind-domain.sh`
- `templates/cf-form/.deploy/04-bind-domain.sh`
- `freelancer-calc/.deploy/04-bind-domain.sh`

---

## 三、问题 2：API Token 缺少 Zone DNS 权限

### 现象

```
❌ Token 缺少 Zone DNS 权限
错误信息: Authentication error
HTTP Code: 403
```

### 根因

当前 API Token 只有以下权限：
- Account > Cloudflare Workers > Edit
- Account > Cloudflare Pages > Edit

缺少：
- **Zone > DNS > Edit**（创建 CNAME 记录必需）
- Zone > Zone > Read（查询 Zone 信息必需）

### 解决方案

更新 API Token 权限（一次性操作，之后所有部署自动完成）：

1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 找到当前使用的 Token，点击右侧 `...` > `Edit`
3. 在 Permissions 中添加：

```
Zone → DNS → Edit
Zone → Zone → Read
```

4. 保存后重新运行：

```bash
cd /Users/dingyuwang/0-X/freelancer-calc
CLOUDFLARE_API_TOKEN="新token" DOMAIN="opc.eforge.xyz" ONLY=04 bash .deploy/one-click.sh
```

---

## 四、问题 3：Pages Custom Domain API 不自动创建 DNS

### 现象

Pages 域名状态为 `pending`，错误信息：`CNAME record not set`

### 根因

Cloudflare Pages Custom Domain API 只注册域名到项目，**不会自动创建 Zone DNS CNAME 记录**。必须通过 Zone DNS API 单独创建。

这是 Cloudflare 的设计：Pages API 和 Zone DNS API 是分离的，需要两步操作：
1. Pages API：注册域名到项目（触发 SSL 证书签发）
2. Zone DNS API：创建 CNAME 记录（让域名解析到 Pages）

### 修复

新脚本 `04-bind-domain.sh` 已包含两步操作，但需要 Token 有 Zone DNS 权限。

---

## 五、JSON 中文引号导致的解析错误

### 现象

```
SyntaxError: Expected ',' or '}' after property value in JSON at position 553
```

### 根因

中文博客内容中使用了中文双引号 `"工资"`，在 JSON 字符串中被解析为 JSON 引号，导致解析错误。

### 修复

将所有中文双引号 `"..."` 替换为中文方括号引号 `「...」`。

涉及文件：
- `src/tools/income-planner.json`
- `src/posts/freelance-emergency-fund.json`
- `src/posts/freelance-invoicing-best-practices.json`

### 教训

在 JSON 内容中使用中文标点时，避免使用与 JSON 语法冲突的引号字符。推荐使用 `「」` 或 `『』`。

---

## 六、铁律补充

基于本次踩坑，新增以下铁律：

**铁律 14：API Token 权限必须在部署前验证**
- 部署脚本必须在 Step 00 或 Step 04 之前验证 Token 权限
- 权限不足时立即退出并给出明确的权限配置指引
- 不要等到 API 调用失败才发现问题

**铁律 15：部署脚本必须支持所有部署模式**
- workers / pages / hybrid 三种模式都要测试
- 新增功能时，检查是否对三种模式都有影响
- Pages 和 Workers 的 API 完全不同，不能混用

**铁律 16：修改部署脚本必须同步所有副本**
- `templates/.deploy/` 是共享源
- 5 个模板的 `.deploy/` 是副本
- 修改后必须用 MD5 校验确认一致性

---

## 七、后续行动

1. 更新 API Token 添加 Zone DNS 权限
2. 重新运行 `ONLY=04 bash .deploy/one-click.sh`
3. 验证 https://opc.eforge.xyz 可访问
