#!/usr/bin/env node

/*
 * Cloudflare 配置层安全基线脚本。
 *
 * 使用边界：
 * - 作用对象是整个 Cloudflare zone，不是单个 Pages/Worker 项目的代码。
 * - 默认只预览计划；只有 CF_APPLY=true 时才会写入 Cloudflare。
 * - 脚本只增量维护 ref 以 cf_baseline_ 开头的规则，不删除、不覆盖其他人工规则。
 * - 免费层 WAF Custom Rules 数量有限，因此规则必须少而准，避免把配额耗尽。
 * - Zone Settings 权限不足时默认跳过并继续执行 WAF；需要严格失败时设置 CF_ZONE_SETTINGS_REQUIRED=true。
 *
 * 典型场景：
 * - static：纯静态站，阻断危险路径，可选阻断非 GET/HEAD。
 * - app：静态站 + API，阻断危险路径，管理路径 Managed Challenge。
 * - form：表单/发卡类，边缘层只做基础拦截，公开写接口仍必须在代码层接 Turnstile 和限流。
 *
 * 必填环境变量：
 * - CF_CUSTOM_DOMAIN：单个目标域名，例如 acctbox.eforge.xyz。
 * - 或 CF_TARGET_HOSTNAMES：多个目标域名，英文逗号分隔，例如 a.example.com,b.example.com。
 * - 鉴权二选一：
 *   1. CF_API_TOKEN：Cloudflare API Token，推荐 scoped token。
 *   2. CF_AUTH_EMAIL + CF_GLOBAL_API_KEY：Cloudflare 登录邮箱和 Global API Key，仅建议临时兜底。
 *
 * 可选定位变量：
 * - CF_ZONE_ID：直接指定 zone id，最稳。
 * - CF_ZONE_NAME：指定 zone 名，例如 eforge.xyz；未提供时从目标域名推导。
 *
 * 可选行为变量：
 * - CF_APPLY=true：真正写入 Cloudflare；不设置时只预览。
 * - CF_SECURITY_SCENARIO=static|app|form：选择防护场景，默认 app。
 * - CF_ENABLE_ZONE_SETTINGS=false：跳过 HTTPS/TLS/Brotli/Browser Check 等 zone 设置。
 * - CF_ENABLE_WAF_RULES=false：跳过 WAF Custom Rules。
 * - CF_ENABLE_HEADER_TRANSFORM=true：启用响应头 Transform Rule，默认关闭。
 * - CF_BLOCK_STATIC_UNSAFE_METHODS=true：纯静态站阻断非 GET/HEAD。
 * - CF_ZONE_SETTINGS_REQUIRED=true：Zone Settings 写入失败时直接失败，默认权限不足就跳过并继续 WAF。
 * - CF_APPLY_SSL_MODE=true + CF_SSL_MODE=full：显式修改 SSL mode，默认不改。
 * - CF_ADMIN_PATHS="/admin,/internal"：管理路径列表，默认 /admin,/internal。
 * - CF_DANGEROUS_PATHS="/.env,/.git,/wp-admin"：危险扫描路径列表。
 * - CF_REQUEST_TIMEOUT_MS=15000：单次 Cloudflare API 请求超时。
 *
 * 常用命令：
 * - 预览：
 *   CF_API_TOKEN="<token>" CF_CUSTOM_DOMAIN="acctbox.eforge.xyz" rtk node scripts/cloudflare/security_baseline.mjs
 * - 实际写入：
 *   CF_API_TOKEN="<token>" CF_CUSTOM_DOMAIN="acctbox.eforge.xyz" CF_APPLY=true rtk node scripts/cloudflare/security_baseline.mjs
 * - 只写 WAF，不碰 Zone Settings：
 *   CF_API_TOKEN="<token>" CF_CUSTOM_DOMAIN="acctbox.eforge.xyz" CF_ENABLE_ZONE_SETTINGS=false CF_APPLY=true rtk node scripts/cloudflare/security_baseline.mjs
 */

import https from "node:https";

const env = process.env;

