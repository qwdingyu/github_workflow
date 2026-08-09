import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../test-helpers";
import { hashClientSecret } from "../lib/client-secret";
import { oauthClient } from "../db/schema";
import { sendMail } from "../lib/email";

vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendMail: vi.fn(async () => ({ ok: true, provider: "resend" })),
  };
});

// 邮件网关 API（docs/093）：认证/授权/校验边界测试
// 发送路径用 mock（email.ts 的 sendMail 被替换，避免真实发信）
describe("POST /api/email/send", () => {
  let app: TestApp;

  beforeEach(async () => {
    const created = await createTestApp();
    app = created;
    vi.mocked(sendMail).mockClear();
  });

  it("无认证返回 401", async () => {
    const res = await app.app.request("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "a@b.com", subject: "s", html: "h" }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("认证失败");
  });

  it("错误的 client_secret 返回 401", async () => {
    const clientId = "test-client";
    const plain = "correct-secret";
    const hashed = await hashClientSecret(plain);
    // 用测试 DB 直接插入一个 client
    await app.db.insert(oauthClient).values({
      id: crypto.randomUUID(),
      clientId,
      clientSecret: hashed,
      emailEnabled: true,
      redirectUris: "[]",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const wrongCreds = Buffer.from(`${clientId}:wrong-secret`).toString("base64");
    const res = await app.app.request("/api/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${wrongCreds}`,
      },
      body: JSON.stringify({ to: "a@b.com", subject: "s", html: "h" }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("认证失败");
  });

  it("不存在的 client 返回同样的 401 认证失败", async () => {
    const creds = Buffer.from(`missing-client:wrong-secret`).toString("base64");
    const res = await app.app.request("/api/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${creds}`,
      },
      body: JSON.stringify({ to: "a@b.com", subject: "s", html: "h" }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("认证失败");
  });

  it("超长 client_id 被拒绝且不触发发送", async () => {
    const creds = Buffer.from(`${"x".repeat(257)}:secret`).toString("base64");
    const res = await app.app.request("/api/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${creds}`,
      },
      body: JSON.stringify({ to: "a@b.com", subject: "s", html: "h" }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("认证失败");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("email_enabled=false 返回 403", async () => {
    const clientId = "test-client-2";
    const plain = "correct-secret";
    const hashed = await hashClientSecret(plain);
    await app.db.insert(oauthClient).values({
      id: crypto.randomUUID(),
      clientId,
      clientSecret: hashed,
      emailEnabled: false,
      redirectUris: "[]",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const creds = Buffer.from(`${clientId}:${plain}`).toString("base64");
    const res = await app.app.request("/api/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${creds}`,
      },
      body: JSON.stringify({ to: "a@b.com", subject: "s", html: "h" }),
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("邮件发送未启用");
  });

  it("有效 client + 合法请求返回 200", async () => {
    const clientId = "test-client-3";
    const plain = "correct-secret";
    const hashed = await hashClientSecret(plain);
    await app.db.insert(oauthClient).values({
      id: crypto.randomUUID(),
      clientId,
      clientSecret: hashed,
      emailEnabled: true,
      redirectUris: "[]",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const creds = Buffer.from(`${clientId}:${plain}`).toString("base64");
    const res = await app.app.request("/api/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${creds}`,
      },
      body: JSON.stringify({ to: "buyer@example.com", subject: "订单通知", html: "<p>hi</p>" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; provider: string };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("resend");
    expect(vi.mocked(sendMail)).toHaveBeenCalledWith(
      app.db,
      "buyer@example.com",
      expect.objectContaining({
        subject: "订单通知",
        html: "<p>hi</p>",
        clientId,
      }),
    );
  });

  it("无效收件人返回 400", async () => {
    const clientId = "test-client-4";
    const plain = "correct-secret";
    const hashed = await hashClientSecret(plain);
    await app.db.insert(oauthClient).values({
      id: crypto.randomUUID(),
      clientId,
      clientSecret: hashed,
      emailEnabled: true,
      redirectUris: "[]",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const creds = Buffer.from(`${clientId}:${plain}`).toString("base64");
    const res = await app.app.request("/api/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${creds}`,
      },
      body: JSON.stringify({ to: "not-an-email", subject: "s", html: "h" }),
    });
    expect(res.status).toBe(400);
  });
});
