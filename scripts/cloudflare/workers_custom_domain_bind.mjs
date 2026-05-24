#!/usr/bin/env node

import https from "node:https";

const env = process.env;
const required = [
  "CF_API_TOKEN",
  "CF_ACCOUNT_ID",
  "CF_ZONE_ID",
  "CF_WORKER_SERVICE",
  "CF_CUSTOM_DOMAIN"
];

const missing = required.filter((key) => !env[key]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(2);
}

const config = {
  token: env.CF_API_TOKEN,
  accountId: env.CF_ACCOUNT_ID,
  zoneId: env.CF_ZONE_ID,
  service: env.CF_WORKER_SERVICE,
  domain: env.CF_CUSTOM_DOMAIN,
  environment: env.CF_WORKER_ENVIRONMENT || "production"
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
          Authorization: `Bearer ${config.token}`,
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

function assertSuccess(response, label) {
  if (response.json?.success) return response.json;
  throw new Error(`${label} failed: HTTP ${response.statusCode} ${JSON.stringify(response.json?.errors || response.json)}`);
}

async function main() {
  assertSuccess(
    await request("GET", `/client/v4/accounts/${config.accountId}/tokens/verify`),
    "Verify token"
  );

  const list = assertSuccess(
    await request("GET", `/client/v4/accounts/${config.accountId}/workers/domains`),
    "List Workers custom domains"
  );

  const existing = (list.result || []).find((item) => item.hostname === config.domain);
  if (existing) {
    console.log(`Workers custom domain exists: ${existing.hostname} -> ${existing.service} (${existing.environment})`);
    if (existing.service !== config.service || existing.environment !== config.environment) {
      console.log("Existing binding differs; updating it with PUT.");
    } else {
      console.log("Existing binding is already correct.");
      return;
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
  console.log(`Verify with: curl -I https://${config.domain}/`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
