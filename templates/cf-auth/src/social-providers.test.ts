import { describe, expect, it } from "vitest";
import {
  callbackUrlFor,
  parseSocialAllowlist,
  resolveSocialProviders,
  SOCIAL_PROVIDER_REGISTRY,
} from "./lib/social-providers";

describe("social-providers 注册表", () => {
  it("注册表含 google 与 github 且顺序稳定", () => {
    const ids = SOCIAL_PROVIDER_REGISTRY.map((p) => p.id);
    expect(ids).toContain("google");
    expect(ids).toContain("github");
    expect(ids.indexOf("google")).toBeLessThan(ids.indexOf("github"));
  });

  it("密钥不成对则不启用", () => {
    const r = resolveSocialProviders({
      GOOGLE_CLIENT_ID: "only-id",
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret",
    });
    expect(r.enabledIds).toEqual(["github"]);
    expect(r.socialProviders.google).toBeUndefined();
    expect(r.socialProviders.github?.clientId).toBe("gh-id");
  });

  it("allowlist 可裁剪启用集", () => {
    const r = resolveSocialProviders(
      {
        GOOGLE_CLIENT_ID: "g",
        GOOGLE_CLIENT_SECRET: "gs",
        GITHUB_CLIENT_ID: "h",
        GITHUB_CLIENT_SECRET: "hs",
      },
      { allowlist: parseSocialAllowlist("github") },
    );
    expect(r.enabledIds).toEqual(["github"]);
  });

  it("callback URL 遵循 Better Auth 约定", () => {
    expect(callbackUrlFor("https://auth.eforge.xyz", "github")).toBe(
      "https://auth.eforge.xyz/api/auth/callback/github",
    );
  });
});
