/**
 * 生产（或指定 base）全面冒烟：真实 HTTPS 打已部署 Worker，不断言假造路径。
 *
 * 用法：
 *   PROD_BASE_URL=https://auth.eforge.xyz node scripts/prod-smoke.mjs
 *   npm run smoke:prod
 *
 * 可选：
 *   SMOKE_OUT_DIR=...  写入各响应文件（默认 ./ 不写；CI/本地可设 scratch）
 *   从 .env 读 GOOGLE/GITHUB secret 仅用于「响应不得泄露」检查（不上传）
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.PROD_BASE_URL || "https://auth.eforge.xyz").replace(/\/$/, "");
const OUT = process.env.SMOKE_OUT_DIR || "";
const googleSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
const githubSecret = process.env.GITHUB_CLIENT_SECRET?.trim() || "";

const failures = [];
const notes = [];

function save(name, body) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const p = join(OUT, name);
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function noSecretLeak(text, label) {
  if (googleSecret && text.includes(googleSecret)) {
    failures.push(`${label} 泄露 GOOGLE_CLIENT_SECRET`);
  }
  if (githubSecret && text.includes(githubSecret)) {
    failures.push(`${label} 泄露 GITHUB_CLIENT_SECRET`);
  }
}

async function req(path, init = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    redirect: init.redirect ?? "manual",
    ...init,
    headers: {
      Origin: BASE,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  return { res, text, url };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    failures.push(`${label} 非 JSON: ${text.slice(0, 120)}`);
    return null;
  }
}

console.log(`[prod-smoke] base=${BASE}`);

// ── 1) health ×2 ──────────────────────────────────────────
const healthBodies = [];
for (const i of [1, 2]) {
  const { res, text } = await req("/api/health");
  assert(res.status === 200, `health#${i} status=${res.status}`);
  const body = parseJson(text, `health#${i}`);
  if (body) {
    assert(body.ok === true, `health#${i} ok`);
    assert(body.db === true, `health#${i} db`);
    assert(body.service === "cf-auth", `health#${i} service`);
    const sp = body.socialProviders || [];
    assert(sp.includes("google"), `health#${i} missing google`);
    assert(sp.includes("github"), `health#${i} missing github`);
    // M7 加固：是否已配平台管理员（布尔，不泄露邮箱/Key）
    assert(
      typeof body.adminConfigured === "boolean",
      `health#${i} 缺 adminConfigured`,
    );
    if (body.adminConfigured !== true) {
      notes.push(
        `health#${i} adminConfigured=false（生产应配置 ADMIN_EMAILS 或 ADMIN_API_KEY）`,
      );
    }
    noSecretLeak(text, `health#${i}`);
    healthBodies.push(body);
    save(`prod-health-${i}.json`, body);
  }
}
assert(
  healthBodies.length === 2 &&
    JSON.stringify(healthBodies[0].socialProviders) ===
      JSON.stringify(healthBodies[1].socialProviders),
  "health 两次 socialProviders 不一致",
);

// ── 2) meta ───────────────────────────────────────────────
{
  const { res, text } = await req("/api/auth-meta/social");
  assert(res.status === 200, `meta status=${res.status}`);
  const body = parseJson(text, "meta");
  if (body) {
    const ids = (body.providers || []).map((p) => p.id);
    assert(ids.includes("google"), "meta missing google");
    assert(ids.includes("github"), "meta missing github");
    assert(body.baseURL === BASE || body.baseURL?.includes("auth.eforge.xyz"), `meta baseURL=${body.baseURL}`);
    noSecretLeak(text, "meta");
    save("prod-meta.json", body);
  }
}

// ── 3) sign-in HTML ───────────────────────────────────────
{
  const { res, text } = await req("/sign-in");
  assert(res.status === 200, `sign-in status=${res.status}`);
  assert(/text\/html/i.test(res.headers.get("content-type") || ""), "sign-in not html");
  assert(/登录|sign-in|social|Google|GitHub|cf-auth/i.test(text), "sign-in 缺登录线索");
  noSecretLeak(text, "sign-in");
  save("prod-signin.html", text);
}

// ── 4) well-known AS + OIDC ───────────────────────────────
{
  const { res, text } = await req("/.well-known/oauth-authorization-server/api/auth");
  assert(res.status === 200, `AS status=${res.status}`);
  const body = parseJson(text, "AS");
  if (body) {
    assert(
      Boolean(body.issuer || body.authorization_endpoint || body.token_endpoint),
      "AS 缺 issuer/authorization/token",
    );
    const blob = JSON.stringify(body);
    assert(/auth\.eforge\.xyz|\/api\/auth/i.test(blob), "AS 未体现本服务路径");
    noSecretLeak(text, "AS");
    save("prod-as.json", body);
  }
}
{
  let { res, text } = await req("/.well-known/openid-configuration");
  if (res.status !== 200) {
    ({ res, text } = await req("/api/auth/.well-known/openid-configuration"));
  }
  assert(res.status === 200, `OIDC status=${res.status}`);
  const body = parseJson(text, "OIDC");
  if (body) {
    assert(Boolean(body.issuer || body.authorization_endpoint), "OIDC 缺关键字段");
    noSecretLeak(text, "OIDC");
    save("prod-oidc.json", body);
  }
}

// ── 5) social sign-in google / github ─────────────────────
async function social(provider) {
  const { res, text } = await req("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      callbackURL: `${BASE}/`,
      disableRedirect: true,
    }),
  });
  assert(res.status === 200, `social ${provider} status=${res.status} body=${text.slice(0, 200)}`);
  const body = parseJson(text, `social ${provider}`);
  if (!body?.url) {
    failures.push(`social ${provider} 无 url`);
    return;
  }
  let host = "";
  try {
    host = new URL(body.url).host;
  } catch {
    failures.push(`social ${provider} url 非法`);
    return;
  }
  if (provider === "google") {
    assert(/accounts\.google\.com/i.test(host), `google host=${host}`);
    assert(
      body.url.includes(encodeURIComponent(`${BASE}/api/auth/callback/google`)) ||
        body.url.includes(`${BASE}/api/auth/callback/google`) ||
        body.url.includes("callback%2Fgoogle") ||
        body.url.includes("callback/google"),
      "google 缺 production callback",
    );
  } else {
    assert(/github\.com/i.test(host), `github host=${host}`);
    assert(
      body.url.includes(encodeURIComponent(`${BASE}/api/auth/callback/github`)) ||
        body.url.includes(`${BASE}/api/auth/callback/github`) ||
        body.url.includes("callback%2Fgithub") ||
        body.url.includes("callback/github"),
      "github 缺 production callback",
    );
  }
  noSecretLeak(text, `social ${provider}`);
  // 脱敏：保留 url 结构，去掉可能的敏感 query 以外的 secret（已检查）
  save(`prod-social-${provider}.json`, {
    status: 200,
    host,
    url: body.url,
    redirect: body.redirect ?? false,
  });
}

await social("google");
await social("github");

// ── 6) unauthenticated authorize（安全行为，禁止 5xx）────────
// 无有效 client 时：302/200 到 error 或 sign-in；有 PROD_OAUTH_CLIENT_ID 时：期望 → sign-in 且保留参数
{
  const clientId =
    process.env.PROD_OAUTH_CLIENT_ID?.trim() || "prod-smoke-nonexistent-client";
  const redirectUri =
    process.env.PROD_OAUTH_REDIRECT_URI?.trim() || `${BASE}/`;
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile email",
    state: "smoke-state",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
  });
  const { res, text } = await req(`/api/auth/oauth2/authorize?${q}`, {
    redirect: "manual",
  });
  const loc = res.headers.get("location") || "";
  const status = res.status;
  assert(status < 500, `authorize 5xx status=${status} body=${text.slice(0, 200)}`);
  // fetch manual：部分实现用 200+JSON {redirect,url} 代替 302
  let effectiveLoc = loc;
  try {
    const j = JSON.parse(text);
    if (j?.url) effectiveLoc = j.url;
  } catch {
    /* plain */
  }
  const safeShape =
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308 ||
    status === 401 ||
    status === 400 ||
    status === 403 ||
    (status === 200 &&
      (/sign-in|login|consent|error|invalid_client|redirect/i.test(text) ||
        /sign-in|login|error/i.test(effectiveLoc)));
  assert(safeShape, `authorize 非预期 status=${status} loc=${effectiveLoc.slice(0, 120)}`);
  if (effectiveLoc) {
    notes.push(`authorize effectiveLoc=${effectiveLoc.slice(0, 240)}`);
    if (/sign-in|login/i.test(effectiveLoc)) {
      assert(
        /client_id|response_type|code_challenge|scope/i.test(effectiveLoc) ||
          effectiveLoc.includes("sign-in"),
        "authorize→sign-in 未保留可识别 OAuth 意图",
      );
    }
  }
  // 未知 client 时 invalid_client / error 也算安全（非崩溃）
  if (!process.env.PROD_OAUTH_CLIENT_ID) {
    notes.push("authorize 使用不存在的 client_id（期望 invalid_client 或 sign-in，非 5xx）");
  }
  save(
    "prod-authorize.txt",
    `status=${status}\nlocation=${loc}\neffectiveLoc=${effectiveLoc}\nbody_head=${text.slice(0, 500)}\n`,
  );
}

