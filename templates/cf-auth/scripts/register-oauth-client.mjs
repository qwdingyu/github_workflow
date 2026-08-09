#!/usr/bin/env node
/**
 * 注册第一方 OAuth client。
 *
 * 优先路径（M7 收口后）：
 *   ADMIN_API_KEY 或 --api-key → POST /api/admin/clients
 *
 * 兼容路径（仅白名单管理员 session）：
 *   --email/--password 登录后 POST /api/auth/oauth2/create-client
 *   （普通用户会被 403；未配置 ADMIN_* 为 503）
 *
 * 用法：
 *   # 推荐
 *   ADMIN_API_KEY=... node scripts/register-oauth-client.mjs \
 *     --name cf-lottery-web \
 *     --redirect http://localhost:8787/auth/callback \
 *     --redirect https://lucky.eforge.xyz/auth/callback \
 *     --skip-consent
 *
 *   # 遗留：管理员邮箱会话
 *   node scripts/register-oauth-client.mjs \
 *     --email admin@example.com --password '...' \
 *     --name ... --redirect ... --skip-consent
 */
import "dotenv/config";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1] ?? fallback;
  return fallback;
}
function has(name) {
  return args.includes(`--${name}`);
}

const base = flag("base", process.env.BETTER_AUTH_URL || "http://localhost:8788").replace(
  /\/$/,
  "",
);
const email = flag("email");
const password = flag("password");
const apiKey =
  flag("api-key", process.env.ADMIN_API_KEY || "") || process.env.ADMIN_API_KEY || "";
const name = flag("name", "dev-client");
const redirects = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--redirect" && args[i + 1]) redirects.push(args[++i]);
}

if (redirects.length === 0) {
  console.error(
    "用法: --redirect <uri> [--redirect <uri2>] [--name] [--skip-consent] [--base]\n" +
      "  推荐: ADMIN_API_KEY 或 --api-key\n" +
      "  兼容: --email --password（须为 ADMIN_EMAILS 白名单）",
  );
  process.exit(1);
}

if (!apiKey && (!email || !password)) {
  console.error("需要 --api-key / ADMIN_API_KEY，或 --email + --password");
  process.exit(1);
}

async function createViaAdminApi(key) {
  const res = await fetch(`${base}/api/admin/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      "X-Admin-Api-Key": key,
    },
    body: JSON.stringify({
      name,
      redirect_uris: redirects,
      skip_consent: has("skip-consent"),
      require_pkce: true,
    }),
  });
  const text = await res.text();
  console.log("[admin/clients]", res.status, text.slice(0, 1200));
  return { res, text };
}

async function cookieFromSignIn() {
  let signIn = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password }),
  });
  if (!signIn.ok) {
    const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ email, password, name: "Auth Admin" }),
    });
    if (!signUp.ok) {
      console.error(
        "登录/注册失败",
        signIn.status,
        await signIn.text(),
        await signUp.text(),
      );
      process.exit(1);
    }
    signIn = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ email, password }),
    });
  }
  const setCookie = signIn.headers.getSetCookie?.() || [];
  let cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader) {
    const raw = signIn.headers.get("set-cookie") || "";
    cookieHeader = raw
      .split(/,(?=\s*[^;]+=)/)
      .map((p) => p.trim().split(";")[0])
      .filter(Boolean)
      .join("; ");
  }
  return cookieHeader;
}

async function createViaBaPath(cookieHeader) {
  // M7 后仅平台管理员可通过；普通用户 403
  const path = "/api/auth/oauth2/create-client";
  const createRes = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      name,
      client_name: name,
      redirect_uris: redirects,
    }),
  });
  const text = await createRes.text();
  console.log("[create-client]", path, createRes.status, text.slice(0, 1000));
  return { res: createRes, text };
}

async function main() {
  let text = "";
  let createRes;

  if (apiKey) {
    ({ res: createRes, text } = await createViaAdminApi(apiKey));
  } else {
    const cookie = await cookieFromSignIn();
    ({ res: createRes, text } = await createViaBaPath(cookie));
  }

  if (!createRes?.ok) {
    console.error(
      "创建 client 失败。优先用 ADMIN_API_KEY → /api/admin/clients；" +
        "或白名单管理员 session。普通用户 create-client 已收口为 403。",
    );
    process.exit(1);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    process.exit(0);
  }

  // Admin API 响应：{ ok, client, clientSecret }
  // BA create-client：字段名可能 client_id / clientId
  const clientId =
    body.client?.clientId ||
    body.client_id ||
    body.clientId ||
    body.data?.client_id;
  const secret =
    body.clientSecret || body.client_secret || body.data?.client_secret;

  console.log(
    JSON.stringify(
      {
        clientId,
        clientSecret: secret,
        note: "请立即保存 secret；列表接口永不回传",
        via: apiKey ? "admin-api" : "create-client",
      },
      null,
      2,
    ),
  );

  // 遗留：BA 路径若 skip_consent 未生效，可再跑 set-oauth-client-skip-consent
  if (has("skip-consent") && !apiKey && clientId) {
    console.log(
      "提示：若 BA 路径未写 skip_consent，请用 scripts/set-oauth-client-skip-consent.mjs 或 Admin PATCH",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
