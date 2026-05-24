import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/*
 * CF Form Kit 完整部署脚本。
 *
 * 用途：
 * - 复用或创建 D1。
 * - 写入 wrangler.jsonc database_id。
 * - 执行远程 migration。
 * - 可选 seed。
 * - 部署 Worker。
 * - 可选绑定 Workers Custom Domain。
 * - 最后运行只读 smoke。
 *
 * 必填环境变量：
 * - CLOUDFLARE_API_TOKEN：Wrangler 远程操作。
 *
 * 可选环境变量：
 * - FORMKIT_WORKER_NAME：Worker 名称，默认 cf-form-kit。
 * - FORMKIT_D1_DATABASE：D1 名称，默认 cf-form-kit-db。
 * - FORMKIT_SEED_REMOTE=false：跳过远程 seed。
 * - FORMKIT_BIND_DOMAIN=true：部署后绑定正式域名。
 * - FORMKIT_CUSTOM_DOMAIN：正式域名。
 * - BASE_URL：只读 smoke 目标。
 *
 * 常用命令：
 * - CLOUDFLARE_API_TOKEN="<token>" FORMKIT_SEED_REMOTE=false rtk npm run deploy:full
 */

const project = {
  workerName: process.env.FORMKIT_WORKER_NAME || "cf-form-kit",
  databaseName: process.env.FORMKIT_D1_DATABASE || "cf-form-kit-db",
  customDomain: process.env.FORMKIT_CUSTOM_DOMAIN || "",
  smokeUrl: process.env.BASE_URL || "",
  seedRemote: process.env.FORMKIT_SEED_REMOTE !== "false"
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

function readWrangler() {
  return readFileSync("wrangler.jsonc", "utf8");
}

function currentDatabaseId() {
  return readWrangler().match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
}

function setDatabaseId(databaseId) {
  const current = readWrangler();
  const next = current.replace(/"database_id"\s*:\s*"[^"]+"/, `"database_id": "${databaseId}"`);
  if (next === current) throw new Error("没有找到 wrangler.jsonc 中的 database_id 字段");
  writeFileSync("wrangler.jsonc", next);
}

function ensureDatabase() {
  requireEnv("CLOUDFLARE_API_TOKEN");
  const current = currentDatabaseId();
  if (current && current !== "REPLACE_WITH_D1_DATABASE_ID") return current;

  const output = run("npx", ["wrangler", "d1", "create", project.databaseName], { capture: true });
  console.log(output);
  const databaseId = output.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
  if (!databaseId) throw new Error("无法从 wrangler d1 create 输出提取 database_id");
  setDatabaseId(databaseId);
  return databaseId;
}

ensureDatabase();
run("npm", ["run", "db:migrate:remote"]);
if (project.seedRemote) run("npm", ["run", "db:seed:remote"]);
run("npm", ["run", "deploy"]);

if (process.env.FORMKIT_BIND_DOMAIN === "true") {
  if (!project.customDomain) throw new Error("FORMKIT_BIND_DOMAIN=true 时必须设置 FORMKIT_CUSTOM_DOMAIN");
  run("node", ["../scripts/cloudflare/workers_custom_domain_bind.mjs"], {
    env: {
      ...process.env,
      CF_WORKER_SERVICE: process.env.CF_WORKER_SERVICE || project.workerName,
      CF_CUSTOM_DOMAIN: process.env.CF_CUSTOM_DOMAIN || project.customDomain
    }
  });
}

const baseUrl = project.smokeUrl || (project.customDomain ? `https://${project.customDomain}` : "");
if (baseUrl) {
  run("npm", ["run", "smoke:readonly"], {
    env: { ...process.env, BASE_URL: baseUrl }
  });
}
