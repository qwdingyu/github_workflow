#!/usr/bin/env node

/*
 * Cloudflare 权限探针脚本。
 *
 * 用途：
 * - 快速确认当前凭据能访问哪些 Cloudflare API。
 * - 检查 Pages、Pages deployments、Workers Custom Domains、Zone DNS records 四类常用权限。
 * - 只读检查，不创建、不修改、不删除任何 Cloudflare 资源。
 *
 * 必填环境变量：
 * - CF_ACCOUNT_ID：Cloudflare account id。
 * - CF_ZONE_ID：Cloudflare zone id。
 * - 鉴权二选一：
 *   1. CF_API_TOKEN：Cloudflare API Token。
 *   2. CF_AUTH_EMAIL + CF_GLOBAL_API_KEY：Cloudflare 登录邮箱和 Global API Key。
 *
 * 可选环境变量：
 * - CF_PAGES_PROJECT：用于检查 deployments 的 Pages 项目名，默认 vibox-shop。
 *
 * 常用命令：
 * - 探测当前 token 权限：
 *   CF_API_TOKEN="<token>" CF_ACCOUNT_ID="<account_id>" CF_ZONE_ID="<zone_id>" CF_PAGES_PROJECT="acctbox" rtk node scripts/cloudflare/capability_probe.mjs
 * - 使用 Global API Key 兜底探测：
 *   CF_AUTH_EMAIL="<email>" CF_GLOBAL_API_KEY="<key>" CF_ACCOUNT_ID="<account_id>" CF_ZONE_ID="<zone_id>" rtk node scripts/cloudflare/capability_probe.mjs
 */

import https from "node:https";

const env = process.env;
const required = ["CF_ACCOUNT_ID", "CF_ZONE_ID"];
const missing = required.filter((key) => !env[key]);

if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(2);
}

const accountId = env.CF_ACCOUNT_ID;
const zoneId = env.CF_ZONE_ID;
const pagesProject = env.CF_PAGES_PROJECT || "vibox-shop";

const checks = [
  ["Pages projects list", "GET", `/client/v4/accounts/${accountId}/pages/projects`],
  ["Pages deployments list", "GET", `/client/v4/accounts/${accountId}/pages/projects/${pagesProject}/deployments`],
  ["Workers custom domains list", "GET", `/client/v4/accounts/${accountId}/workers/domains`],
  ["Zone DNS records list", "GET", `/client/v4/zones/${zoneId}/dns_records?per_page=1`]
];

function authHeaders() {
  if (env.CF_API_TOKEN) {
    return { Authorization: `Bearer ${env.CF_API_TOKEN}` };
  }

  if (env.CF_AUTH_EMAIL && env.CF_GLOBAL_API_KEY) {
    return {
      "X-Auth-Email": env.CF_AUTH_EMAIL,
      "X-Auth-Key": env.CF_GLOBAL_API_KEY
    };
  }

  throw new Error("Missing auth: set CF_API_TOKEN or CF_AUTH_EMAIL + CF_GLOBAL_API_KEY");
}

function request(method, path) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.cloudflare.com",
        path,
        method,
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json"
        }
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let json;
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch {
            json = { success: false, errors: [{ message: raw || "Invalid JSON" }] };
          }
          resolve({ statusCode: res.statusCode, json });
        });
      }
    );

    req.on("error", (error) => {
      resolve({ statusCode: 0, json: { success: false, errors: [{ message: error.message }] } });
    });
    req.end();
  });
}

for (const [label, method, path] of checks) {
  const result = await request(method, path);
  const status = result.json?.success ? "OK" : "FAIL";
  const errors = result.json?.errors?.length ? ` ${JSON.stringify(result.json.errors)}` : "";
  console.log(`${status} ${label} HTTP ${result.statusCode}${errors}`);
}
