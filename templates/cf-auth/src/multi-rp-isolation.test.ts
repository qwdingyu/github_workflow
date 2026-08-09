/**
 * 多项目（多 OAuth client）同一用户：共享与隔离边界（docs/014）。
 *
 * 共享（有意）：auth 域 session Cookie、user.id 作为 public sub。
 * 隔离：client_id/secret/redirect、authorization code、access/refresh、id_token.aud。
 */
import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  cleanupTestDbs,
  cookieHeaderFrom,
  createTestApp,
  jsonPost,
  mergeCookies,
} from "./test-helpers";
import { oauthAccessToken, oauthClient } from "./db/schema";

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

async function signInCookie(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  email: string,
) {
  const signUp = await app.request(
    "/api/auth/sign-up/email",
    jsonPost({ name: "Multi RP", email, password: "strong-password-123" }),
  );
  expect(signUp.status).toBe(200);
  let cookie = cookieHeaderFrom(signUp.headers.get("set-cookie"));
  const login = await app.request(
    "/api/auth/sign-in/email",
    jsonPost({ email, password: "strong-password-123" }),
  );
  expect(login.status).toBe(200);
  cookie = mergeCookies(cookie, cookieHeaderFrom(login.headers.get("set-cookie")));
  return cookie!;
}

async function createRp(
  auth: Awaited<ReturnType<typeof createTestApp>>["auth"],
  cookie: string,
  name: string,
  redirect: string,
) {
  const created = (await auth.api.createOAuthClient({
    body: { client_name: name, redirect_uris: [redirect] },
    headers: new Headers({ cookie, origin: "http://localhost:8788" }),
  })) as { client_id: string; client_secret: string };
  await auth.api.adminUpdateOAuthClient({
    body: {
      client_id: created.client_id,
      update: { skip_consent: true },
    },
    headers: new Headers({ cookie, origin: "http://localhost:8788" }),
  });
  return created;
}

async function authorizeCode(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  cookie: string,
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string,
) {
  return app.request(
    "/api/auth/oauth2/authorize?" +
      new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "openid profile email",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString(),
    { method: "GET", redirect: "manual", headers: { Cookie: cookie } },
  );
}

async function exchange(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  clientId: string,
  secret: string,
  code: string,
  redirect: string,
  verifier: string,
) {
  return app.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64"),
      Origin: "http://localhost:8788",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
    }),
  });
}

