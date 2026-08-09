/**
 * Admin 会话查询解析 + env 片段纯函数单测。
 */
import { describe, expect, it } from "vitest";
import { parseSessionQuery, looksLikeEmail } from "./lib/admin-session-query";
import { buildOAuthClientEnvSnippet } from "./lib/oauth-client-env-snippet";

describe("parseSessionQuery", () => {
  it("空输入", () => {
    expect(parseSessionQuery("")).toEqual({ kind: "empty", raw: "" });
    expect(parseSessionQuery("   ")).toEqual({ kind: "empty", raw: "" });
    expect(parseSessionQuery(null)).toEqual({ kind: "empty", raw: "" });
  });

  it("邮箱规范化小写", () => {
    const p = parseSessionQuery("  Admin@Example.COM ");
    expect(p.kind).toBe("email");
    if (p.kind === "email") {
      expect(p.email).toBe("admin@example.com");
      expect(p.raw).toBe("Admin@Example.COM");
    }
  });

  it("无 @ 当 userId", () => {
    const p = parseSessionQuery("usr_abc-123");
    expect(p).toEqual({
      kind: "userId",
      raw: "usr_abc-123",
      userId: "usr_abc-123",
    });
  });

  it("looksLikeEmail 边界", () => {
    expect(looksLikeEmail("a@b.c")).toBe(true);
    expect(looksLikeEmail("@x")).toBe(false);
    expect(looksLikeEmail("x@")).toBe(false);
    expect(looksLikeEmail("no-at")).toBe(false);
  });
});

describe("buildOAuthClientEnvSnippet", () => {
  it("含 secret 与主 redirect；issuer 去尾斜杠", () => {
    const snip = buildOAuthClientEnvSnippet({
      issuer: "https://auth.eforge.xyz/",
      clientId: "cid_test",
      clientSecret: "sec_once_only",
      redirectUris: [
        "https://lucky.eforge.xyz/auth/callback",
        "http://localhost:5173/cb",
      ],
      name: "lucky-web",
    });
    expect(snip).toContain("# OAuth client: lucky-web");
    expect(snip).toContain("CF_AUTH_ISSUER=https://auth.eforge.xyz");
    expect(snip).toContain("CF_AUTH_CLIENT_ID=cid_test");
    expect(snip).toContain("CF_AUTH_CLIENT_SECRET=sec_once_only");
    expect(snip).toContain(
      "CF_AUTH_REDIRECT_URI=https://lucky.eforge.xyz/auth/callback",
    );
    expect(snip).toContain("CF_AUTH_ENABLED=true");
    expect(snip).toContain("# http://localhost:5173/cb");
    expect(snip).not.toMatch(/auth\.eforge\.xyz\/\n/);
  });

  it("无 secret 时注释占位且不含假 secret 值", () => {
    const snip = buildOAuthClientEnvSnippet({
      issuer: "http://localhost:8788",
      clientId: "cid2",
      clientSecret: null,
      redirectUris: ["http://localhost/cb"],
    });
    expect(snip).toContain("# CF_AUTH_CLIENT_SECRET=");
    expect(snip).not.toMatch(/^CF_AUTH_CLIENT_SECRET=\S/m);
  });
});
