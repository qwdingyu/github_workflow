#!/usr/bin/env node

import https from "node:https";

const env = process.env;

const required = [
  "CF_API_TOKEN",
  "CF_ACCOUNT_ID",
  "CF_ZONE_ID",
  "CF_PAGES_PROJECT",
  "CF_GITHUB_OWNER",
  "CF_GITHUB_REPO",
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
  project: env.CF_PAGES_PROJECT,
  owner: env.CF_GITHUB_OWNER,
  repo: env.CF_GITHUB_REPO,
  branch: env.CF_PRODUCTION_BRANCH || "main",
  buildCommand: env.CF_BUILD_COMMAND || "",
  destinationDir: env.CF_DESTINATION_DIR || "src",
  rootDir: env.CF_ROOT_DIR || "",
  domain: env.CF_CUSTOM_DOMAIN,
  cnameTarget: env.CF_CNAME_TARGET || `${env.CF_PAGES_PROJECT}.pages.dev`,
  proxied: env.CF_DNS_PROXIED !== "false"
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
          } catch (error) {
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
  const errors = JSON.stringify(response.json?.errors || response.json);
  throw new Error(`${label} failed: HTTP ${response.statusCode} ${errors}`);
}

async function ensureProject() {
  const path = `/client/v4/accounts/${config.accountId}/pages/projects/${config.project}`;
  const existing = await request("GET", path);

  if (existing.json?.success) {
    console.log(`Pages project exists: ${config.project}`);
    return existing.json.result;
  }

  const createPath = `/client/v4/accounts/${config.accountId}/pages/projects`;
  const createBody = {
    name: config.project,
    production_branch: config.branch,
    build_config: {
      build_command: config.buildCommand,
      destination_dir: config.destinationDir,
      root_dir: config.rootDir
    },
    source: {
      type: "github",
      config: {
        owner: config.owner,
        repo_name: config.repo,
        production_branch: config.branch,
        production_deployments_enabled: true,
        preview_deployment_setting: "none"
      }
    }
  };

  const created = assertSuccess(await request("POST", createPath, createBody), "Create Pages project");
  console.log(`Created Pages project: ${created.result.name}`);
  return created.result;
}

async function ensurePagesDomain() {
  const listPath = `/client/v4/accounts/${config.accountId}/pages/projects/${config.project}/domains`;
  const domains = assertSuccess(await request("GET", listPath), "List Pages domains").result || [];
  const found = domains.find((item) => item.name === config.domain);

  if (found) {
    console.log(`Pages custom domain exists: ${config.domain} (${found.status})`);
    return found;
  }

  const created = assertSuccess(
    await request("POST", listPath, { name: config.domain }),
    "Create Pages custom domain"
  );
  console.log(`Created Pages custom domain: ${config.domain}`);
  return created.result;
}

async function ensureDnsCname() {
  const encodedName = encodeURIComponent(config.domain);
  const listPath = `/client/v4/zones/${config.zoneId}/dns_records?name=${encodedName}`;
  const records = assertSuccess(await request("GET", listPath), "List DNS records").result || [];

  const conflicting = records.find((record) => record.type !== "CNAME");
  if (conflicting) {
    throw new Error(
      `Conflicting DNS record exists for ${config.domain}: ${conflicting.type} ${conflicting.content}`
    );
  }

  const cname = records.find((record) => record.type === "CNAME");
  const body = {
    type: "CNAME",
    name: config.domain,
    content: config.cnameTarget,
    proxied: config.proxied,
    ttl: 1
  };

  if (!cname) {
    const created = assertSuccess(
      await request("POST", `/client/v4/zones/${config.zoneId}/dns_records`, body),
      "Create DNS CNAME"
    );
    console.log(`Created DNS CNAME: ${config.domain} -> ${config.cnameTarget}`);
    return created.result;
  }

  if (cname.content === config.cnameTarget && cname.proxied === config.proxied) {
    console.log(`DNS CNAME already correct: ${config.domain} -> ${config.cnameTarget}`);
    return cname;
  }

  const updated = assertSuccess(
    await request("PUT", `/client/v4/zones/${config.zoneId}/dns_records/${cname.id}`, body),
    "Update DNS CNAME"
  );
  console.log(`Updated DNS CNAME: ${config.domain} -> ${config.cnameTarget}`);
  return updated.result;
}

async function main() {
  assertSuccess(
    await request("GET", `/client/v4/accounts/${config.accountId}/tokens/verify`),
    "Verify token"
  );

  await ensureProject();
  await ensurePagesDomain();
  await ensureDnsCname();

  console.log("Next verification:");
  console.log(`  curl -I https://${config.cnameTarget}`);
  console.log(`  curl -I https://${config.domain}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
