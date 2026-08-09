# 031 cf-core 0.4.17 同步与 VPS 部署踩坑记录

> 日期：2026-08-07  
> 范围：`cf-auth` 同步 `@usethink/cf-core@0.4.17`、GitHub 推送、VPS 运行包部署、nginx 反代 IP 头修复。  
> 生产域名：`https://auth.eforge.xyz`  
> VPS SSH 别名：`jp_sub`  

## 1. 已确认事实

- npm registry 存在 `@usethink/cf-core@0.4.17`。
- 本地 `package.json` 依赖为 `@usethink/cf-core: ^0.4.17`。
- 本地 `package-lock.json` 锁定 `node_modules/@usethink/cf-core.version = 0.4.17`。
- GitHub `origin/main` 已推送到 `5ba9864`。
- VPS 运行目录是 `/root/cf-auth`，不是文档旧示例里的 `/opt/cf-auth`。
- VPS systemd 服务为 `cf-auth.service`，当前执行：
  - `WorkingDirectory=/root/cf-auth`
  - `EnvironmentFile=/root/cf-auth/.env`
  - `ExecStart=/root/.nvm/versions/node/v24.18.0/bin/node /root/cf-auth/dist/server.js`
- VPS 当前运行包中：
  - `package.json` 为 `@usethink/cf-core: ^0.4.17`
  - `package-lock.json` 锁定 `0.4.17`
  - `node_modules/@usethink/cf-core/package.json.version = 0.4.17`
- 线上 `GET https://auth.eforge.xyz/api/health` 返回 `ok:true`、`db:true`、`adminConfigured:true`。
- 无凭证 `GET https://auth.eforge.xyz/api/admin/health` 返回 `401`，符合管理面必须管理员鉴权的预期。

## 2. 本次实际踩坑

### 2.1 VPS 代码目录不是干净工作区

VPS `/root/cf-auth` 当时停在旧提交 `fa9f8fd`，并且有未提交修改和未跟踪文件：

- `package.json` / `package-lock.json` 仍是 `0.4.16`
- 有未提交 docs、pnpm 文件、备份目录、脚本等

处理方式：没有执行 `git reset`，也没有覆盖远端未提交源码；只部署运行时文件 `dist/`、`public/`、`package.json`、`package-lock.json`，并备份旧运行时包到 `/root/cf-auth-runtime-backups/`。

### 2.2 SSH 在长命令中途断开

两次远端长命令在执行过程中出现：

```text
Connection to 38.47.198.72 closed by remote host.
```

后续短命令可以正常连接，说明不是密钥失效。实际部署状态必须重连后逐项核验，不能凭一次命令失败就判断部署失败。

核验方式：

```bash
ssh jp_sub 'cd /root/cf-auth; node -p "require(\"./node_modules/@usethink/cf-core/package.json\").version"'
ssh jp_sub 'systemctl is-active cf-auth'
curl -sS https://auth.eforge.xyz/api/health
```

### 2.3 Better Auth IP 限流退化

重启后日志出现：

```text
WARN [Better Auth]: Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket.
```

这是安全问题：认证库无法识别客户端 IP 时，会把限流退化为共享桶，可能误伤正常用户，也降低按 IP 防滥用效果。

已做两处修复：

1. `src/lib/auth.ts` 配置 Better Auth 读取代理头：
   - `cf-connecting-ip`
   - `x-real-ip`
   - `x-forwarded-for`
   - 信任本机反代：`127.0.0.1`、`::1`

2. nginx `location /` 内显式设置代理头：
   - `Host`
   - `X-Real-IP`
   - `X-Forwarded-For`
   - `X-Forwarded-Proto`

关键原因：nginx 中只要 `location` 里出现任意 `proxy_set_header`，就不会继承 `server` 级的 `proxy_set_header`。原配置在 `location /` 里只有：

```nginx
proxy_set_header Connection "";
```

因此上层 `server` 里的 `X-Forwarded-For` / `X-Real-IP` 实际没有传到 Node。

修复后验证：

```bash
nginx -t
systemctl reload nginx
curl -sS https://auth.eforge.xyz/api/auth/get-session
journalctl -u cf-auth --since "2026-08-07 13:33:38 UTC" --no-pager
```

nginx reload 后日志无新增 Better Auth IP 告警。

## 3. 本次提交

- `0885016`：升级 `@usethink/cf-core` 到 `0.4.17` 并提交根 `package-lock.json`
- `c5725b3`：在 Better Auth 中配置反代 IP 头，避免认证限流共享桶
- `5ba9864`：把 nginx `proxy_set_header` 放入 `location /`

## 4. 验证记录

本地：

```bash
npm run type-check
npm test
npm run type-check --prefix frontend
npm run build --prefix frontend
npm audit --omit=dev --prefix frontend
```

结果：

- 后端类型检查通过
- 后端全量测试：`17 passed`，`99 passed | 1 skipped`
- 前端类型检查通过
- 前端生产构建通过
- 前端 npm audit：`0 vulnerabilities`

根项目 npm audit：

```text
@better-auth/oauth-provider 1.4.8 - 1.7.0-beta.3
Severity: moderate
GHSA-p2fr-6hmx-4528
No fix available
```

当前使用 `@better-auth/oauth-provider@1.6.25`，npm audit 显示暂无可用修复版本。上线时必须把 OAuth audience/resource indicator 行为作为剩余风险关注，等上游发布修复版本后优先升级。

VPS/线上：

```bash
ssh jp_sub 'systemctl is-active cf-auth'
ssh jp_sub 'cd /root/cf-auth; node -p "require(\"./node_modules/@usethink/cf-core/package.json\").version"'
curl -sS https://auth.eforge.xyz/api/health
curl -sS -o /tmp/cf-auth-admin-health.body -w "%{http_code}\n" https://auth.eforge.xyz/api/admin/health
```

结果：

- `cf-auth.service` 为 `active`
- VPS `@usethink/cf-core` 为 `0.4.17`
- `/api/health` 为 `200` 且 `ok:true`
- 无凭证 `/api/admin/health` 为 `401`
- `/sign-in` 为 `200`
- `/admin` 为 `200`

## 5. 后续注意事项

- 不要在 VPS `/root/cf-auth` 上直接 `git reset`；该目录已有远端未提交内容。需要先整理或迁移远端变更。
- 运行包部署前要备份 `dist/`、`public/`、`package.json`、`package-lock.json`。
- 更新运行包后必须分别核验：
  - `package-lock.json` 中的 `@usethink/cf-core`
  - `node_modules/@usethink/cf-core/package.json.version`
  - `systemctl is-active cf-auth`
  - 线上 `/api/health`
- nginx 模板和 VPS 生效配置必须同步；尤其不能只在 `server` 级设置 `X-Forwarded-For`，只要 `location` 内有 `proxy_set_header`，就必须在同一个 `location` 内重复设置全部必要代理头。
- 如果再看到 Better Auth `Rate limiting could not determine a client IP` 告警，优先检查 nginx 生效配置，而不是先怀疑应用代码。
