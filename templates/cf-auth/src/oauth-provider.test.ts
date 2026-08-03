/**
 * OAuth Provider 本地闭环（授权码 + PKCE）。
 * 使用官方 auth.api.createOAuthClient / adminUpdateOAuthClient，不自研协议。
 */
import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTestDbs,
  cookieHeaderFrom,
  createTestApp,
  jsonPost,
  mergeCookies,
} from "./test-helpers";

afterEach(async () => {
  await cleanupTestDbs();
});

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function makePkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function signInCookie(app: Awaited<ReturnType<typeof createTestApp>>["app"], email: string) {
  const signUp = await app.request(
    "/api/auth/sign-up/email",
    jsonPost({
      name: "OAuth User",
      email,
      password: "strong-password-123",
    }),
  );
  expect(signUp.status).toBe(200);
  let cookie = cookieHeaderFrom(signUp.headers.get("set-cookie"));
  const login = await app.request(
    "/api/auth/sign-in/email",
    jsonPost({ email, password: "strong-password-123" }),
  );
  expect(login.status).toBe(200);
  cookie = mergeCookies(cookie, cookieHeaderFrom(login.headers.get("set-cookie")));
  return cookie;
}

describe("OAuth Provider", () => {
  it("未登录 authorize 重定向到 /sign-in 并保留 OAuth 参数", async () => {
    const { app, auth } = await createTestApp({ enableOAuthProvider: true });
    const cookie = await signInCookie(app, "owner-unauth@example.com");
    const created = await auth.api.createOAuthClient({
      body: {
        client_name: "rp-unauth",
        redirect_uris: ["http://localhost:8787/cb"],
      },
      headers: new Headers({ cookie, origin: "http://localhost:8788" }),
    });
    const clientId = (created as { client_id: string }).client_id;
    const { challenge } = makePkce();

    const res = await app.request(
      "/api/auth/oauth2/authorize?" +
        new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: "http://localhost:8787/cb",
          scope: "openid profile email",
          state: "state-1",
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString(),
      { method: "GET", redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") || "";
    expect(loc.startsWith("/sign-in") || loc.includes("/sign-in")).toBe(true);
    expect(loc).toContain("client_id=");
  });

  it("已登录用户：创建 client → skip_consent → code → token → userinfo", async () => {
    const { app, auth } = await createTestApp({ enableOAuthProvider: true });
    const cookie = await signInCookie(app, "oauth-flow@example.com");

    const created = (await auth.api.createOAuthClient({
      body: {
        client_name: "cf-lottery-dev",
        redirect_uris: ["http://localhost:8787/auth/callback"],
      },
      headers: new Headers({ cookie, origin: "http://localhost:8788" }),
    })) as { client_id: string; client_secret: string };

    // 第一方 RP 可跳过同意页（实测 create 体不生效时用 adminUpdate）
    await auth.api.adminUpdateOAuthClient({
      body: {
        client_id: created.client_id,
        update: { skip_consent: true },
      },
      headers: new Headers({ cookie, origin: "http://localhost:8788" }),
    });

    const { verifier, challenge } = makePkce();
    const state = "lottery-state";

    const authz = await app.request(
      "/api/auth/oauth2/authorize?" +
        new URLSearchParams({
          response_type: "code",
          client_id: created.client_id,
          redirect_uri: "http://localhost:8787/auth/callback",
          scope: "openid profile email",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString(),
      { method: "GET", redirect: "manual", headers: { Cookie: cookie } },
    );
    expect(authz.status).toBe(302);
    const loc = authz.headers.get("location") || "";
    expect(loc).toContain("http://localhost:8787/auth/callback");
    expect(loc).toContain("code=");
    expect(loc).toContain(`state=${state}`);

    const code = new URL(loc).searchParams.get("code");
    expect(code).toBeTruthy();

    const basic = Buffer.from(`${created.client_id}:${created.client_secret}`).toString("base64");
    const tokenRes = await app.request("/api/auth/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        Origin: "http://localhost:8788",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: "http://localhost:8787/auth/callback",
        code_verifier: verifier,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokenBody = (await tokenRes.json()) as {
      access_token: string;
      id_token: string;
      token_type: string;
    };
    expect(tokenBody.access_token).toBeTruthy();
    expect(tokenBody.id_token).toBeTruthy();
    expect(tokenBody.token_type.toLowerCase()).toBe("bearer");

    const userinfo = await app.request("/api/auth/oauth2/userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(userinfo.status).toBe(200);
    const profile = (await userinfo.json()) as { sub: string; email: string };
    expect(profile.email).toBe("oauth-flow@example.com");
    expect(profile.sub).toBeTruthy();
  });

  it("well-known OAuth AS metadata 可访问", async () => {
    const { app } = await createTestApp({ enableOAuthProvider: true });
    const res = await app.request("/.well-known/oauth-authorization-server/api/auth");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { issuer?: string; authorization_endpoint?: string };
    expect(body.issuer || body.authorization_endpoint).toBeTruthy();
  });

  it("错误 redirect_uri 不能换出合法授权码到攻击域", async () => {
    const { app, auth } = await createTestApp({ enableOAuthProvider: true });
    const cookie = await signInCookie(app, "oauth-redir@example.com");
    const created = (await auth.api.createOAuthClient({
      body: {
        client_name: "rp-strict",
        redirect_uris: ["http://localhost:8787/auth/callback"],
      },
      headers: new Headers({ cookie, origin: "http://localhost:8788" }),
    })) as { client_id: string };
    await auth.api.adminUpdateOAuthClient({
      body: { client_id: created.client_id, update: { skip_consent: true } },
      headers: new Headers({ cookie, origin: "http://localhost:8788" }),
    });
    const { challenge } = makePkce();
    const res = await app.request(
      "/api/auth/oauth2/authorize?" +
        new URLSearchParams({
          response_type: "code",
          client_id: created.client_id,
          redirect_uri: "https://evil.example/steal",
          scope: "openid",
          state: "x",
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString(),
      { redirect: "manual", headers: { Cookie: cookie } },
    );
    const loc = res.headers.get("location") || "";
    expect(loc.includes("evil.example") && loc.includes("code=")).toBe(false);
    // 400 或 error 重定向均可
    expect(res.status === 400 || res.status === 302 || res.status === 303).toBe(true);
    if (res.status === 302 || res.status === 303) {
      expect(loc.includes("error=") || loc.includes("sign-in") || loc.includes("consent")).toBe(true);
    }
  });
});
