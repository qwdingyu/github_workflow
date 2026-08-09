/**
 * OAuth client 字段校验（docs/020 R4/R5）。
 * - redirect_uris：语法 + 生产 https（localhost 例外）
 * - skip_consent：仅当全部 redirect 主机属于第一方 allowlist
 */
import { getEnv } from "./platform";

const DEFAULT_FIRST_PARTY_HOSTS = [
  "localhost",
  "127.0.0.1",
  "lucky.eforge.xyz",
  "auth.eforge.xyz",
];

export function parseFirstPartyHosts(raw: string | undefined | null): Set<string> {
  const fromEnv = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const list = fromEnv.length > 0 ? fromEnv : DEFAULT_FIRST_PARTY_HOSTS;
  return new Set(list);
}

export type RedirectParseOk = { ok: true; uris: string[] };
export type RedirectParseErr = { ok: false; message: string };

/**
 * 解析并校验 redirect_uris。
 * 允许：https://* ；http://localhost | http://127.0.0.1（可带端口）
 */
export function parseRedirectUrisStrict(input: unknown): RedirectParseOk | RedirectParseErr {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, message: "redirect_uris 必填且须为非空数组" };
  }
  const uris = input.map(String).map((s) => s.trim()).filter(Boolean);
  if (uris.length === 0) {
    return { ok: false, message: "redirect_uris 不能为空" };
  }
  for (const u of uris) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      return { ok: false, message: `非法 URL: ${u}` };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, message: `redirect 不得含 userinfo: ${u}` };
    }
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (protocol === "https:") {
      continue;
    }
    if (
      protocol === "http:" &&
      (host === "localhost" || host === "127.0.0.1")
    ) {
      continue;
    }
    return {
      ok: false,
      message: `redirect 仅允许 https，或 http://localhost / 127.0.0.1（当前: ${u}）`,
    };
  }
  return { ok: true, uris };
}

/** skip_consent 时：每个 redirect 的 hostname 必须 ∈ 第一方 */
export function assertSkipConsentAllowed(
  redirectUris: string[],
  firstPartyHosts: Set<string>,
): { ok: true } | { ok: false; message: string } {
  for (const u of redirectUris) {
    let host: string;
    try {
      host = new URL(u).hostname.toLowerCase();
    } catch {
      return { ok: false, message: `redirect 非法: ${u}` };
    }
    if (!firstPartyHosts.has(host)) {
      return {
        ok: false,
        message: `skip_consent 仅限第一方域名（${[...firstPartyHosts].join(", ")}）；拒绝主机 ${host}`,
      };
    }
  }
  return { ok: true };
}

/** 供路由：从 request context 读 FIRST_PARTY_REDIRECT_HOSTS */
export function resolveFirstPartyHosts(c: Parameters<typeof getEnv>[0]): Set<string> {
  return parseFirstPartyHosts(getEnv(c, "FIRST_PARTY_REDIRECT_HOSTS"));
}
