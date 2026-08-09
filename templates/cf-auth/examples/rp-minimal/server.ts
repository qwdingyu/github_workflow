/**
 * cf-auth RP 最小接入示例 (Hono + Node)。
 *
 * 流程：/login → redirect cf-auth authorize (code+PKCE)
 *       /callback → code→token→userinfo → 发业务 JWT → redirect /
 *       /me → 业务 JWT → 显示 sub / email
 *
 * PKCE 代码基于 lottery 的 cf-auth-oauth.ts，与 cf-auth 的 require_pkce 兼容。
 */
import "dotenv/config";
import crypto from "node:crypto";
import { Hono } from "hono";
import * as jose from "jose";

const ISSUER = process.env.CF_AUTH_ISSUER!;       // e.g. https://auth.eforge.xyz
const CLIENT_ID = process.env.CLIENT_ID!;
const CLIENT_SECRET = process.env.CLIENT_SECRET!;
const REDIRECT_URI = process.env.REDIRECT_URI!;    // e.g. http://localhost:3000/callback
const JWT_SECRET = process.env.RP_JWT_SECRET!;

const app = new Hono();

/* ── 主页 ── */
app.get("/", (c) =>
  c.text("RP minimal — go to /login to sign in via cf-auth"));

/* ── 登录：生成 PKCE state + code_verifier，redirect cf-auth authorize ── */
app.get("/login", (c) => {
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: "openid profile email",
  });
  const login = `${ISSUER}/api/auth/authorize?${params.toString()}`;

  // 把 state + verifier 存进短期 cookie（生产请用 session 或签名 cookie）
  const cookie = JSON.stringify({ state, codeVerifier });
  return new Response(null, {
    status: 302,
    headers: {
      Location: login,
      "Set-Cookie": `cf_auth_pkce=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
});

/* ── 回调：code → token → userinfo → 发业务 JWT ── */
app.get("/callback", async (c) => {
  const query = c.req.query();
  const code = query.code;
  const state = query.state;
  if (!code || !state) return c.text("missing code or state", 400);

  // 校验 state + 读取 verifier
  const raw = c.req.header("Cookie")?.split(";").find((s) => s.trim().startsWith("cf_auth_pkce="));
  if (!raw) return c.text("missing PKCE cookie", 400);
  const stored = JSON.parse(decodeURIComponent(raw.split("=", 2)[1]!.trim()));
  if (stored.state !== state) return c.text("state mismatch", 400);

  // 换 token
  const tokenRes = await fetch(`${ISSUER}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: stored.codeVerifier,
    }),
  });
  const tokenBody = (await tokenRes.json()) as {
    access_token?: string;
    id_token?: string;
    error?: string;
  };
  if (!tokenBody.access_token) {
    return c.text(`token error: ${tokenBody.error ?? "unknown"}`, 400);
  }

  // 调 userinfo
  const uiRes = await fetch(`${ISSUER}/api/auth/userinfo`, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const ui = (await uiRes.json()) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  // 发业务 JWT（HS256 + 2h 过期）
  const jwt = await new jose.SignJWT({ sub: ui.sub, email: ui.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(JWT_SECRET));

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/me",
      "Set-Cookie": `rp_token=${jwt}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`,
    },
  });
});

/* ── 个人页：需业务 JWT ── */
app.get("/me", async (c) => {
  const token = c.req.header("Cookie")?.split(";").find((s) => s.trim().startsWith("rp_token="));
  if (!token) return c.text("not logged in — visit /login", 401);
  try {
    const { payload } = await jose.jwtVerify(
      token.split("=", 2)[1]!.trim(),
      new TextEncoder().encode(JWT_SECRET),
    );
    return c.json({ ok: true, user: payload });
  } catch {
    return c.text("invalid token — visit /login", 401);
  }
});

/* ── 启动 ── */
const port = 3000;
app.fetch = app.fetch.bind(app);
console.log(`RP minimal running on http://localhost:${port} — visit /login`);
export default { port, fetch: app.fetch }; // Node 兼容
