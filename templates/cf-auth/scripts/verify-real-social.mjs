/**
 * 一次性证据脚本：用 .env 真实 Google/GitHub 凭证驱动 shipped createApp，
 * 断言 health/meta 启用双方，sign-in/social 授权 URL 含真实 client_id + callback。
 * 输出 JSON 到 SCRATCH/social-urls.json（密钥已脱敏）。
 *
 * 用法：SCRATCH=... node scripts/verify-real-social.mjs
 * 或：npm run verify:social
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { createDb } from "../src/db/client.ts";
import { applyAuthMigrations } from "../src/db/migrate.ts";
import { createAuth } from "../src/lib/auth.ts";
import { resolveAuthConfig } from "../src/lib/env.ts";
import { createApp } from "../src/app.ts";
import { callbackUrlFor } from "../src/lib/social-providers.ts";

const scratch =
  process.env.SCRATCH ||
  join(tmpdir(), "cf-auth-social-evidence");
mkdirSync(scratch, { recursive: true });

const googleId = process.env.GOOGLE_CLIENT_ID?.trim();
const githubId = process.env.GITHUB_CLIENT_ID?.trim();
const googleSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const githubSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
const baseURL = process.env.BETTER_AUTH_URL?.trim() || "http://localhost:8788";

if (!googleId || !githubId || !googleSecret || !githubSecret) {
  console.error("缺少 GOOGLE_/GITHUB_ CLIENT_ID/SECRET，请配置 .env");
  process.exit(1);
}

const env = {
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET || "local-dev-better-auth-secret-at-least-32-chars",
  BETTER_AUTH_URL: baseURL,
  TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
  ENABLED_SOCIAL_PROVIDERS: process.env.ENABLED_SOCIAL_PROVIDERS || "google,github",
  GOOGLE_CLIENT_ID: googleId,
  GOOGLE_CLIENT_SECRET: googleSecret,
  GITHUB_CLIENT_ID: githubId,
  GITHUB_CLIENT_SECRET: githubSecret,
  EMAIL_PASSWORD_ENABLED: "true",
};

const cfg = resolveAuthConfig(env);
const dbPath = join(tmpdir(), `cf-auth-evidence-${Date.now()}.db`);
const client = createClient({ url: `file:${dbPath}` });
await applyAuthMigrations(client);
const db = createDb(client);
const auth = createAuth({ config: cfg, db, enableOAuthProvider: false });
const { app } = await createApp({ resources: { client, db, auth }, env });

async function social(provider) {
  const res = await app.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseURL },
    body: JSON.stringify({
      provider,
      callbackURL: `${baseURL}/`,
      disableRedirect: true,
    }),
  });
  const body = await res.json();
  return { status: res.status, url: body.url };
}

const google = await social("google");
const github = await social("github");
const health = await (await app.request("/api/health")).json();
const meta = await (await app.request("/api/auth-meta/social")).json();

function redact(u) {
  if (!u) return u;
  return u.replaceAll(googleSecret, "[REDACTED]").replaceAll(githubSecret, "[REDACTED]");
}

const out = {
  enabledIds: cfg.social.enabledIds,
  healthSocial: health.socialProviders,
  metaProviders: (meta.providers || []).map((p) => p.id),
  google: {
    status: google.status,
    hasClientId: Boolean(google.url?.includes(googleId)),
    hasCallbackPath: Boolean(
      google.url?.includes(encodeURIComponent(callbackUrlFor(baseURL, "google"))),
    ),
    urlHost: google.url ? new URL(google.url).host : null,
    urlRedacted: redact(google.url),
  },
  github: {
    status: github.status,
    hasClientId: Boolean(github.url?.includes(githubId)),
    hasCallbackPath: Boolean(
      github.url?.includes(encodeURIComponent(callbackUrlFor(baseURL, "github"))),
    ),
    urlHost: github.url ? new URL(github.url).host : null,
    urlRedacted: redact(github.url),
  },
  secretsLeakedInResponses: [JSON.stringify(health), JSON.stringify(meta), google.url, github.url].some(
    (s) => s?.includes(googleSecret) || s?.includes(githubSecret),
  ),
};

const ok =
  out.enabledIds.includes("google") &&
  out.enabledIds.includes("github") &&
  out.google.status === 200 &&
  out.github.status === 200 &&
  out.google.hasClientId &&
  out.github.hasClientId &&
  out.google.hasCallbackPath &&
  out.github.hasCallbackPath &&
  !out.secretsLeakedInResponses;

writeFileSync(join(scratch, "social-urls.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, ok }, null, 2));

await client.close();
for (const s of ["", "-wal", "-shm", "-journal"]) {
  try {
    unlinkSync(dbPath + s);
  } catch {
    /* ignore */
  }
}

process.exit(ok ? 0 : 2);