const config = {
  zoneId: env.CF_ZONE_ID,
  zoneName: env.CF_ZONE_NAME || inferZoneName(env.CF_CUSTOM_DOMAIN || env.CF_TARGET_HOSTNAMES || ""),
  targetHostnames: splitCsv(env.CF_TARGET_HOSTNAMES || env.CF_CUSTOM_DOMAIN || ""),
  scenario: env.CF_SECURITY_SCENARIO || "app",
  apply: env.CF_APPLY === "true",
  enableZoneSettings: env.CF_ENABLE_ZONE_SETTINGS !== "false",
  enableWafRules: env.CF_ENABLE_WAF_RULES !== "false",
  enableHeaderTransform: env.CF_ENABLE_HEADER_TRANSFORM === "true",
  blockStaticUnsafeMethods: env.CF_BLOCK_STATIC_UNSAFE_METHODS === "true",
  applySslMode: env.CF_APPLY_SSL_MODE === "true",
  zoneSettingsRequired: env.CF_ZONE_SETTINGS_REQUIRED === "true",
  sslMode: env.CF_SSL_MODE || "full",
  minTlsVersion: env.CF_MIN_TLS_VERSION || "1.2",
  securityLevel: env.CF_SECURITY_LEVEL || "medium",
  challengeTtl: Number.parseInt(env.CF_CHALLENGE_TTL || "1800", 10),
  adminPaths: splitCsv(env.CF_ADMIN_PATHS || "/admin,/internal"),
  dangerousPaths: splitCsv(env.CF_DANGEROUS_PATHS || "/.env,/.git,/wp-admin,/wp-login.php,/phpmyadmin,/vendor,/node_modules"),
  requestRetries: Number.parseInt(env.CF_REQUEST_RETRIES || "3", 10),
  requestRetryDelayMs: Number.parseInt(env.CF_REQUEST_RETRY_DELAY_MS || "1000", 10),
  requestTimeoutMs: Number.parseInt(env.CF_REQUEST_TIMEOUT_MS || "15000", 10)
};

const required = [];
if (!config.zoneId && !config.zoneName) required.push("CF_ZONE_ID 或 CF_ZONE_NAME/CF_CUSTOM_DOMAIN");
if (config.targetHostnames.length === 0) required.push("CF_TARGET_HOSTNAMES 或 CF_CUSTOM_DOMAIN");
if (required.length > 0) {
  console.error(`Missing required env: ${required.join(", ")}`);
  process.exit(2);
}

function splitCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferZoneName(value) {
  const first = splitCsv(value)[0];
  if (!first) return "";
  const labels = first.split(".").filter(Boolean);
  if (labels.length < 2) return "";
  return labels.slice(-2).join(".");
}

function quote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function hostnameExpression() {
  if (config.targetHostnames.length === 1) {
    return `http.host eq ${quote(config.targetHostnames[0])}`;
  }
  return `http.host in {${config.targetHostnames.map(quote).join(" ")}}`;
}

