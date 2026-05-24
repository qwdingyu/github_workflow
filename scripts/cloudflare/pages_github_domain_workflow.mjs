#!/usr/bin/env node

import https from "node:https";
import { execFileSync } from "node:child_process";

const env = process.env;

const required = [
  "CF_CUSTOM_DOMAIN"
];

const missing = required.filter((key) => !env[key]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(2);
}

function readGitRemote() {
  const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
    encoding: "utf8"
  }).trim();

  const httpsMatch = remote.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = remote.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new Error(`Cannot infer GitHub owner/repo from remote.origin.url: ${remote}`);
}

function inferZoneName(domain) {
  if (env.CF_ZONE_NAME) return env.CF_ZONE_NAME;

  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) {
    throw new Error(`Cannot infer zone from invalid domain: ${domain}`);
  }

  return labels.slice(-2).join(".");
}

function boolEnv(name, defaultValue) {
  if (env[name] === undefined) return defaultValue;
  return env[name] === "true";
}

const inferredRepo = env.CF_GITHUB_OWNER && env.CF_GITHUB_REPO
  ? { owner: env.CF_GITHUB_OWNER, repo: env.CF_GITHUB_REPO }
  : readGitRemote();

const config = {
  accountId: env.CF_ACCOUNT_ID,
  zoneId: env.CF_ZONE_ID,
  zoneName: inferZoneName(env.CF_CUSTOM_DOMAIN),
  project: env.CF_PAGES_PROJECT || inferredRepo.repo,
  owner: inferredRepo.owner,
  repo: inferredRepo.repo,
  branch: env.CF_PRODUCTION_BRANCH || "main",
  buildCommand: env.CF_BUILD_COMMAND || "",
  destinationDir: env.CF_DESTINATION_DIR || "src",
  rootDir: env.CF_ROOT_DIR || "",
  domain: env.CF_CUSTOM_DOMAIN,
  cnameTarget: env.CF_CNAME_TARGET,
  proxied: boolEnv("CF_DNS_PROXIED", false),
  waitActive: boolEnv("CF_WAIT_ACTIVE", true),
  waitAttempts: Number.parseInt(env.CF_WAIT_ATTEMPTS || "24", 10),
  waitIntervalMs: Number.parseInt(env.CF_WAIT_INTERVAL_MS || "5000", 10)
};

function authHeaders(scope) {
  const token = scope === "dns" ? env.CF_DNS_API_TOKEN : env.CF_API_TOKEN;
  const authEmail = scope === "dns" ? env.CF_DNS_AUTH_EMAIL || env.CF_AUTH_EMAIL : env.CF_AUTH_EMAIL;
  const globalKey = scope === "dns"
    ? env.CF_DNS_GLOBAL_API_KEY || env.CF_GLOBAL_API_KEY
    : env.CF_GLOBAL_API_KEY;

  if (token) {
    return { Authorization: `Bearer ${token}` };
  }

  if (authEmail && globalKey) {
    return {
      "X-Auth-Email": authEmail,
      "X-Auth-Key": globalKey
    };
  }

  if (scope === "dns" && env.CF_API_TOKEN) {
    return { Authorization: `Bearer ${env.CF_API_TOKEN}` };
  }

  throw new Error(
    scope === "dns"
      ? "Missing DNS auth: set CF_DNS_API_TOKEN or CF_DNS_AUTH_EMAIL + CF_DNS_GLOBAL_API_KEY"
      : "Missing account auth: set CF_API_TOKEN or CF_AUTH_EMAIL + CF_GLOBAL_API_KEY"
  );
}

function request(method, path, body, scope = "account") {
  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.cloudflare.com",
        path,
        method,
        headers: {
          ...authHeaders(scope),
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

  const encodedName = encodeURIComponent(config.zoneName);
  const zones = assertSuccess(
    await request("GET", `/client/v4/zones?name=${encodedName}`, undefined, "dns"),
    "Find zone"
  ).result || [];

  if (zones.length === 1) {
    config.zoneId = zones[0].id;
    console.log(`Inferred zone: ${zones[0].name} (${config.zoneId})`);
    return config.zoneId;
  }

  throw new Error(`Cannot infer unique zone for ${config.zoneName}; set CF_ZONE_ID.`);
}

async function ensureProject() {
  await resolveAccountId();

  const path = `/client/v4/accounts/${config.accountId}/pages/projects/${config.project}`;
  const existing = await request("GET", path);

  if (existing.json?.success) {
    console.log(`Pages project exists: ${config.project}`);
    config.cnameTarget ||= existing.json.result.subdomain;
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
  config.cnameTarget ||= created.result.subdomain;
  return created.result;
}

async function ensurePagesDomain() {
  await resolveAccountId();

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
  await resolveZoneId();

  const encodedName = encodeURIComponent(config.domain);
  const listPath = `/client/v4/zones/${config.zoneId}/dns_records?name=${encodedName}`;
  const records = assertSuccess(await request("GET", listPath, undefined, "dns"), "List DNS records").result || [];

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
      await request("POST", `/client/v4/zones/${config.zoneId}/dns_records`, body, "dns"),
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
    await request("PUT", `/client/v4/zones/${config.zoneId}/dns_records/${cname.id}`, body, "dns"),
    "Update DNS CNAME"
  );
  console.log(`Updated DNS CNAME: ${config.domain} -> ${config.cnameTarget}`);
  return updated.result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPagesDomain() {
  const listPath = `/client/v4/accounts/${config.accountId}/pages/projects/${config.project}/domains`;
  const domains = assertSuccess(await request("GET", listPath), "List Pages domains").result || [];
  return domains.find((item) => item.name === config.domain);
}

async function waitForDomainActive() {
  if (!config.waitActive) return;

  for (let attempt = 1; attempt <= config.waitAttempts; attempt += 1) {
    const domain = await getPagesDomain();
    const status = domain?.status || "missing";
    const verification = domain?.verification_data?.status || "unknown";
    const validation = domain?.validation_data?.status || "unknown";

    console.log(`Domain status poll ${attempt}/${config.waitAttempts}: status=${status}, verification=${verification}, validation=${validation}`);

    if (status === "active" && verification === "active" && validation === "active") {
      return;
    }

    await sleep(config.waitIntervalMs);
  }

  throw new Error(`Timed out waiting for ${config.domain} to become active`);
}

async function main() {
  await resolveAccountId();

  console.log(`Project: ${config.project}`);
  console.log(`GitHub: ${config.owner}/${config.repo}`);
  console.log(`Domain: ${config.domain}`);
  console.log(`Zone: ${config.zoneName}`);

  await ensureProject();
  console.log(`CNAME: ${config.domain} -> ${config.cnameTarget} (proxied=${config.proxied})`);
  await ensurePagesDomain();
  await ensureDnsCname();
  await waitForDomainActive();

  console.log("Next verification:");
  console.log(`  curl -I https://${config.cnameTarget}`);
  console.log(`  curl -I https://${config.domain}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
