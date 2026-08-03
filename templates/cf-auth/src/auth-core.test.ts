/**
 * Better Auth 核心：注册 / 登录 / session / Google URL（假 client）。
 * 对齐 lottery docs/056 已验证行为。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTestDbs,
  cookieHeaderFrom,
  createTestApp,
  jsonPost,
} from "./test-helpers";

afterEach(async () => {
  await cleanupTestDbs();
});

describe("Better Auth 核心", () => {
  it("邮箱注册、登录、get-session 闭环", async () => {
    const { app, client } = await createTestApp({ enableOAuthProvider: false });

    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        name: "Auth User",
        email: "auth-user@example.com",
        password: "strong-password-123",
      }),
    );
    expect(signUp.status).toBe(200);
    const signUpBody = (await signUp.json()) as { user: { email: string }; token?: string };
    expect(signUpBody.user.email).toBe("auth-user@example.com");

    const login = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({
        email: "auth-user@example.com",
        password: "strong-password-123",
      }),
    );
    expect(login.status).toBe(200);
    const cookie = cookieHeaderFrom(login.headers.get("set-cookie"));
    expect(cookie).toMatch(/better-auth\.session_token=/);

    const sessionRes = await app.request("/api/auth/get-session", {
      method: "GET",
      headers: { Cookie: cookie },
    });
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as {
      user: { email: string };
      session: { token: string };
    };
    expect(sessionBody.user.email).toBe("auth-user@example.com");
    expect(sessionBody.session.token).toBeTruthy();

    const rows = await client.execute(`SELECT COUNT(*) AS total FROM "user"`);
    expect(Number(rows.rows[0]?.total)).toBe(1);
  });

  it("Google provider 可生成授权 URL（非真实回调）", async () => {
    const { app } = await createTestApp({ enableOAuthProvider: false, google: true });

    const social = await app.request(
      "/api/auth/sign-in/social",
      jsonPost({
        provider: "google",
        callbackURL: "http://localhost:8788/",
        disableRedirect: true,
      }),
    );
    expect(social.status).toBe(200);
    const body = (await social.json()) as { url: string; redirect: boolean };
    expect(body.redirect).toBe(false);
    expect(body.url).toContain("https://accounts.google.com/o/oauth2");
    expect(body.url).toContain("client_id=google-client-id-for-smoke-test");
    expect(body.url).toContain("callback%2Fgoogle");
  });
});