function pathStartsExpression(paths) {
  return paths
    .map((path) => `starts_with(http.request.uri.path, ${quote(path)})`)
    .join(" or ");
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function singleRequest(method, path, body) {
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

    req.setTimeout(config.requestTimeoutMs, () => {
      req.destroy(new Error(`Cloudflare API request timeout after ${config.requestTimeoutMs}ms`));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function request(method, path, body) {
  let lastError;

  for (let attempt = 1; attempt <= config.requestRetries + 1; attempt += 1) {
    try {
      const response = await singleRequest(method, path, body);
      if (response.statusCode < 500 && response.statusCode !== 429) return response;
      if (attempt > config.requestRetries) return response;
      console.log(`重试 Cloudflare API ${method} ${path}: HTTP ${response.statusCode} (${attempt}/${config.requestRetries})`);
    } catch (error) {
      lastError = error;
      if (attempt > config.requestRetries) break;
      console.log(`重试 Cloudflare API ${method} ${path}: ${error.message} (${attempt}/${config.requestRetries})`);
    }

    await sleep(config.requestRetryDelayMs);
  }

  throw lastError;
}

function assertSuccess(response, label) {
  if (response.json?.success) return response.json;
  throw new Error(`${label} failed: HTTP ${response.statusCode} ${JSON.stringify(response.json?.errors || response.json)}`);
}

function isPermissionError(response) {
  const errors = response.json?.errors || [];
  return response.statusCode === 403 || errors.some((error) => String(error.code) === "10000");
}

async function resolveZoneId() {
  if (config.zoneId) return config.zoneId;

  const zones = assertSuccess(
    await request("GET", `/client/v4/zones?name=${encodeURIComponent(config.zoneName)}`),
    "Find zone"
  ).result || [];

  if (zones.length !== 1) {
    throw new Error(`Cannot infer unique zone for ${config.zoneName}; set CF_ZONE_ID.`);
  }

  config.zoneId = zones[0].id;
  console.log(`推导 zone: ${zones[0].name} (${config.zoneId})`);
  return config.zoneId;
}

function zoneSettingPlan() {
  const settings = [
    ["always_use_https", "on"],
    ["automatic_https_rewrites", "on"],
    ["min_tls_version", config.minTlsVersion],
    ["tls_1_3", "on"],
    ["brotli", "on"],
    ["browser_check", "on"],
    ["challenge_ttl", config.challengeTtl],
    ["security_level", config.securityLevel]
  ];

  if (config.applySslMode) {
    settings.push(["ssl", config.sslMode]);
  }

  return settings;
}

async function applyZoneSettings() {
  if (!config.enableZoneSettings) return;
  await resolveZoneId();

  for (const [setting, value] of zoneSettingPlan()) {
    if (!config.apply) {
      console.log(`[预览] Zone setting ${setting} -> ${value}`);
      continue;
    }

    const response = await request("PATCH", `/client/v4/zones/${config.zoneId}/settings/${setting}`, { value });

    if (!response.json?.success && isPermissionError(response) && !config.zoneSettingsRequired) {
      console.log(`跳过 Zone setting ${setting}: 当前凭据没有 Zone Settings 写权限。设置 CF_ZONE_SETTINGS_REQUIRED=true 可改为严格失败。`);
      continue;
    }

    const result = assertSuccess(response, `Update zone setting ${setting}`).result;
    console.log(`已更新 Zone setting: ${result.id}=${result.value}`);
  }
}

function wafRules() {
  const host = hostnameExpression();
  const rules = [];

  if (config.dangerousPaths.length > 0) {
    rules.push({
      ref: "cf_baseline_block_dangerous_paths",
      description: "基础防护：阻断常见扫描和敏感路径",
      expression: `(${host} and (${pathStartsExpression(config.dangerousPaths)}))`,
      action: "block",
      enabled: true
    });
  }

  if (config.adminPaths.length > 0) {
    rules.push({
      ref: "cf_baseline_challenge_admin_paths",
      description: "基础防护：管理路径使用 Managed Challenge",
      expression: `(${host} and (${pathStartsExpression(config.adminPaths)}))`,
      action: "managed_challenge",
      enabled: true
    });
  }

  if (config.scenario === "static" && config.blockStaticUnsafeMethods) {
    rules.push({
      ref: "cf_baseline_static_method_allowlist",
      description: "基础防护：纯静态站只允许 GET/HEAD",
      expression: `(${host} and not (http.request.method in {"GET" "HEAD"}))`,
      action: "block",
      enabled: true
    });
  }

  return rules;
}

function responseHeaderRule() {
  return {
    ref: "cf_baseline_security_headers",
    description: "基础防护：为目标域名补充安全响应头",
    expression: `(${hostnameExpression()})`,
    action: "rewrite",
    action_parameters: {
      headers: {
        "X-Content-Type-Options": { operation: "set", value: "nosniff" },
        "Referrer-Policy": { operation: "set", value: "strict-origin-when-cross-origin" },
        "X-Frame-Options": { operation: "set", value: "DENY" },
        "Permissions-Policy": { operation: "set", value: "camera=(), microphone=(), geolocation=(), payment=()" }
      }
    },
    enabled: true
  };
}

async function getEntrypoint(phase) {
  await resolveZoneId();
  const response = await request("GET", `/client/v4/zones/${config.zoneId}/rulesets/phases/${phase}/entrypoint`);
  if (response.json?.success) return response.json.result;
  const errors = response.json?.errors || [];
  const notFound = response.statusCode === 404 || errors.some((error) => String(error.code) === "10015");
  if (notFound) return undefined;
  assertSuccess(response, `Get ruleset entrypoint ${phase}`);
}

async function upsertRulesetRules(phase, name, incomingRules) {
  if (incomingRules.length === 0) return;

  if (!config.apply) {
    for (const rule of incomingRules) {
      console.log(`[预览] Ruleset ${phase}: ${rule.ref} -> ${rule.action}`);
      console.log(`       ${rule.expression}`);
    }
    return;
  }

  const current = await getEntrypoint(phase);
  const currentRules = current?.rules || [];
  const incomingRefs = new Set(incomingRules.map((rule) => rule.ref));
  const preservedRules = currentRules.filter((rule) => !incomingRefs.has(rule.ref));
  const rules = [...preservedRules, ...incomingRules];

  if (!current) {
    const created = assertSuccess(
      await request("POST", `/client/v4/zones/${config.zoneId}/rulesets`, {
        name,
        description: "由安全基线脚本创建的 zone 级规则集",
        kind: "zone",
        phase,
        rules
      }),
      `Create ruleset ${phase}`
    ).result;
    console.log(`已创建 Ruleset: ${created.name} (${created.phase}) rules=${created.rules?.length || 0}`);
    return;
  }

  const updated = assertSuccess(
    await request("PUT", `/client/v4/zones/${config.zoneId}/rulesets/${current.id}`, {
      name: current.name || name,
      description: current.description || "由安全基线脚本维护的 zone 级规则集",
      kind: current.kind || "zone",
      phase,
      rules
    }),
    `Update ruleset ${phase}`
  ).result;
  console.log(`已更新 Ruleset: ${updated.name} (${updated.phase}) rules=${updated.rules?.length || 0}`);
}

async function applyRules() {
  if (config.enableWafRules) {
    await upsertRulesetRules(
      "http_request_firewall_custom",
      "Zone-level baseline WAF custom rules",
      wafRules()
    );
  }

  if (config.enableHeaderTransform) {
    await upsertRulesetRules(
      "http_response_headers_transform",
      "Zone-level baseline response header transform rules",
      [responseHeaderRule()]
    );
  }
}

console.log(`Cloudflare 安全基线：${config.apply ? "执行写入" : "仅预览"}，场景=${config.scenario}`);
console.log(`目标域名：${config.targetHostnames.join(", ")}`);
await applyZoneSettings();
await applyRules();
console.log(config.apply ? "安全基线执行完成。" : "预览完成。设置 CF_APPLY=true 后才会写入 Cloudflare。");
