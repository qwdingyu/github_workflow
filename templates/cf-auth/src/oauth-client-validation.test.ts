/**
 * OAuth client 字段校验单测（redirect / skip_consent）。
 */
import { describe, expect, it } from "vitest";
import {
  assertSkipConsentAllowed,
  parseFirstPartyHosts,
  parseRedirectUrisStrict,
} from "./lib/oauth-client-validation";

describe("oauth-client-validation", () => {
  it("parseRedirectUrisStrict 拒绝空/非法/非 https 公网 http", () => {
    expect(parseRedirectUrisStrict(undefined).ok).toBe(false);
    expect(parseRedirectUrisStrict([]).ok).toBe(false);
    expect(parseRedirectUrisStrict(["not-a-url"]).ok).toBe(false);
    expect(parseRedirectUrisStrict(["http://evil.com/cb"]).ok).toBe(false);
    expect(parseRedirectUrisStrict(["https://user:pass@evil.com/cb"]).ok).toBe(
      false,
    );

    const local = parseRedirectUrisStrict(["http://localhost:8787/cb"]);
    expect(local.ok).toBe(true);
    if (local.ok) expect(local.uris).toEqual(["http://localhost:8787/cb"]);

    const https = parseRedirectUrisStrict(["https://lucky.eforge.xyz/cb"]);
    expect(https.ok).toBe(true);
  });

  it("assertSkipConsentAllowed 仅第一方 hostname", () => {
    const hosts = parseFirstPartyHosts(
      "localhost,auth.eforge.xyz,lucky.eforge.xyz",
    );
    expect(
      assertSkipConsentAllowed(["http://localhost/cb"], hosts).ok,
    ).toBe(true);
    expect(
      assertSkipConsentAllowed(["https://lucky.eforge.xyz/cb"], hosts).ok,
    ).toBe(true);
    expect(
      assertSkipConsentAllowed(["https://third.example/cb"], hosts).ok,
    ).toBe(false);
  });

  it("parseFirstPartyHosts 空 env 回落默认", () => {
    const d = parseFirstPartyHosts("");
    expect(d.has("localhost")).toBe(true);
    expect(d.has("auth.eforge.xyz")).toBe(true);
  });
});
