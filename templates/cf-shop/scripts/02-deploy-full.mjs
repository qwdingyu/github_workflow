import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";

/*
 * eshop 完整远程部署脚本。
 *
 * 核心职责：
 * - 复用或创建 D1 数据库。
 * - 从 wrangler d1 create 输出中提取 database_id，并写入 wrangler.jsonc。
 * - 执行远程 migration。
 * - 可选执行远程 seed。
 * - 插入默认 system_config（INSERT OR IGNORE，幂等）。
 * - 部署 Worker Static Assets + API（通过 --secrets-file 传入 ADMIN_TOKEN）。
 * - 可选绑定 Workers Custom Domain。
 * - 最后运行 smoke（readonly + admin + write），证明 D1 发卡链路可用。
 *
 * 关键变量：
 * - CLOUDFLARE_API_TOKEN：Wrangler CLI 远程操作必需。
 * - ADMIN_TOKEN：管理后台 Token，必须设置。
 * - ESHOP_WORKER_NAME：Worker 名称，默认 eshop。
 * - ESHOP_D1_DATABASE：D1 数据库名称，默认 eshop-db。
 * - ESHOP_SEED_REMOTE=false：跳过远程 seed，避免重复导入演示数据。
 * - ESHOP_BIND_DOMAIN=true：部署后绑定正式域名。
 * - ESHOP_CUSTOM_DOMAIN：正式域名，默认 eshop.eforge.xyz。
 * - BASE_URL：smoke 目标地址，默认 workers.dev。
 * - CF_WORKER_SERVICE：绑定域名时传给 domain:bind，默认复用 ESHOP_WORKER_NAME。
 * - CF_CUSTOM_DOMAIN：绑定域名时传给 domain:bind，默认复用 ESHOP_CUSTOM_DOMAIN。
 * - CF_AUTH_EMAIL + CF_GLOBAL_API_KEY：domain:bind 需要时使用的 Cloudflare 兜底鉴权。
 *
 * 不变量：
 * - database_id 只能来自 wrangler d1 create 输出，不能猜。
 * - seed.sql 只能放演示数据，不能放真实卡密。
 * - system_config 使用 INSERT OR IGNORE，幂等安全。
 * - smoke 会真实消耗一条库存。
 * - secrets 通过 --secrets-file 传入 wrangler deploy，不依赖交互式命令。
 *
 * 常用命令：
 * - 完整部署但不重复 seed：
 *   CLOUDFLARE_API_TOKEN="<token>" ADMIN_TOKEN="<token>" ESHOP_SEED_REMOTE=false npm run deploy:full
 * - 部署并绑定正式域名：
 *   CLOUDFLARE_API_TOKEN="<token>" ADMIN_TOKEN="<token>" ESHOP_BIND_DOMAIN=true ESHOP_SEED_REMOTE=false npm run deploy:full
 *
 * 风险提示：
 * - 远程 seed 只适合演示数据。
 * - smoke 会真实发放一条卡密，库存不足时会失败。
 */

const project = {
  workerName: process.env.ESHOP_WORKER_NAME || "eshop",
  databaseName: process.env.ESHOP_D1_DATABASE || "eshop-db",
  customDomain: process.env.ESHOP_CUSTOM_DOMAIN || "eshop.eforge.xyz",
  smokeUrl: process.env.BASE_URL || `https://${process.env.ESHOP_WORKER_NAME || "eshop"}.mailforwdy.workers.dev`,
  seedRemote: process.env.ESHOP_SEED_REMOTE !== "false",
  databaseProvider: process.env.DATABASE_PROVIDER || "d1",
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
  if (!process.env[name]) {
    throw new Error(`缺少环境变量 ${name}`);
  }
}

function readWrangler() {
  return readFileSync("wrangler.jsonc", "utf8");
}

function getCurrentDatabaseId() {
  const match = readWrangler().match(/"database_id"\s*:\s*"([^"]+)"/);
  return match?.[1];
}

function setDatabaseId(databaseId) {
  const current = readWrangler();
  const next = current.replace(
    /"database_id"\s*:\s*"[^"]+"/,
    `"database_id": "${databaseId}"`
  );
  if (next === current) {
    throw new Error("没有找到 wrangler.jsonc 中的 database_id 字段");
  }
  writeFileSync("wrangler.jsonc", next);
}

