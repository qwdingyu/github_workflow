#!/usr/bin/env node
/**
 * Turnstile Widget 全自动配置脚本
 *
 * 用途：
 *   1. 通过 Cloudflare API 自动创建 Turnstile Widget
 *   2. 将 Site Key 写入 D1 数据库 system_config 表
 *   3. 将 Secret Key 设置为 Worker Secret（TURNSTILE_SECRET_KEY）
 *   4. 验证配置结果
 *
 * 用法：
 *   node scripts/14-setup-turnstile.mjs
 *
 * 注意：
 *   - Cloudflare API Token 内置在脚本中，无需额外设置
 *   - 如果 Widget 已存在，会先删除再重建（幂等）
 *   - Secret Key 通过 wrangler secret put 设置，不会写入文件
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const https = await import("node:https");

// ── 内置配置 ──────────────────────────────────────────────────────────────────
const CF_API_TOKEN = "cfat_ue16s4yVUHOfR8iwkrSfY7oJNU2QPggwyQVMO6DE6e5258c6";
const WORKER_NAME = "eshop";
const DATABASE_NAME = "eshop-db";
const WIDGET_NAME = "eshop Turnstile Widget";
const WIDGET_DOMAINS = ["eshop.mailforwdy.com", "localhost", "127.0.0.1"];
const WIDGET_MODE = "non-interactive"; // non-interactive | managed | interactive

process.env.CLOUDFLARE_API_TOKEN = CF_API_TOKEN;

// ── 工具函数 ──────────────────────────────────────────────────────────────────
function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

/**
 * 调用 Cloudflare API
 * 鉴权方式：Authorization: Bearer {API_TOKEN}
 * 注意：cfat_ 开头的是 API Token，必须用 Bearer 方式，不能用 X-Auth-Email/X-Auth-Key
 */
function cfApi(method, path, body) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.cloudflare.com",
      path: `/client/v4${path}`,
      method,
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let json;
        try { json = JSON.parse(raw); }
        catch { reject(new Error(`Invalid JSON from Cloudflare ${method} ${path}`)); return; }
        if (!json.success) {
          const msgs = (json.errors || []).map(e => e.message).join("; ");
          reject(new Error(`Cloudflare API ${method} ${path} failed: ${msgs}`));
          return;
        }
        resolve(json);
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── 步骤 0: 获取 Account ID ──────────────────────────────────────────────────
async function getAccountId() {
  console.log("→ 获取 Account ID...");
  const resp = await cfApi("GET", "/accounts");
  const accounts = resp.result || [];
  if (accounts.length === 0) throw new Error("未找到 Cloudflare Account");
  const account = accounts[0];
  console.log(`  Account: ${account.name} (${account.id})`);
  return account.id;
}

// ── 步骤 1: 创建 Turnstile Widget ────────────────────────────────────────────
/**
 * 正确 API 端点：/accounts/{id}/challenges/widgets
 *
 * 踩坑记录：
 * - /accounts/{id}/turnstile/widgets     ❌ No route（旧路径）
 * - /accounts/{id}/turnstile/sitekeys    ❌ No route
 * - /zones/{id}/turnstile/widgets        ❌ No route
 * - /accounts/{id}/challenges/widgets    ✅ 正确路径
 *
 * 正确请求体字段：
 * - name (不是 note/description)
 * - mode (不是 type)，值：non-interactive / managed / interactive
 * - domains（不支持通配符 *.xxx，必须具体域名）
 */
async function createWidget(accountId) {
  console.log("\n→ 步骤 1/4: 检查现有 Turnstile Widget...");

  // 先列出已有 widget
  const listResp = await cfApi("GET", `/accounts/${accountId}/challenges/widgets`);
  const existing = listResp.result || [];

  if (existing.length > 0) {
    console.log(`  发现 ${existing.length} 个已有 Widget`);
    for (const w of existing) {
      console.log(`    - ${w.name || "(unnamed)"}: sitekey=${w.sitekey}`);
    }

    // 删除旧的
    for (const w of existing) {
      console.log(`  删除旧 Widget: ${w.id}`);
      await cfApi("DELETE", `/accounts/${accountId}/challenges/widgets/${w.id}`);
    }
  }

  console.log("\n→ 创建新 Turnstile Widget...");
  const createResp = await cfApi("POST", `/accounts/${accountId}/challenges/widgets`, {
    name: WIDGET_NAME,
    domains: WIDGET_DOMAINS,
    mode: WIDGET_MODE,
  });

  const widget = createResp.result;
  console.log("✅ Turnstile Widget 创建成功！");
  console.log(`  Widget ID: ${widget.id}`);
  console.log(`  Site Key:  ${widget.sitekey}`);
  console.log(`  Secret:    ${widget.secret.substring(0, 15)}...（已隐藏）`);
  console.log(`  Mode:      ${widget.mode}`);
  console.log(`  Domains:   ${widget.domains.join(", ")}`);

  return { sitekey: widget.sitekey, secret: widget.secret };
}

