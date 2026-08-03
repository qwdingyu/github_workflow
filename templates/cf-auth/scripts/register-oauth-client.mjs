#!/usr/bin/env node
/**
 * 注册第一方 OAuth client（需已有用户 session cookie 或后续扩展 admin 密钥）。
 *
 * 用法（本地服务已启动）：
 *   node scripts/register-oauth-client.mjs \
 *     --email owner@example.com --password '...' \
 *     --name cf-lottery-web \
 *     --redirect http://localhost:8787/auth/callback \
 *     --redirect https://lucky.eforge.xyz/auth/callback \
 *     --skip-consent
 *
 * 依赖正在运行的 cf-auth（默认 http://localhost:8788）。
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

const base = flag("base", process.env.BETTER_AUTH_URL || "http://localhost:8788").replace(/\/$/, "");
const email = flag("email");
const password = flag("password");
const name = flag("name", "dev-client");
const redirects = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--redirect" && args[i + 1]) redirects.push(args[++i]);
}
if (!email || !password || redirects.length === 0) {
  console.error("用法: --email --password --redirect <uri> [--redirect <uri2>] [--name] [--skip-consent] [--base]");
  process.exit(1);
}

async function main() {
  const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password }),
  });
  if (!signIn.ok) {
    // 尝试注册
    const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ email, password, name: "Auth Admin" }),
    });
    if (!signUp.ok) {
      console.error("登录/注册失败", signIn.status, await signIn.text(), await signUp.text());
      process.exit(1);
    }
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

  // 通过 HTTP 动态注册默认关闭；使用 cookie 调 create 端点
  const createRes = await fetch(`${base}/api/auth/oauth2/client`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      name,
      redirect_uris: redirects,
    }),
  });

  // 若路径不同，打印响应便于对齐官方路由
  const text = await createRes.text();
  console.log("[create]", createRes.status, text.slice(0, 1000));
  if (!createRes.ok) {
    console.error("创建 client 失败。也可在已登录会话下用 vitest/OAuth API。");
    process.exit(1);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    process.exit(0);
  }

  if (has("skip-consent") && body.client_id) {
    const upd = await fetch(`${base}/api/auth/oauth2/client/admin-update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        client_id: body.client_id,
        update: { skip_consent: true },
      }),
    });
    console.log("[skip-consent]", upd.status, (await upd.text()).slice(0, 500));
  }

  console.log("\n请安全保存 client_id / client_secret，仅显示一次 secret。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
