#!/usr/bin/env node

/*
 * Cloudflare Workers 自定义域名脚本契约。
 *
 * 必填意图：
 * - CF_CUSTOM_DOMAIN 是要绑定的目标域名，例如 auth.eforge.xyz。
 * - 必须直接提供 CF_WORKER_SERVICE，或通过 CF_SOURCE_CUSTOM_DOMAIN 从已有绑定推导。
 * - 鉴权必须二选一：CF_API_TOKEN，或 CF_AUTH_EMAIL + CF_GLOBAL_API_KEY。
 *
 * 核心不变量：
 * - Workers Custom Domains 不是 Pages CNAME 记录，不能混用 Pages 域名流程。
 * - Cloudflare 会为 Worker hostname 自动创建 DNS 记录和证书。
 * - 默认行为是增量绑定：绑定新域名，保留源域名。
 * - 删除源域名必须同时设置 CF_DELETE_SOURCE_CUSTOM_DOMAIN=true
 *   和 CF_REPLACE_CONFIRM="<源域名>-><目标域名>"。
 */

import https from "node:https";

const env = process.env;
const required = [
  "CF_CUSTOM_DOMAIN"
];

const missing = required.filter((key) => !env[key]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(2);
}

const config = {
  accountId: env.CF_ACCOUNT_ID,
  zoneId: env.CF_ZONE_ID,
  zoneName: env.CF_ZONE_NAME,
  service: env.CF_WORKER_SERVICE,
  domain: env.CF_CUSTOM_DOMAIN,
  environment: env.CF_WORKER_ENVIRONMENT || "production",
  sourceDomain: env.CF_SOURCE_CUSTOM_DOMAIN,
  deleteSourceDomain: env.CF_DELETE_SOURCE_CUSTOM_DOMAIN === "true",
  replaceConfirm: env.CF_REPLACE_CONFIRM
};

function request(method, path, body) {
  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.cloudflare.com",
        path,
        method,
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
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
            reject(new Error(`Invalid JSON from Cloudflare ${method} ${path}: ${raw}`));
            return;
          }
          resolve({ statusCode: res.statusCode, json });
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

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

function assertSuccess(response, label) {
  if (response.json?.success) return response.json;
  throw new Error(`${label} failed: HTTP ${response.statusCode} ${JSON.stringify(response.json?.errors || response.json)}`);
}

function inferZoneName(domain) {
  if (config.zoneName) return config.zoneName;

  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) {
    throw new Error(`Cannot infer zone from invalid domain: ${domain}`);
  }

  config.zoneName = labels.slice(-2).join(".");
  return config.zoneName;
}

async function resolveAccountId() {
  if (config.accountId) return config.accountId;

  const accounts = assertSuccess(
    await request("GET", "/client/v4/accounts"),
    "List accounts"
  ).result || [];

  if (accounts.length === 1) {
    config.accountId = accounts[0].id;
    console.log(`Inferred account: ${accounts[0].name} (${config.accountId})`);
    return config.accountId;
  }

  const names = accounts.map((account) => `${account.name} (${account.id})`).join(", ");
  throw new Error(`Multiple or zero Cloudflare accounts found; set CF_ACCOUNT_ID. Accounts: ${names}`);
}

async function resolveZoneId() {
  if (config.zoneId) return config.zoneId;

  const zoneName = inferZoneName(config.domain);
  const zones = assertSuccess(
    await request("GET", `/client/v4/zones?name=${encodeURIComponent(zoneName)}`),
    "Find zone"
  ).result || [];

  if (zones.length === 1) {
    config.zoneId = zones[0].id;
    console.log(`Inferred zone: ${zones[0].name} (${config.zoneId})`);
    return config.zoneId;
  }

  throw new Error(`Cannot infer unique zone for ${zoneName}; set CF_ZONE_ID.`);
}

async function listDomains() {
  await resolveAccountId();
  return assertSuccess(
    await request("GET", `/client/v4/accounts/${config.accountId}/workers/domains`),
    "List Workers custom domains"
  ).result || [];
}

async function resolveServiceFromSourceDomain(domains) {
  if (config.service) return;
  if (!config.sourceDomain) {
    throw new Error("Missing worker service: set CF_WORKER_SERVICE or CF_SOURCE_CUSTOM_DOMAIN");
  }

  const source = domains.find((item) => item.hostname === config.sourceDomain);
  if (!source) {
    throw new Error(`Cannot infer Worker service: source domain not found: ${config.sourceDomain}`);
  }

  config.service = source.service;
  config.environment = source.environment || config.environment;
  config.zoneId ||= source.zone_id;
  config.zoneName ||= source.zone_name;
  console.log(`Inferred Worker service from ${config.sourceDomain}: ${config.service} (${config.environment})`);
}

async function bindDomain(domains) {
  await resolveZoneId();

  const existing = domains.find((item) => item.hostname === config.domain);
  if (existing) {
    console.log(`Workers custom domain exists: ${existing.hostname} -> ${existing.service} (${existing.environment})`);
    if (existing.service !== config.service || existing.environment !== config.environment) {
      console.log("Existing binding differs; updating it with PUT.");
    } else {
      console.log("Existing binding is already correct.");
      return existing;
    }
  }

  const result = assertSuccess(
    await request("PUT", `/client/v4/accounts/${config.accountId}/workers/domains`, {
      environment: config.environment,
      hostname: config.domain,
      service: config.service,
      zone_id: config.zoneId
    }),
    "Bind Workers custom domain"
  );

  console.log(`Bound Workers custom domain: ${result.result.hostname} -> ${result.result.service}`);
  return result.result;
}

async function maybeDeleteSourceDomain(domains) {
  if (!config.deleteSourceDomain) return;

  if (!config.sourceDomain) {
    throw new Error("CF_DELETE_SOURCE_CUSTOM_DOMAIN=true requires CF_SOURCE_CUSTOM_DOMAIN");
  }

  const expectedConfirm = `${config.sourceDomain}->${config.domain}`;
  if (config.replaceConfirm !== expectedConfirm) {
    throw new Error(`Refusing to delete source domain. Set CF_REPLACE_CONFIRM="${expectedConfirm}"`);
  }

  const source = domains.find((item) => item.hostname === config.sourceDomain);
  if (!source) {
    console.log(`Source domain already absent: ${config.sourceDomain}`);
    return;
  }

  assertSuccess(
    await request("DELETE", `/client/v4/accounts/${config.accountId}/workers/domains/${source.id}`),
    "Delete source Workers custom domain"
  );
  console.log(`Deleted source Workers custom domain: ${config.sourceDomain}`);
}

async function main() {
  const domains = await listDomains();
  await resolveServiceFromSourceDomain(domains);
  await bindDomain(domains);
  await maybeDeleteSourceDomain(domains);

  console.log(`Verify with: curl -I https://${config.domain}/`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
