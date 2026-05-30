import { execFileSync } from "node:child_process";

/*
 * cf-form 完整部署脚本（Turso 版）。
 *
 * 用途：
 * - 执行远程 migration。
 * - 可选 seed。
 * - 部署 Worker。
 * - 可选绑定 Workers Custom Domain。
 * - 最后运行只读 smoke。
 *
 * 必填环境变量：
 * - CLOUDFLARE_API_TOKEN：Wrangler 远程操作。
 * - TURSO_URL：Turso 数据库 URL。
 * - TURSO_TOKEN：Turso 认证 Token。
 *
 * 可选环境变量：
 * - CF_WORKER_NAME：Worker 名称，默认 cf-form。
 * - CF_SEED_REMOTE=false：跳过远程 seed。
 * - CF_BIND_DOMAIN=true：部署后绑定正式域名。
 * - CF_CUSTOM_DOMAIN：正式域名。
 * - BASE_URL：只读 smoke 目标。
 *
 * 常用命令：
 * - CLOUDFLARE_API_TOKEN="<token>" TURSO_URL="<url>" TURSO_TOKEN="<token>" npm run deploy:full
 */

const project = {
  workerName: process.env.CF_WORKER_NAME || "cf-form",
  customDomain: process.env.CF_CUSTOM_DOMAIN || "",
  smokeUrl: process.env.BASE_URL || "",
  seedRemote: process.env.CF_SEED_REMOTE !== "false"
};

function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: options.env || process.env
  });
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`缺少环境变量 ${name}`);
}

// 1. 检查环境变量
requireEnv("CLOUDFLARE_API_TOKEN");
requireEnv("TURSO_URL");
requireEnv("TURSO_TOKEN");

// 2. 执行迁移
run("node", ["scripts/migrate.mjs"]);

// 3. 可选 seed
if (project.seedRemote) {
  console.log("\n→ 执行 seed...");
  run("node", ["-e", `
    const { createClient } = require('@libsql/client');
    const fs = require('fs');
    const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
    const sql = fs.readFileSync('seed.sql', 'utf8');
    const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
    (async () => {
      for (const s of stmts) { try { await client.execute(s); } catch(e) { console.log('skip:', e.message); } }
      console.log('seed done');
    })();
  `]);
}

// 4. 部署 Worker
run("npx", ["wrangler", "deploy"]);

// 5. 可选绑定域名
if (process.env.CF_BIND_DOMAIN === "true") {
  if (!project.customDomain) throw new Error("CF_BIND_DOMAIN=true 时必须设置 CF_CUSTOM_DOMAIN");
  run("node", ["../scripts/cloudflare/workers_custom_domain_bind.mjs"], {
    env: {
      ...process.env,
      CF_WORKER_SERVICE: process.env.CF_WORKER_SERVICE || project.workerName,
      CF_CUSTOM_DOMAIN: process.env.CF_CUSTOM_DOMAIN || project.customDomain
    }
  });
}

// 6. Smoke 测试
const baseUrl = project.smokeUrl || (project.customDomain ? `https://${project.customDomain}` : "");
if (baseUrl) {
  run("node", ["scripts/smoke-readonly.mjs"], {
    env: { ...process.env, BASE_URL: baseUrl }
  });
}