// ── 步骤 2: 写入 Site Key 到 D1 ─────────────────────────────────────────────
function writeSiteKeyToD1(siteKey) {
  console.log("\n→ 步骤 2/4: 写入 Site Key 到 D1 system_config...");

  run("npx", [
    "wrangler", "d1", "execute", DATABASE_NAME, "--remote", "--command",
    `INSERT INTO system_config (key, value, updated_at)
     VALUES ('turnstile_site_key', '${siteKey}', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now');`
  ]);

  console.log("✅ Site Key 已写入 D1");
}

// ── 步骤 3: 设置 Secret Key 为 Worker Secret ─────────────────────────────────
function setWorkerSecret(secretKey) {
  console.log("\n→ 步骤 3/4: 设置 TURNSTILE_SECRET_KEY Worker Secret...");

  const child = execFileSync("npx", ["wrangler", "secret", "put", "TURNSTILE_SECRET_KEY", "--name", WORKER_NAME], {
    input: secretKey,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  console.log(child.trim());
  console.log("✅ TURNSTILE_SECRET_KEY 已设置");
}

// ── 步骤 4: 验证 ─────────────────────────────────────────────────────────────
function verify(siteKey) {
  console.log("\n→ 步骤 4/4: 验证配置...");

  console.log("\n→ 检查 D1 中的 Site Key:");
  run("npx", [
    "wrangler", "d1", "execute", DATABASE_NAME, "--remote", "--command",
    "SELECT key, value FROM system_config WHERE key='turnstile_site_key';"
  ]);

  console.log("\n→ 检查 Worker Secrets:");
  const output = run("npx", ["wrangler", "secret", "list", "--name", WORKER_NAME], { capture: true });
  if (output.includes("TURNSTILE_SECRET_KEY")) {
    console.log("  ✅ TURNSTILE_SECRET_KEY 已存在于 Worker Secrets");
  } else {
    console.log("  ⚠️  TURNSTILE_SECRET_KEY 未在列表中显示（可能刚设置，需要几秒同步）");
  }
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║  Turnstile Widget 全自动配置              ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log("");

  // 0. 获取 Account ID
  const accountId = await getAccountId();

  // 1. 创建 Turnstile Widget（通过 API，无需手动操作 Dashboard）
  const { sitekey, secret } = await createWidget(accountId);

  // 2. 写入 Site Key 到 D1
  writeSiteKeyToD1(sitekey);

  // 3. 设置 Secret Key
  setWorkerSecret(secret);

  // 4. 验证
  verify(sitekey);

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║  ✅ Turnstile 配置完成！                  ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log("");
  console.log("配置摘要:");
  console.log(`  Account ID:    ${accountId}`);
  console.log(`  Site Key:      ${sitekey}`);
  console.log(`  Secret Key:    ${secret.substring(0, 8)}...（已隐藏）`);
  console.log(`  Worker:        ${WORKER_NAME}`);
  console.log(`  D1 数据库:     ${DATABASE_NAME}`);
  console.log(`  Widget Mode:   ${WIDGET_MODE}`);
  console.log(`  Domains:       ${WIDGET_DOMAINS.join(", ")}`);
  console.log("");
  console.log("后续操作:");
  console.log("  1. wrangler deploy  （部署使配置生效）");
  console.log("  2. 访问 https://eshop.mailforwdy.com 验证 Turnstile 是否正常工作");
  console.log("  3. 如需添加域名，修改脚本中 WIDGET_DOMAINS 后重新运行");
}

main().catch((err) => {
  console.error("\n❌ 配置失败:", err.message);
  console.error("\n常见问题:");
  console.error("  - 'No route could be found' → API Token 缺少 Turnstile 权限，需重新生成 Token");
  console.error("  - 'Invalid Global Key' → cfat_ 开头的 Token 必须用 Bearer 鉴权，不能用 X-Auth-Key");
  console.error("  - 'Invalid format for Authorization header' → Token 可能已过期");
  process.exit(1);
});
