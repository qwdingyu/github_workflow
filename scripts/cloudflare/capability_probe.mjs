#!/usr/bin/env node

import https from "node:https";

const env = process.env;
const required = ["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_ZONE_ID"];
const missing = required.filter((key) => !env[key]);

if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(2);
}

const token = env.CF_API_TOKEN;
const accountId = env.CF_ACCOUNT_ID;
const zoneId = env.CF_ZONE_ID;
const pagesProject = env.CF_PAGES_PROJECT || "vibox-shop";

const checks = [
  ["Account token verify", "GET", `/client/v4/accounts/${accountId}/tokens/verify`],
  ["Pages projects list", "GET", `/client/v4/accounts/${accountId}/pages/projects`],
  ["Pages deployments list", "GET", `/client/v4/accounts/${accountId}/pages/projects/${pagesProject}/deployments`],
  ["Workers custom domains list", "GET", `/client/v4/accounts/${accountId}/workers/domains`],
  ["Zone DNS records list", "GET", `/client/v4/zones/${zoneId}/dns_records?per_page=1`]
];

function request(method, path) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.cloudflare.com",
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
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
