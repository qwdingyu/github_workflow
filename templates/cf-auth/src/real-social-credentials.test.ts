/**
 * 真实 Google/GitHub 凭证路径（从 process.env / .env 加载）。
 *
 * 验收：enabled 含 google+github；sign-in/social 返回的授权 URL
 * 含真实 client_id 与正确 callback 路径。密钥不得出现在断言字符串常量中以外的仓库文件。
 *
 * 无完整成对密钥时 skip（CI 无 secret 仍可绿）。
 */
import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTestDbs,
  jsonPost,
} from "./test-helpers";
import { resolveAuthConfig } from "./lib/env";
import { callbackUrlFor } from "./lib/social-providers";
import type { Bindings } from "./bindings";

afterEach(async () => {
  await cleanupTestDbs();
});

function readRealSocialEnv(): {
  ok: boolean;
  googleId: string;
  googleSecret: string;
  githubId: string;
  githubSecret: string;
  baseURL: string;
} {
  const googleId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const githubId = process.env.GITHUB_CLIENT_ID?.trim() ?? "";
  const githubSecret = process.env.GITHUB_CLIENT_SECRET?.trim() ?? "";
  const baseURL = process.env.BETTER_AUTH_URL?.trim() || "http://localhost:8788";
  const ok = Boolean(googleId && googleSecret && githubId && githubSecret);
  return { ok, googleId, googleSecret, githubId, githubSecret, baseURL };
}

const real = readRealSocialEnv();