describe("多 RP 同用户隔离", () => {
  it("同一 session：A/B 各自 code→token；aud 分离；同 sub；跨 client 换码失败", async () => {
    const { app, auth, db } = await createTestApp({ enableOAuthProvider: true });
    const cookie = await signInCookie(app, "multi-rp@example.com");

    const rpA = await createRp(
      auth,
      cookie,
      "rp-a",
      "http://localhost:8787/a/callback",
    );
    const rpB = await createRp(
      auth,
      cookie,
      "rp-b",
      "http://localhost:8787/b/callback",
    );
    expect(rpA.client_id).not.toBe(rpB.client_id);

    const pkceA = makePkce();
    const pkceB = makePkce();

    const azA = await authorizeCode(
      app,
      cookie,
      rpA.client_id,
      "http://localhost:8787/a/callback",
      pkceA.challenge,
      "state-a",
    );
    expect(azA.status).toBe(302);
    const codeA = new URL(azA.headers.get("location") || "").searchParams.get(
      "code",
    );
    expect(codeA).toBeTruthy();

    const azB = await authorizeCode(
      app,
      cookie,
      rpB.client_id,
      "http://localhost:8787/b/callback",
      pkceB.challenge,
      "state-b",
    );
    expect(azB.status).toBe(302);
    const codeB = new URL(azB.headers.get("location") || "").searchParams.get(
      "code",
    );
    expect(codeB).toBeTruthy();
    expect(codeA).not.toBe(codeB);

    const tokA = await exchange(
      app,
      rpA.client_id,
      rpA.client_secret,
      codeA!,
      "http://localhost:8787/a/callback",
      pkceA.verifier,
    );
    expect(tokA.status).toBe(200);
    const bodyA = (await tokA.json()) as {
      access_token: string;
      id_token: string;
    };

    const tokB = await exchange(
      app,
      rpB.client_id,
      rpB.client_secret,
      codeB!,
      "http://localhost:8787/b/callback",
      pkceB.verifier,
    );
    expect(tokB.status).toBe(200);
    const bodyB = (await tokB.json()) as {
      access_token: string;
      id_token: string;
    };
    expect(bodyA.access_token).not.toBe(bodyB.access_token);

    const uiA = (await (
      await app.request("/api/auth/oauth2/userinfo", {
        headers: { Authorization: `Bearer ${bodyA.access_token}` },
      })
    ).json()) as { sub: string; email: string };
    const uiB = (await (
      await app.request("/api/auth/oauth2/userinfo", {
        headers: { Authorization: `Bearer ${bodyB.access_token}` },
      })
    ).json()) as { sub: string; email: string };
    expect(uiA.email).toBe("multi-rp@example.com");
    expect(uiA.sub).toBe(uiB.sub);
    expect(uiA.sub).toBeTruthy();

    const payloadA = JSON.parse(
      Buffer.from(bodyA.id_token.split(".")[1]!, "base64url").toString(),
    ) as { aud?: string | string[]; sub?: string };
    const payloadB = JSON.parse(
      Buffer.from(bodyB.id_token.split(".")[1]!, "base64url").toString(),
    ) as { aud?: string | string[]; sub?: string };
    const audA = Array.isArray(payloadA.aud) ? payloadA.aud[0] : payloadA.aud;
    const audB = Array.isArray(payloadB.aud) ? payloadB.aud[0] : payloadB.aud;
    expect(audA).toBe(rpA.client_id);
    expect(audB).toBe(rpB.client_id);
    expect(payloadA.sub).toBe(payloadB.sub);

    const accessRows = await db.select().from(oauthAccessToken);
    const clients = new Set(accessRows.map((r) => r.clientId));
    expect(clients.has(rpA.client_id)).toBe(true);
    expect(clients.has(rpB.client_id)).toBe(true);

    // 跨 client 换码：必须失败（BA 会先 consume code，属单次使用安全语义）
    const pkceC = makePkce();
    const azC = await authorizeCode(
      app,
      cookie,
      rpA.client_id,
      "http://localhost:8787/a/callback",
      pkceC.challenge,
      "cross",
    );
    const codeC = new URL(azC.headers.get("location") || "").searchParams.get(
      "code",
    )!;
    const cross = await exchange(
      app,
      rpB.client_id,
      rpB.client_secret,
      codeC,
      "http://localhost:8787/a/callback",
      pkceC.verifier,
    );
    expect(cross.status).not.toBe(200);

    // B 的 client 不能用 A 的 redirect 出码
    const mix = await authorizeCode(
      app,
      cookie,
      rpB.client_id,
      "http://localhost:8787/a/callback",
      makePkce().challenge,
      "mix",
    );
    const mixLoc = mix.headers.get("location") || "";
    expect(
      mixLoc.includes("http://localhost:8787/a/callback") &&
        mixLoc.includes("code="),
    ).toBe(false);
  });

  it("Drizzle/Admin 路径禁用 A 后 A 不可 authorize；B 不受影响", async () => {
    const { app, auth, db } = await createTestApp({ enableOAuthProvider: true });
    const cookie = await signInCookie(app, "multi-disable@example.com");
    const rpA = await createRp(
      auth,
      cookie,
      "rp-dis-a",
      "http://localhost:8787/a/callback",
    );
    const rpB = await createRp(
      auth,
      cookie,
      "rp-dis-b",
      "http://localhost:8787/b/callback",
    );

    // 生产 Admin API 用 Drizzle 写 disabled（与 batch-disabled 同源）
    await db
      .update(oauthClient)
      .set({ disabled: true, updatedAt: new Date() })
      .where(eq(oauthClient.clientId, rpA.client_id));

    const [row] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, rpA.client_id))
      .limit(1);
    expect(row?.disabled).toBe(true);

    const bad = await authorizeCode(
      app,
      cookie,
      rpA.client_id,
      "http://localhost:8787/a/callback",
      makePkce().challenge,
      "x",
    );
    const badLoc = bad.headers.get("location") || "";
    expect(badLoc.includes("code=")).toBe(false);
    expect(badLoc.includes("client_disabled") || bad.status === 400).toBe(true);

    const okB = await authorizeCode(
      app,
      cookie,
      rpB.client_id,
      "http://localhost:8787/b/callback",
      makePkce().challenge,
      "y",
    );
    expect(okB.status).toBe(302);
    expect(okB.headers.get("location") || "").toContain("code=");
  });
});