function createDatabase() {
  requireEnv("CLOUDFLARE_API_TOKEN");
  const output = run("npx", ["wrangler", "d1", "create", project.databaseName], { capture: true });
  console.log(output);
  const match = output.match(/"database_id"\s*:\s*"([^"]+)"/);
  if (!match) {
    throw new Error("无法从 wrangler d1 create 输出中提取 database_id");
  }
  setDatabaseId(match[1]);
  console.log(`已写入 wrangler.jsonc database_id=${match[1]}`);
}

function ensureDatabaseId() {
  const current = getCurrentDatabaseId();
  if (current && current !== "REPLACE_WITH_D1_DATABASE_ID") {
    console.log(`复用已有 D1 database_id=${current}`);
    return current;
  }

  createDatabase();
  return getCurrentDatabaseId();
}

function insertSystemConfig() {
  requireEnv("CLOUDFLARE_API_TOKEN");
  console.log("\n→ 插入默认 system_config ...");
  run("npx", [
    "wrangler", "d1", "execute", project.databaseName, "--remote", "--command",
    `INSERT OR IGNORE INTO system_config (key, value, updated_at) VALUES
      ('offline_pay_qr_wechat', '', datetime('now')),
      ('offline_pay_qr_alipay', '', datetime('now')),
      ('turnstile_site_key', '', datetime('now'));`
  ]);
  console.log("✅ system_config 已插入");
}

/**
 * 通过 wrangler deploy --secrets-file 传入 secrets。
 * 这是 wrangler 官方推荐方式，比 Cloudflare API 更可靠：
 * - 不需要 Worker 已存在（首次部署也适用）
 * - 不需要查脚本 ID
 * - 与 deploy 原子操作
 */
function deployWithSecrets() {
  const adminToken = process.env.ADMIN_TOKEN;

  if (adminToken) {
    // 创建临时 secrets 文件 (.env 格式)
    const secretsFile = ".deploy-secrets.env";
    writeFileSync(secretsFile, `ADMIN_TOKEN=${adminToken}\n`);
    console.log(`\n→ 通过 --secrets-file 部署 (含 ADMIN_TOKEN) ...`);
    run("npx", ["wrangler", "deploy", `--secrets-file=${secretsFile}`]);
    // 清理临时文件
    if (existsSync(secretsFile)) {
      writeFileSync(secretsFile, ""); // 清空内容再删
      unlinkSync(secretsFile);
    }
    console.log("✅ 部署完成 (secrets 已上传)");
  } else {
    console.log("\n⚠️  未设置 ADMIN_TOKEN，管理后台将返回 503");
    run("npx", ["wrangler", "deploy"]);
    console.log("✅ 部署完成");
  }
}

function main() {
  if (project.databaseProvider === "turso") {
    console.log("Turso 模式：跳过 D1 数据库创建/迁移");
    run("npm", ["run", "db:migrate:turso"]);
  } else {
    ensureDatabaseId();
    run("npm", ["run", "db:migrate:remote"]);
    if (project.seedRemote) {
      run("npm", ["run", "db:seed:remote"]);
    } else {
      console.log("跳过远程 seed：ESHOP_SEED_REMOTE=false");
    }
    insertSystemConfig();
  }

  deployWithSecrets();

  if (process.env.ESHOP_BIND_DOMAIN === "true") {
    process.env.CF_WORKER_SERVICE ||= project.workerName;
    process.env.CF_CUSTOM_DOMAIN ||= project.customDomain;
    process.env.CF_WAIT_ACTIVE ||= "true";
    run("npm", ["run", "domain:bind"]);
  }

  const smokeUrl = process.env.ESHOP_BIND_DOMAIN === "true"
    ? `https://${process.env.CF_CUSTOM_DOMAIN || project.customDomain}`
    : project.smokeUrl;
  const smokeEnv = { ...process.env, BASE_URL: smokeUrl };

  console.log("\n── Smoke 测试 ──");
  run("npm", ["run", "smoke:readonly"], { env: smokeEnv });
  run("npm", ["run", "smoke:admin"], { env: smokeEnv });
  run("npm", ["run", "smoke:write"], { env: smokeEnv });
  console.log("\n✅ 全部 smoke 测试通过");
}

main();