describe.runIf(real.ok)("真实 Google/GitHub 凭证（env 驱动）", () => {
  it("resolveAuthConfig 同时启用 google 与 github", () => {
    const env: Bindings = {
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "local-dev-better-auth-secret-at-least-32-chars",
      BETTER_AUTH_URL: real.baseURL,
      TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
      DATABASE_URL: process.env.DATABASE_URL || "file:./data/local.db",
      ENABLED_SOCIAL_PROVIDERS: process.env.ENABLED_SOCIAL_PROVIDERS || "google,github",
      GOOGLE_CLIENT_ID: real.googleId,
      GOOGLE_CLIENT_SECRET: real.googleSecret,
      GITHUB_CLIENT_ID: real.githubId,
      GITHUB_CLIENT_SECRET: real.githubSecret,
    };
    const cfg = resolveAuthConfig(env);
    expect(cfg.social.enabledIds).toEqual(expect.arrayContaining(["google", "github"]));
    expect(cfg.social.enabledIds).toHaveLength(2);
    expect(cfg.social.socialProviders.google?.clientId).toBe(real.googleId);
    expect(cfg.social.socialProviders.github?.clientId).toBe(real.githubId);
    // 密钥不得出现在 meta 结构的公开字段
    expect(JSON.stringify(cfg.social.enabledMeta)).not.toContain(real.googleSecret);
    expect(JSON.stringify(cfg.social.enabledMeta)).not.toContain(real.githubSecret);
  });

  it("createApp health/meta 报告 google+github 且不泄露 secret", async () => {
    const env: Bindings = {
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "local-dev-better-auth-secret-at-least-32-chars",
      BETTER_AUTH_URL: real.baseURL,
      TRUSTED_ORIGINS: `${real.baseURL},http://localhost:8787`,
      ENABLED_SOCIAL_PROVIDERS: "google,github",
      GOOGLE_CLIENT_ID: real.googleId,
      GOOGLE_CLIENT_SECRET: real.googleSecret,
      GITHUB_CLIENT_ID: real.githubId,
      GITHUB_CLIENT_SECRET: real.githubSecret,
      EMAIL_PASSWORD_ENABLED: "true",
    };
    // 用临时库 + 注入真实 social env（不走假 client id）
    const { app } = await createTestAppWithRealSocial(env);

    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    const hBody = (await health.json()) as {
      ok: boolean;
      socialProviders: string[];
    };
    expect(hBody.ok).toBe(true);
    expect(hBody.socialProviders).toEqual(expect.arrayContaining(["google", "github"]));
    const healthText = JSON.stringify(hBody);
    expect(healthText).not.toContain(real.googleSecret);
    expect(healthText).not.toContain(real.githubSecret);

    const meta = await app.request("/api/auth-meta/social");
    expect(meta.status).toBe(200);
    const mBody = (await meta.json()) as {
      providers: Array<{ id: string; label: string }>;
    };
    const ids = mBody.providers.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["google", "github"]));
    expect(JSON.stringify(mBody)).not.toContain(real.googleSecret);
    expect(JSON.stringify(mBody)).not.toContain(real.githubSecret);
  });

  it("POST sign-in/social google：200 + 真实 client_id + callback/google", async () => {
    const env: Bindings = baseRealEnv();
    const { app } = await createTestAppWithRealSocial(env);
    const res = await app.request(
      "/api/auth/sign-in/social",
      jsonPost({
        provider: "google",
        callbackURL: `${real.baseURL}/`,
        disableRedirect: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; redirect?: boolean };
    expect(body.url).toBeTruthy();
    expect(body.url).toContain("https://accounts.google.com");
    expect(body.url).toContain(`client_id=${encodeURIComponent(real.googleId)}`);
    // Better Auth 把 redirect_uri 编进 query；回调路径必须正确
    const expectedCb = callbackUrlFor(real.baseURL, "google");
    expect(body.url).toContain(encodeURIComponent(expectedCb));
    expect(body.url).not.toContain(real.googleSecret);
  });

  it("POST sign-in/social github：200 + 真实 client_id + callback/github", async () => {
    const env: Bindings = baseRealEnv();
    const { app } = await createTestAppWithRealSocial(env);
    const res = await app.request(
      "/api/auth/sign-in/social",
      jsonPost({
        provider: "github",
        callbackURL: `${real.baseURL}/`,
        disableRedirect: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBeTruthy();
    expect(body.url).toMatch(/github\.com/);
    expect(body.url).toContain(`client_id=${real.githubId}`);
    const expectedCb = callbackUrlFor(real.baseURL, "github");
    expect(body.url).toContain(encodeURIComponent(expectedCb));
    expect(body.url).not.toContain(real.githubSecret);
  });
});

describe.runIf(!real.ok)("真实凭证缺失时的说明", () => {
  it("跳过真实凭证套件（本地需配置 .env）", () => {
    expect(real.ok).toBe(false);
  });
});

function baseRealEnv(): Bindings {
  return {
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET || "local-dev-better-auth-secret-at-least-32-chars",
    BETTER_AUTH_URL: real.baseURL,
    TRUSTED_ORIGINS: `${real.baseURL},http://localhost:8787`,
    ENABLED_SOCIAL_PROVIDERS: "google,github",
    GOOGLE_CLIENT_ID: real.googleId,
    GOOGLE_CLIENT_SECRET: real.googleSecret,
    GITHUB_CLIENT_ID: real.githubId,
    GITHUB_CLIENT_SECRET: real.githubSecret,
    EMAIL_PASSWORD_ENABLED: "true",
  };
}

/**
 * 与 createTestApp 相同临时库，但 social 凭证来自调用方（真实 env），
 * 不注入假的 google-client-id-for-smoke-test。
 */
async function createTestAppWithRealSocial(env: Bindings) {
  const { createClient } = await import("@libsql/client");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { createDb } = await import("./db/client");
  const { applyAuthMigrations } = await import("./db/migrate");
  const { createAuth } = await import("./lib/auth");
  const { createApp } = await import("./app");

  const baseURL = env.BETTER_AUTH_URL || "http://localhost:8788";
  const dbPath = join(tmpdir(), `cf-auth-real-social-${crypto.randomUUID()}.db`);
  // 注册到 cleanup：复用 cleanupTestDbs 的 paths 较难，本地用 finally 关
  const client = createClient({ url: `file:${dbPath}` });
  await applyAuthMigrations(client);
  const db = createDb(client);
  const config = resolveAuthConfig(env);
  const auth = createAuth({ config, db, enableOAuthProvider: false });
  const resources = { client, db, auth };
  const { app } = await createApp({ resources, env });

  // 挂到全局 cleanup 列表：通过再调 createTestApp 的副作用太重，这里手动 after 关
  const prev = (globalThis as { __cfAuthRealClients?: Array<{ close: () => Promise<void>; path: string }> })
    .__cfAuthRealClients;
  const list = prev ?? [];
  list.push({
    path: dbPath,
    close: async () => {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      const { unlinkSync } = await import("node:fs");
      for (const suffix of ["", "-wal", "-shm", "-journal"]) {
        try {
          unlinkSync(`${dbPath}${suffix}`);
        } catch {
          /* ignore */
        }
      }
    },
  });
  (globalThis as { __cfAuthRealClients?: typeof list }).__cfAuthRealClients = list;

  return { app, client, config, baseURL };
}

afterEach(async () => {
  const list =
    (globalThis as { __cfAuthRealClients?: Array<{ close: () => Promise<void> }> }).__cfAuthRealClients ??
    [];
  while (list.length) {
    const item = list.pop();
    if (item) await item.close();
  }
});
