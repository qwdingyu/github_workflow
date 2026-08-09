/**
 * M7a 平台 Admin API 单测：白名单鉴权、clients CRUD、secret 脱敏、审计。
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  cleanupTestDbs,
  cookieHeaderFrom,
  createTestApp,
  jsonPost,
  mergeCookies,
} from "./test-helpers";
import {
  adminAuditLog,
  emailLog,
  oauthAccessToken,
  oauthClient,
  oauthRefreshToken,
} from "./db/schema";
import { hashClientSecret } from "./lib/client-secret";
import {
  countAccessForUser,
  countActiveRefreshForUser,
} from "./lib/session-revoke";

afterEach(async () => {
  await cleanupTestDbs();
});

function adminHeaders(apiKey = "test-admin-api-key-for-cf-auth-m7") {
  return {
    "Content-Type": "application/json",
    "X-Admin-Api-Key": apiKey,
    Origin: "http://localhost:8788",
  };
}

async function signUpLoginUserId(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  input: { name: string; email: string; password: string },
): Promise<string> {
  const signUp = await app.request("/api/auth/sign-up/email", jsonPost(input));
  expect(signUp.status).toBe(200);
  const login = await app.request(
    "/api/auth/sign-in/email",
    jsonPost({ email: input.email, password: input.password }),
  );
  expect(login.status).toBe(200);
  const sessionRes = await app.request("/api/auth/get-session", {
    headers: {
      Cookie: cookieHeaderFrom(login.headers.get("set-cookie")),
    },
  });
  const sess = (await sessionRes.json()) as { user?: { id: string } };
  expect(sess.user?.id).toBeTruthy();
  return sess.user!.id;
}

describe("Admin API M7a", () => {
  it("未配置管理员且无 key → 测试 env 已配置；错误 key → 401", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/api/admin/health", {
      headers: { "X-Admin-Api-Key": "wrong-key" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("API Key 可访问 health 与 clients 列表", async () => {
    const { app } = await createTestApp();
    const health = await app.request("/api/admin/health", {
      headers: adminHeaders(),
    });
    expect(health.status).toBe(200);
    const h = (await health.json()) as {
      ok: boolean;
      counts: {
        users: number;
        clients: number;
        sessions: number;
        disabledClients?: number;
        blocklist?: number;
        sessionsCreated24h?: number;
      };
    };
    expect(h.ok).toBe(true);
    expect(typeof h.counts.users).toBe("number");
    expect(typeof h.counts.disabledClients).toBe("number");
    expect(typeof h.counts.blocklist).toBe("number");
    expect(typeof h.counts.sessionsCreated24h).toBe("number");

    const list = await app.request("/api/admin/clients", {
      headers: adminHeaders(),
    });
    expect(list.status).toBe(200);
    const l = (await list.json()) as { ok: boolean; clients: unknown[] };
    expect(l.ok).toBe(true);
    expect(Array.isArray(l.clients)).toBe(true);
  });

  it("邮件日志支持列表筛选与批量删除", async () => {
    const { app, db } = await createTestApp();
    const now = new Date();
    await db.insert(emailLog).values([
      {
        id: "email-log-sent",
        clientId: "cf-shop",
        toAddr: "buyer@example.com",
        subject: "cf-auth 验证码",
        status: "sent",
        provider: "resend",
        error: null,
        createdAt: now,
      },
      {
        id: "email-log-failed",
        clientId: "cf-lottery",
        toAddr: "other@example.com",
        subject: "登录验证码",
        status: "failed",
        provider: "smtp",
        error: "smtp rejected",
        createdAt: new Date(now.getTime() - 1000),
      },
    ]);

    const list = await app.request(
      "/api/admin/email-logs?status=sent&search=buyer&limit=10",
      { headers: adminHeaders() },
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      ok: boolean;
      total: number;
      results: Array<{ id: string; clientId: string; toAddr: string; status: string }>;
      snapshotAt: string;
      hasMore: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.total).toBe(1);
    expect(body.results).toEqual([
      expect.objectContaining({
        id: "email-log-sent",
        clientId: "cf-shop",
        toAddr: "buyer@example.com",
        status: "sent",
      }),
    ]);
    expect(body.snapshotAt).toBeTruthy();
    expect(body.hasMore).toBe(false);

    const deleted = await app.request("/api/admin/email-logs/batch-delete", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ ids: ["email-log-sent"] }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ ok: true, deleted: 1 });

    const remaining = await db.select({ id: emailLog.id }).from(emailLog);
    expect(remaining.map((row) => row.id)).toEqual(["email-log-failed"]);
    const audits = await db
      .select({ action: adminAuditLog.action, targetType: adminAuditLog.targetType })
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "email_log.batch_delete"));
    expect(audits).toEqual([
      { action: "email_log.batch_delete", targetType: "email_log" },
    ]);
  });

  it("Admin 写请求 CSRF：跨站/业务 RP 域 403；同源/显式 ADMIN_TRUSTED_ORIGINS/无 Origin 放行", async () => {
    const { app } = await createTestApp({
      admin: {
        ADMIN_API_KEY: "test-admin-api-key-for-cf-auth-m7",
        ADMIN_TRUSTED_ORIGINS: "https://admin.internal.example",
      },
    });
    const apiKey = "test-admin-api-key-for-cf-auth-m7";
    const body = JSON.stringify({
      name: "csrf-check",
      redirect_uris: ["https://csrf.example/cb"],
    });

    // 跨站 Origin（不在管理信任域）→ 403（即使 API Key 正确）
    const evil = await app.request("/api/admin/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Api-Key": apiKey,
        Origin: "https://evil.example.com",
      },
      body,
    });
    expect(evil.status).toBe(403);

    // 业务 TRUSTED_ORIGINS 内的 RP 域（测试 env：http://localhost:8787）
    // 不再自动信任管理写请求（信任域解耦）→ 403
    const rpOrigin = await app.request("/api/admin/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Api-Key": apiKey,
        Origin: "http://localhost:8787",
      },
      body,
    });
    expect(rpOrigin.status).toBe(403);

    // 显式 ADMIN_TRUSTED_ORIGINS → 放行
    const trusted = await app.request("/api/admin/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Api-Key": apiKey,
        Origin: "https://admin.internal.example",
      },
      body,
    });
    expect(trusted.status).toBe(200);

    // 同源（baseURL）→ 放行
    const sameOrigin = await app.request("/api/admin/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Api-Key": apiKey,
        Origin: "http://localhost:8788",
      },
      body,
    });
    expect(sameOrigin.status).toBe(200);

    // 无 Origin（curl / CI 脚本）→ 放行
    const noOrigin = await app.request("/api/admin/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Api-Key": apiKey,
      },
      body,
    });
    expect(noOrigin.status).toBe(200);
  });

  it("创建 client 返回一次 secret；GET 列表不含 secret；写审计", async () => {
    const { app } = await createTestApp();
    const create = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "rp-admin-test",
        redirect_uris: ["http://localhost:8787/auth/callback"],
        skip_consent: true,
      }),
    });
    expect(create.status).toBe(200);
    const created = (await create.json()) as {
      ok: boolean;
      client: { clientId: string; name: string; hasSecret: boolean };
      clientSecret: string;
      envSnippet?: string;
      issuer?: string;
    };
    expect(created.ok).toBe(true);
    expect(created.clientSecret).toBeTruthy();
    expect(created.clientSecret.length).toBe(32);
    expect(created.client.hasSecret).toBe(true);
    // 可粘贴 env：issuer 来自运行时 baseURL，secret 仅此响应
    expect(created.issuer).toBe("http://localhost:8788");
    expect(created.envSnippet).toBeTruthy();
    expect(created.envSnippet).toContain("CF_AUTH_ISSUER=http://localhost:8788");
    expect(created.envSnippet).toContain(
      `CF_AUTH_CLIENT_ID=${created.client.clientId}`,
    );
    expect(created.envSnippet).toContain(
      `CF_AUTH_CLIENT_SECRET=${created.clientSecret}`,
    );
    expect(created.envSnippet).toContain(
      "CF_AUTH_REDIRECT_URI=http://localhost:8787/auth/callback",
    );

    const list = await app.request("/api/admin/clients", {
      headers: adminHeaders(),
    });
    const l = (await list.json()) as {
      clients: Array<Record<string, unknown>>;
    };
    const found = l.clients.find((c) => c.clientId === created.client.clientId);
    expect(found).toBeTruthy();
    expect(found).not.toHaveProperty("clientSecret");
    expect(found).not.toHaveProperty("client_secret");
    expect(found).not.toHaveProperty("envSnippet");

    const audit = await app.request("/api/admin/audit", {
      headers: adminHeaders(),
    });
    const a = (await audit.json()) as {
      logs: Array<{ action: string; targetId: string | null }>;
    };
    expect(a.logs.some((x) => x.action === "client.create")).toBe(true);
  });

  it("health 暴露只读 issuer 与 firstPartyRedirectHosts", async () => {
    const { app } = await createTestApp();
    const health = await app.request("/api/admin/health", {
      headers: adminHeaders(),
    });
    expect(health.status).toBe(200);
    const h = (await health.json()) as {
      ok: boolean;
      issuer?: string;
      firstPartyRedirectHosts?: string[];
      socialCounts?: { total: number; enabled: number; effective: number };
    };
    expect(h.ok).toBe(true);
    expect(h.issuer).toBe("http://localhost:8788");
    expect(Array.isArray(h.firstPartyRedirectHosts)).toBe(true);
    expect(h.firstPartyRedirectHosts!.length).toBeGreaterThan(0);
    expect(h.firstPartyRedirectHosts).toContain("localhost");
    // 社交运营计数（Dashboard）：注册表全量、无行默认启用、无密钥则 effective=0
    expect(h.socialCounts?.total).toBeGreaterThan(0);
    expect(h.socialCounts?.enabled).toBe(h.socialCounts?.total);
    expect(typeof h.socialCounts?.effective).toBe("number");
  });

  it("GET /sessions 支持邮箱与 userId；未知邮箱空列表", async () => {
    const { app } = await createTestApp();
    const email = "session-lookup@example.com";
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        name: "Lookup",
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
    cookie = mergeCookies(cookie, cookieHeaderFrom(login.headers.get("set-cookie")));
    const sessionRes = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });
    const sess = (await sessionRes.json()) as { user?: { id: string } };
    const userId = sess.user!.id;

    const byEmail = await app.request(
      `/api/admin/sessions?q=${encodeURIComponent(email)}`,
      { headers: adminHeaders() },
    );
    expect(byEmail.status).toBe(200);
    const emailBody = (await byEmail.json()) as {
      ok: boolean;
      sessions: unknown[];
      userId: string | null;
      email: string | null;
      queryKind: string;
    };
    expect(emailBody.ok).toBe(true);
    expect(emailBody.queryKind).toBe("email");
    expect(emailBody.userId).toBe(userId);
    expect(emailBody.sessions.length).toBeGreaterThan(0);

    const byId = await app.request(
      `/api/admin/sessions?q=${encodeURIComponent(userId)}`,
      { headers: adminHeaders() },
    );
    expect(byId.status).toBe(200);
    const idBody = (await byId.json()) as {
      sessions: unknown[];
      userId: string;
      queryKind: string;
    };
    expect(idBody.queryKind).toBe("userId");
    expect(idBody.userId).toBe(userId);
    expect(idBody.sessions.length).toBe(emailBody.sessions.length);

    const missing = await app.request(
      "/api/admin/sessions?q=nobody-exists-xyz@example.com",
      { headers: adminHeaders() },
    );
    expect(missing.status).toBe(200);
    const miss = (await missing.json()) as {
      sessions: unknown[];
      userId: null;
      message?: string;
    };
    expect(miss.sessions).toEqual([]);
    expect(miss.userId).toBeNull();
    expect(miss.message).toMatch(/未找到/);

    const empty = await app.request("/api/admin/sessions", {
      headers: adminHeaders(),
    });
    expect(empty.status).toBe(400);
  });

  it("rotate-secret 写入的哈希与 BA 算法一致，可校验", async () => {
    const { app, db } = await createTestApp();
    const create = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "rp-rotate",
        redirect_uris: ["http://localhost:8787/cb"],
      }),
    });
    const created = (await create.json()) as {
      client: { clientId: string };
      clientSecret: string;
    };

    const rotate = await app.request(
      `/api/admin/clients/${created.client.clientId}/rotate-secret`,
      { method: "POST", headers: adminHeaders() },
    );
    expect(rotate.status).toBe(200);
    const rotated = (await rotate.json()) as { clientSecret: string };
    expect(rotated.clientSecret).toBeTruthy();
    expect(rotated.clientSecret).not.toBe(created.clientSecret);

    const [row] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, created.client.clientId));
    const expected = await hashClientSecret(rotated.clientSecret);
    expect(row?.clientSecret).toBe(expected);
  });

  it("禁用 client + 用户会话列表/吊销", async () => {
    const { app } = await createTestApp();
    // 注册普通用户
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        name: "U",
        email: "user-sessions@example.com",
        password: "strong-password-123",
      }),
    );
    expect(signUp.status).toBe(200);
    let cookie = cookieHeaderFrom(signUp.headers.get("set-cookie"));
    const login = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({
        email: "user-sessions@example.com",
        password: "strong-password-123",
      }),
    );
    cookie = mergeCookies(cookie, cookieHeaderFrom(login.headers.get("set-cookie")));
    const sessionRes = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });
    const sess = (await sessionRes.json()) as { user?: { id: string } };
    expect(sess.user?.id).toBeTruthy();
    const userId = sess.user!.id;

    const create = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "to-disable",
        redirect_uris: ["http://localhost:8787/cb"],
      }),
    });
    const created = (await create.json()) as { client: { clientId: string } };

    const patch = await app.request(
      `/api/admin/clients/${created.client.clientId}`,
      {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({ disabled: true }),
      },
    );
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as {
      client: { disabled: boolean };
    };
    expect(patched.client.disabled).toBe(true);

    const sessions = await app.request(`/api/admin/users/${userId}/sessions`, {
      headers: adminHeaders(),
    });
    expect(sessions.status).toBe(200);
    const sBody = (await sessions.json()) as { sessions: unknown[] };
    expect(sBody.sessions.length).toBeGreaterThan(0);
    // token 字段不得出现
    for (const s of sBody.sessions as Array<Record<string, unknown>>) {
      expect(s).not.toHaveProperty("token");
    }

    const rev = await app.request(`/api/admin/users/${userId}/sessions`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(rev.status).toBe(200);
    const revBody = (await rev.json()) as {
      ok: boolean;
      sessionsDeleted?: number;
      refreshRevoked?: number;
      accessDeleted?: number;
    };
    expect(revBody.ok).toBe(true);
    expect(typeof revBody.sessionsDeleted).toBe("number");
    expect(revBody.sessionsDeleted).toBeGreaterThan(0);

    const sessions2 = await app.request(`/api/admin/users/${userId}/sessions`, {
      headers: adminHeaders(),
    });
    const s2 = (await sessions2.json()) as { sessions: unknown[] };
    expect(s2.sessions.length).toBe(0);
  });

  it("完整下线会撤销 refresh 并删除 access（docs/020 R1）", async () => {
    const { app, db } = await createTestApp();
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        name: "Tok",
        email: "token-user@example.com",
        password: "strong-password-123",
      }),
    );
    expect(signUp.status).toBe(200);
    let cookie = cookieHeaderFrom(signUp.headers.get("set-cookie"));
    const login = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({
        email: "token-user@example.com",
        password: "strong-password-123",
      }),
    );
    cookie = mergeCookies(cookie, cookieHeaderFrom(login.headers.get("set-cookie")));
    const sessionRes = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });
    const sess = (await sessionRes.json()) as {
      user?: { id: string };
      session?: { id: string };
    };
    const userId = sess.user!.id;
    const sessionId = sess.session!.id;

    const now = new Date();
    await db.insert(oauthRefreshToken).values({
      id: crypto.randomUUID(),
      token: `rt-${crypto.randomUUID()}`,
      clientId: "test-client",
      sessionId,
      userId,
      scopes: JSON.stringify(["openid"]),
      createdAt: now,
      expiresAt: new Date(Date.now() + 86400_000),
      revoked: null,
    });
    await db.insert(oauthAccessToken).values({
      id: crypto.randomUUID(),
      token: `at-${crypto.randomUUID()}`,
      clientId: "test-client",
      sessionId,
      userId,
      scopes: JSON.stringify(["openid"]),
      createdAt: now,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    expect(await countActiveRefreshForUser(db, userId)).toBe(1);
    expect(await countAccessForUser(db, userId)).toBe(1);

    const rev = await app.request(`/api/admin/users/${userId}/sessions`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(rev.status).toBe(200);
    const body = (await rev.json()) as {
      sessionsDeleted: number;
      refreshRevoked: number;
      accessDeleted: number;
    };
    expect(body.refreshRevoked).toBeGreaterThanOrEqual(1);
    expect(body.accessDeleted).toBeGreaterThanOrEqual(1);
    expect(await countActiveRefreshForUser(db, userId)).toBe(0);
    expect(await countAccessForUser(db, userId)).toBe(0);
  });

  it("blocklist：封禁后无法再登录建 session；可解封", async () => {
    const { app } = await createTestApp();
    const email = "blocked-user@example.com";
    const password = "strong-password-123";
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({ name: "B", email, password }),
    );
    expect(signUp.status).toBe(200);
    let cookie = cookieHeaderFrom(signUp.headers.get("set-cookie"));
    const login1 = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({ email, password }),
    );
    expect(login1.status).toBe(200);
    cookie = mergeCookies(cookie, cookieHeaderFrom(login1.headers.get("set-cookie")));
    const sess1 = (await (
      await app.request("/api/auth/get-session", { headers: { Cookie: cookie } })
    ).json()) as { user?: { id: string } };
    const userId = sess1.user!.id;

    const block = await app.request(`/api/admin/users/${userId}/block`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ reason: "abuse", alsoEmail: true }),
    });
    expect(block.status).toBe(200);
    const b = (await block.json()) as { ok: boolean; blocked: boolean };
    expect(b.blocked).toBe(true);

    // 已有 cookie 会话被级联删除
    const sessionsAfter = await app.request(`/api/admin/users/${userId}/sessions`, {
      headers: adminHeaders(),
    });
    const sa = (await sessionsAfter.json()) as { sessions: unknown[] };
    expect(sa.sessions.length).toBe(0);

    // 再次登录应失败（session.create before hook）
    const login2 = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({ email, password }),
    );
    expect(login2.status).not.toBe(200);

    const list = await app.request("/api/admin/blocklist", {
      headers: adminHeaders(),
    });
    const lb = (await list.json()) as {
      items: Array<{ id: string; type: string; value: string }>;
    };
    expect(lb.items.some((x) => x.type === "user_id" && x.value === userId)).toBe(
      true,
    );
    expect(
      lb.items.some((x) => x.type === "email" && x.value === email.toLowerCase()),
    ).toBe(true);

    for (const item of lb.items.filter(
      (x) => x.value === userId || x.value === email.toLowerCase(),
    )) {
      const del = await app.request(`/api/admin/blocklist/${item.id}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });
      expect(del.status).toBe(200);
    }

    const login3 = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({ email, password }),
    );
    expect(login3.status).toBe(200);

    // enable 端点替代 batch-remove：解禁后验证 GET /users 返回 blocked=false
    const usersAfter = await app.request("/api/admin/users", {
      headers: adminHeaders(),
    });
    const ul = (await usersAfter.json()) as {
      users: Array<{ id: string; email: string; blocked: boolean }>;
    };
    const found = ul.users.find(
      (u) => u.email === email.toLowerCase(),
    );
    expect(found?.blocked).toBe(false);
  });

  it("email_domain 精确匹配且拒绝通配符；batch-block 上限 20", async () => {
    const { app, db } = await createTestApp();
    const userId = await signUpLoginUserId(app, {
      name: "Dom",
      email: "someone@exact-domain.test",
      password: "strong-password-123",
    });

    const bad = await app.request("/api/admin/blocklist", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ type: "email_domain", value: "%.test" }),
    });
    expect(bad.status).toBe(400);

    const add = await app.request("/api/admin/blocklist", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        type: "email_domain",
        value: "exact-domain.test",
        reason: "domain-ban",
      }),
    });
    expect(add.status).toBe(200);
    const added = (await add.json()) as { matchedUserIds: string[] };
    expect(added.matchedUserIds).toContain(userId);

    const login = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({
        email: "someone@exact-domain.test",
        password: "strong-password-123",
      }),
    );
    expect(login.status).not.toBe(200);

    // 清理，避免污染其它用例（独立 db 文件，可省略；保持干净）
    void db;

    const tooMany = await app.request("/api/admin/users/batch-block", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        userIds: Array.from({ length: 21 }, (_, i) => `u${i}`),
      }),
    });
    expect(tooMany.status).toBe(400);
  });

  it("clients batch-disabled 批量禁用/启用", async () => {
    const { app } = await createTestApp();
    const ids: string[] = [];
    for (const name of ["batch-a", "batch-b"]) {
      const create = await app.request("/api/admin/clients", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          name,
          redirect_uris: ["http://localhost:8787/cb"],
        }),
      });
      const created = (await create.json()) as { client: { clientId: string } };
      ids.push(created.client.clientId);
    }

    const batch = await app.request("/api/admin/clients/batch-disabled", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ clientIds: ids, disabled: true }),
    });
    expect(batch.status).toBe(200);
    const br = (await batch.json()) as { success: number; failed: number };
    expect(br.success).toBe(2);
    expect(br.failed).toBe(0);

    const list = await app.request("/api/admin/clients", {
      headers: adminHeaders(),
    });
    const l = (await list.json()) as {
      clients: Array<{ clientId: string; disabled: boolean }>;
    };
    for (const id of ids) {
      expect(l.clients.find((c) => c.clientId === id)?.disabled).toBe(true);
    }

    const tooMany = await app.request("/api/admin/clients/batch-disabled", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        clientIds: Array.from({ length: 21 }, (_, i) => `x${i}`),
        disabled: true,
      }),
    });
    expect(tooMany.status).toBe(400);
  });

  it("白名单 session 用户可进 Admin（ADMIN_EMAILS）", async () => {
    const { app } = await createTestApp();
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        name: "Admin",
        email: "admin@example.com",
        password: "strong-password-123",
      }),
    );
    expect(signUp.status).toBe(200);
    let cookie = cookieHeaderFrom(signUp.headers.get("set-cookie"));
    const login = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({
        email: "admin@example.com",
        password: "strong-password-123",
      }),
    );
    cookie = mergeCookies(cookie, cookieHeaderFrom(login.headers.get("set-cookie")));

    const health = await app.request("/api/admin/health", {
      headers: { Cookie: cookie, Origin: "http://localhost:8788" },
    });
    expect(health.status).toBe(200);
  });

  it("未配置 ADMIN_* → /api/admin/* 返回 503", async () => {
    const { app } = await createTestApp({ admin: null });
    const res = await app.request("/api/admin/health");
    expect(res.status).toBe(503);
    // fail() envelope：{ ok:false, message }（非 error 字段）
    const body = (await res.json()) as { ok: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(String(body.message || "")).toMatch(/ADMIN_|管理功能未启用|管理面未配置/i);
  });

  it("普通登录用户调 create-client → 403；管理员 API Key 可走 Admin 建 client", async () => {
    const { app } = await createTestApp();
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        name: "Normal",
        email: "normal-user@example.com",
        password: "strong-password-123",
      }),
    );
    expect(signUp.status).toBe(200);
    let cookie = cookieHeaderFrom(signUp.headers.get("set-cookie"));
    const login = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({
        email: "normal-user@example.com",
        password: "strong-password-123",
      }),
    );
    cookie = mergeCookies(cookie, cookieHeaderFrom(login.headers.get("set-cookie")));

    const openCreate = await app.request("/api/auth/oauth2/create-client", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8788",
        Cookie: cookie,
      },
      body: JSON.stringify({
        name: "should-fail",
        redirect_uris: ["http://localhost:8787/cb"],
      }),
    });
    expect(openCreate.status).toBe(403);
    const denied = (await openCreate.json()) as {
      error?: string;
      error_description?: string;
    };
    expect(denied.error).toBe("access_denied");

    // 正式路径：Admin API + API Key
    const adminCreate = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "via-admin-api",
        redirect_uris: ["http://localhost:8787/cb"],
      }),
    });
    expect(adminCreate.status).toBe(200);
  });

  it("未配置 ADMIN_* 时 create-client → 503", async () => {
    const { app } = await createTestApp({ admin: null });
    const res = await app.request("/api/auth/oauth2/create-client", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8788",
      },
      body: JSON.stringify({
        name: "no-admin",
        redirect_uris: ["http://localhost:8787/cb"],
      }),
    });
    expect(res.status).toBe(503);
  });

  it("clients 搜索对 % 字面量转义，不把通配符当任意匹配", async () => {
    const { app } = await createTestApp();
    await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "plain-client",
        redirect_uris: ["http://localhost:8787/cb"],
      }),
    });
    await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "has%percent",
        redirect_uris: ["http://localhost:8787/cb"],
      }),
    });

    // 若未 ESCAPE，q=% 会匹配全部；正确行为只命中字面含 % 的 name
    const list = await app.request("/api/admin/clients?q=%25", {
      headers: adminHeaders(),
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      clients: Array<{ name: string }>;
    };
    expect(body.clients.every((c) => c.name.includes("%"))).toBe(true);
    expect(body.clients.some((c) => c.name === "has%percent")).toBe(true);
    expect(body.clients.some((c) => c.name === "plain-client")).toBe(false);
  });

  it("redirect 仅允许 https 或 localhost http；skip_consent 仅第一方", async () => {
    const { app } = await createTestApp();

    const httpReject = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "bad-http",
        redirect_uris: ["http://evil.example/cb"],
      }),
    });
    expect(httpReject.status).toBe(400);

    const skipThird = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "skip-third",
        redirect_uris: ["https://third-party.example/cb"],
        skip_consent: true,
      }),
    });
    expect(skipThird.status).toBe(400);

    const okLocal = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "ok-local-skip",
        redirect_uris: ["http://localhost:8787/cb"],
        skip_consent: true,
      }),
    });
    expect(okLocal.status).toBe(200);

    const okHttps = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "ok-https-no-skip",
        redirect_uris: ["https://third-party.example/cb"],
        skip_consent: false,
      }),
    });
    expect(okHttps.status).toBe(200);
  });

  it("sessions/batch-revoke 上限 20 且可串行下线", async () => {
    const { app } = await createTestApp();
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        name: "BatchRev",
        email: "batch-revoke@example.com",
        password: "strong-password-123",
      }),
    );
    expect(signUp.status).toBe(200);
    let cookie = cookieHeaderFrom(signUp.headers.get("set-cookie"));
    const login = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({
        email: "batch-revoke@example.com",
        password: "strong-password-123",
      }),
    );
    cookie = mergeCookies(cookie, cookieHeaderFrom(login.headers.get("set-cookie")));
    const sessionRes = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });
    const sess = (await sessionRes.json()) as {
      user?: { id: string };
      session?: { id: string };
    };
    const userId = sess.user!.id;

    // 注册 + 登录可能产生多条 session；批量应一次清光
    const listed = await app.request(`/api/admin/users/${userId}/sessions`, {
      headers: adminHeaders(),
    });
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(listedBody.sessions.length).toBeGreaterThan(0);
    const sessionIds = listedBody.sessions.map((s) => s.id);

    const tooMany = await app.request("/api/admin/sessions/batch-revoke", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        sessionIds: Array.from({ length: 21 }, (_, i) => `s${i}`),
      }),
    });
    expect(tooMany.status).toBe(400);

    const batch = await app.request("/api/admin/sessions/batch-revoke", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ sessionIds }),
    });
    expect(batch.status).toBe(200);
    const br = (await batch.json()) as { success: number; failed: number };
    expect(br.success).toBe(sessionIds.length);
    expect(br.failed).toBe(0);

    const sessions = await app.request(`/api/admin/users/${userId}/sessions`, {
      headers: adminHeaders(),
    });
    const sBody = (await sessions.json()) as { sessions: unknown[] };
    expect(sBody.sessions.length).toBe(0);
  });

  it("clients 硬删除须 confirm=DELETE；可清 token 后删行", async () => {
    const { app, db } = await createTestApp();
    const create = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "to-hard-delete",
        redirect_uris: ["http://localhost:8787/cb"],
      }),
    });
    expect(create.status).toBe(200);
    const created = (await create.json()) as { client: { clientId: string } };
    const clientId = created.client.clientId;

    const noConfirm = await app.request(
      `/api/admin/clients/${clientId}/delete`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({}),
      },
    );
    expect(noConfirm.status).toBe(400);

    // refresh.userId 有 FK → 先建真实用户再插 token
    const tokenUserId = await signUpLoginUserId(app, {
      name: "TokOwner",
      email: "client-hard-del-token@example.com",
      password: "strong-password-123",
    });

    await db.insert(oauthRefreshToken).values({
      id: crypto.randomUUID(),
      token: `rt-del-${crypto.randomUUID()}`,
      clientId,
      sessionId: null,
      userId: tokenUserId,
      scopes: JSON.stringify(["openid"]),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      revoked: null,
    });

    const del = await app.request(`/api/admin/clients/${clientId}/delete`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    expect(del.status).toBe(200);
    const body = (await del.json()) as {
      deleted: boolean;
      refreshDeleted: number;
    };
    expect(body.deleted).toBe(true);
    expect(body.refreshDeleted).toBeGreaterThanOrEqual(1);

    const list = await app.request("/api/admin/clients", {
      headers: adminHeaders(),
    });
    const l = (await list.json()) as {
      clients: Array<{ clientId: string }>;
    };
    expect(l.clients.some((c) => c.clientId === clientId)).toBe(false);

    const tooMany = await app.request("/api/admin/clients/batch-delete", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        confirm: "DELETE",
        clientIds: Array.from({ length: 11 }, (_, i) => `c${i}`),
      }),
    });
    expect(tooMany.status).toBe(400);
  });

  it("users 硬删除：confirm、禁删白名单管理员、可删普通用户", async () => {
    const { app } = await createTestApp();
    const email = "junk-user-delete@example.com";
    const password = "strong-password-123";
    const userId = await signUpLoginUserId(app, { name: "Junk", email, password });

    const noConfirm = await app.request(`/api/admin/users/${userId}/delete`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({}),
    });
    expect(noConfirm.status).toBe(400);

    // 白名单 admin@example.com（createTestApp 默认 ADMIN_EMAILS）
    const adminId = await signUpLoginUserId(app, {
      name: "Admin",
      email: "admin@example.com",
      password: "strong-password-123",
    });

    const banAdmin = await app.request(`/api/admin/users/${adminId}/delete`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    expect(banAdmin.status).toBe(403);

    const del = await app.request(`/api/admin/users/${userId}/delete`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    expect(del.status).toBe(200);
    const d = (await del.json()) as { deleted: boolean };
    expect(d.deleted).toBe(true);

    const list = await app.request("/api/admin/users?q=junk-user-delete", {
      headers: adminHeaders(),
    });
    const lb = (await list.json()) as { users: Array<{ id: string }> };
    expect(lb.users.some((u) => u.id === userId)).toBe(false);

    const tooMany = await app.request("/api/admin/users/batch-delete", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        confirm: "DELETE",
        userIds: Array.from({ length: 11 }, (_, i) => `u${i}`),
      }),
    });
    expect(tooMany.status).toBe(400);
  });

  it("users batch-revoke-access 仅下线不封禁；上限 20", async () => {
    const { app } = await createTestApp();
    const email = "batch-revoke-access@example.com";
    const password = "strong-password-123";
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({ name: "BRA", email, password }),
    );
    expect(signUp.status).toBe(200);
    let cookie = cookieHeaderFrom(signUp.headers.get("set-cookie"));
    const login = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({ email, password }),
    );
    cookie = mergeCookies(cookie, cookieHeaderFrom(login.headers.get("set-cookie")));
    const sessionRes = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });
    const sess = (await sessionRes.json()) as { user?: { id: string } };
    const userId = sess.user!.id;

    const tooMany = await app.request("/api/admin/users/batch-revoke-access", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        userIds: Array.from({ length: 21 }, (_, i) => `u${i}`),
      }),
    });
    expect(tooMany.status).toBe(400);

    const batch = await app.request("/api/admin/users/batch-revoke-access", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ userIds: [userId] }),
    });
    expect(batch.status).toBe(200);
    const br = (await batch.json()) as {
      success: number;
      failed: number;
      sessionsDeleted: number;
    };
    expect(br.success).toBe(1);
    expect(br.failed).toBe(0);
    expect(br.sessionsDeleted).toBeGreaterThan(0);

    const sessions = await app.request(`/api/admin/users/${userId}/sessions`, {
      headers: adminHeaders(),
    });
    const sBody = (await sessions.json()) as { sessions: unknown[] };
    expect(sBody.sessions.length).toBe(0);

    // 未写黑名单：可再次登录
    const login2 = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({ email, password }),
    );
    expect(login2.status).toBe(200);
  });

  it("blocklist batch-remove 上限 20 且可串行移除", async () => {
    const { app } = await createTestApp();
    const ids: string[] = [];
    for (const value of ["a@batch-bl.test", "b@batch-bl.test"]) {
      const add = await app.request("/api/admin/blocklist", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ type: "email", value, reason: "batch-test" }),
      });
      expect(add.status).toBe(200);
      const body = (await add.json()) as { entry: { id: string } };
      ids.push(body.entry.id);
    }

    const tooMany = await app.request("/api/admin/blocklist/batch-remove", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        ids: Array.from({ length: 21 }, (_, i) => `bl${i}`),
      }),
    });
    expect(tooMany.status).toBe(400);

    const batch = await app.request("/api/admin/blocklist/batch-remove", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ ids }),
    });
    expect(batch.status).toBe(200);
    const br = (await batch.json()) as { success: number; failed: number };
    expect(br.success).toBe(2);
    expect(br.failed).toBe(0);

    const list = await app.request("/api/admin/blocklist?limit=50", {
      headers: adminHeaders(),
    });
    const lb = (await list.json()) as {
      items: Array<{ id: string; value: string }>;
    };
    expect(lb.items.some((x) => ids.includes(x.id))).toBe(false);
  });

  it("audit 支持 targetType / targetId 筛选", async () => {
    const { app } = await createTestApp();
    const create = await app.request("/api/admin/clients", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "audit-filter-client",
        redirect_uris: ["http://localhost:8787/cb"],
      }),
    });
    expect(create.status).toBe(200);
    const created = (await create.json()) as { client: { clientId: string } };
    const clientId = created.client.clientId;

    const byType = await app.request(
      "/api/admin/audit?targetType=oauth_client&limit=50",
      { headers: adminHeaders() },
    );
    expect(byType.status).toBe(200);
    const tBody = (await byType.json()) as {
      logs: Array<{ targetType: string | null; targetId: string | null }>;
    };
    expect(tBody.logs.every((l) => l.targetType === "oauth_client")).toBe(true);

    const byId = await app.request(
      `/api/admin/audit?targetId=${encodeURIComponent(clientId)}`,
      { headers: adminHeaders() },
    );
    expect(byId.status).toBe(200);
    const iBody = (await byId.json()) as {
      logs: Array<{ targetId: string | null }>;
      total: number;
    };
    expect(iBody.total).toBeGreaterThan(0);
    expect(iBody.logs.every((l) => l.targetId === clientId)).toBe(true);
  });
});

describe("Rate limit P0-2", () => {
  it("sign-up 超限返回 429", async () => {
    const { app } = await createTestApp();
    // 默认 limit 10 / 分钟；打 12 次应出现 429
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await app.request(
        "/api/auth/sign-up/email",
        jsonPost({
          name: `U${i}`,
          email: `rl-${i}@example.com`,
          password: "strong-password-123",
        }),
      );
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