// ── 7) controlled 404 ─────────────────────────────────────
{
  const { res, text } = await req("/api/no-such-route-prod-smoke");
  assert(res.status === 404, `404 status=${res.status}`);
  assert(!/Internal Server Error|Worker threw/i.test(text), "404 像崩溃页");
  const body = parseJson(text, "404");
  if (body) {
    assert(body.error === "not_found" || body.error || body.message, "404 JSON 缺 error");
  }
  save("prod-404.txt", `status=${res.status}\nbody=${text}\n`);
}

// ── 8) Admin 面与 SPA 路由隔离 ─────────────────────────────
{
  // 未带凭证：已配置 ADMIN_* → 401；未配置 → 503（都不是 5xx 崩溃）
  const { res, text } = await req("/api/admin/health");
  assert(
    res.status === 401 || res.status === 503,
    `admin/health 无凭证应 401/503，实际 ${res.status}`,
  );
  assert(res.status < 500 || res.status === 503, `admin/health 意外 ${res.status}`);
  notes.push(`admin/health unauth status=${res.status}`);
  save("prod-admin-health-unauth.txt", `status=${res.status}\nbody=${text.slice(0, 400)}\n`);

  // 首页须是协议页（Worker），不能被 SPA index 抢走
  const home = await req("/");
  assert(home.res.status === 200, `home status=${home.res.status}`);
  assert(/cf-auth|登录|sign-in/i.test(home.text), "home 缺协议页线索");
  // 若被 SPA 抢走，通常是 Vite 壳 + app div 且无协议文案
  assert(
    !/id="app"[\s\S]*<script type="module"/i.test(home.text) || /平台管理|\/sign-in/i.test(home.text),
    "home 疑似被 Admin SPA 抢走",
  );

  // /admin 应返回 SPA HTML（部署后 public/index.html）
  const adminPage = await req("/admin");
  assert(adminPage.res.status === 200, `admin page status=${adminPage.res.status}`);
  assert(
    /text\/html/i.test(adminPage.res.headers.get("content-type") || ""),
    "admin 非 html",
  );
  assert(
    /cf-auth|admin|登录|platform/i.test(adminPage.text),
    "admin 页缺 SPA 线索",
  );
  notes.push(`admin SPA status=${adminPage.res.status} len=${adminPage.text.length}`);
  save("prod-admin-spa-head.html", adminPage.text.slice(0, 800));
}

// ── 9) create-client 收口（无凭证）────────────────────────
{
  const { res, text } = await req("/api/auth/oauth2/create-client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "prod-smoke-should-deny",
      redirect_uris: [`${BASE}/`],
    }),
  });
  // 未配置管理员 503；已配置但无身份 403（或 BA 层 401）
  assert(
    res.status === 403 || res.status === 503 || res.status === 401,
    `create-client 应收口，实际 ${res.status} body=${text.slice(0, 160)}`,
  );
  notes.push(`create-client unauth status=${res.status}`);
  save("prod-create-client-deny.txt", `status=${res.status}\nbody=${text.slice(0, 400)}\n`);
}

// ── summary ───────────────────────────────────────────────
const summary = {
  base: BASE,
  ok: failures.length === 0,
  failureCount: failures.length,
  failures,
  notes,
};
save("prod-smoke-summary.json", summary);
console.log(JSON.stringify(summary, null, 2));
if (failures.length) {
  console.error("[prod-smoke] FAILED");
  process.exit(2);
}
console.log("[prod-smoke] OK");
process.exit(0);
