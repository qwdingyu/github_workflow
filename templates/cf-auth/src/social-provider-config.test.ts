/**
 * 上游社交运营策略（docs/026 Phase A）单测。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestDbs, createTestApp, jsonPost } from "./test-helpers";
import {
  getEffectiveSocialMeta,
  isProviderEffective,
  listProviderStatus,
  patchProviderConfig,
  reorderProviders,
} from "./lib/social-provider-config";
import { SOCIAL_PROVIDER_REGISTRY } from "./lib/social-providers";
import { adminAuditLog } from "./db/schema";
import { desc, eq } from "drizzle-orm";

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

const envWithGoogleGithub = {
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret",
  GITHUB_CLIENT_ID: "gh-id",
  GITHUB_CLIENT_SECRET: "gh-secret",
  ENABLED_SOCIAL_PROVIDERS: "google,github",
};

describe("social-provider-config 核心", () => {
  it("无 DB 行：密钥齐全且 allowlist 内 → effective true", async () => {
    const { db } = await createTestApp({ social: ["google", "github"] });
    const list = await listProviderStatus(db, {
      ...envWithGoogleGithub,
    });
    const google = list.find((p) => p.id === "google")!;
    const discord = list.find((p) => p.id === "discord")!;
    expect(google.credentialsConfigured).toBe(true);
    expect(google.inEnvAllowlist).toBe(true);
    expect(google.enabled).toBe(true);
    expect(google.effective).toBe(true);
    expect(discord.credentialsConfigured).toBe(false);
    expect(discord.effective).toBe(false);
  });

  it("Admin 禁用后 effective=false；meta 与 sign-in 门禁生效", async () => {
    const { app, db, env } = await createTestApp({
      social: ["google", "github"],
    });

    const before = await getEffectiveSocialMeta(
      db,
      env as Record<string, string | undefined>,
    );
    expect(before.map((p) => p.id).sort()).toEqual(["github", "google"]);

    const disabled = await patchProviderConfig(
      db,
      env as Record<string, string | undefined>,
      "google",
      { enabled: false },
      "admin@example.com",
    );
    expect(disabled.ok).toBe(true);
    if (disabled.ok) {
      expect(disabled.status.enabled).toBe(false);
      expect(disabled.status.effective).toBe(false);
    }

    const after = await getEffectiveSocialMeta(
      db,
      env as Record<string, string | undefined>,
    );
    expect(after.map((p) => p.id)).toEqual(["github"]);

    const meta = await app.request("/api/auth-meta/social");
    const metaBody = (await meta.json()) as {
      providers: Array<{ id: string; label: string }>;
    };
    expect(metaBody.providers.map((p) => p.id)).toEqual(["github"]);

    const blocked = await app.request(
      "/api/auth/sign-in/social",
      jsonPost({
        provider: "google",
        callbackURL: "http://localhost:8788/",
        disableRedirect: true,
      }),
    );
    expect(blocked.status).toBe(403);
    const b = (await blocked.json()) as { error?: string };
    expect(b.error).toBe("social_provider_disabled");

    const okGh = await app.request(
      "/api/auth/sign-in/social",
      jsonPost({
        provider: "github",
        callbackURL: "http://localhost:8788/",
        disableRedirect: true,
      }),
    );
    expect(okGh.status).toBe(200);

    // health 与 meta 一致：不含已禁用源
    const health = (await (
      await app.request("/api/health")
    ).json()) as { socialProviders: string[] };
    expect(health.socialProviders).toEqual(["github"]);
    expect(health.socialProviders).not.toContain("google");
  });

  it("禁用后 link-social 亦 403（不得仍返回授权 URL）", async () => {
    const { app, db, env } = await createTestApp({
      social: ["google", "github"],
    });
    await patchProviderConfig(
      db,
      env as Record<string, string | undefined>,
      "google",
      { enabled: false },
      "admin@example.com",
    );

    const su = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        email: "link-gate@example.com",
        password: "password-at-least-8",
        name: "link-gate",
      }),
    );
    expect(su.status).toBe(200);
    const anyH = su.headers as Headers & { getSetCookie?: () => string[] };
    const cookieParts =
      typeof anyH.getSetCookie === "function"
        ? anyH.getSetCookie().map((c) => c.split(";")[0])
        : [];
    const cookie = cookieParts.filter(Boolean).join("; ");

    const link = await app.request("/api/auth/link-social", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8788",
        Cookie: cookie,
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "http://localhost:8788/",
        disableRedirect: true,
      }),
    });
    expect(link.status).toBe(403);
    const body = (await link.json()) as { error?: string };
    expect(body.error).toBe("social_provider_disabled");
  });

  it("无密钥时不可启用；展示名可覆盖", async () => {
    const { db } = await createTestApp({ social: ["github"] });
    const env: Record<string, string | undefined> = {
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret",
    };

    const noCred = await patchProviderConfig(
      db,
      env,
      "discord",
      { enabled: true },
      null,
    );
    expect(noCred.ok).toBe(false);
    if (!noCred.ok) expect(noCred.reason).toBe("credentials_required");

    // 可先禁用无密钥源（enabled=false）
    const disable = await patchProviderConfig(
      db,
      env,
      "discord",
      { enabled: false, displayLabel: "Discord 社区" },
      null,
    );
    expect(disable.ok).toBe(true);
    if (disable.ok) {
      expect(disable.status.label).toBe("Discord 社区");
      expect(disable.status.enabled).toBe(false);
    }

    const rename = await patchProviderConfig(
      db,
      env,
      "github",
      { displayLabel: "GitHub 企业" },
      "ops@example.com",
    );
    expect(rename.ok).toBe(true);
    if (rename.ok) expect(rename.status.label).toBe("GitHub 企业");

    const meta = await getEffectiveSocialMeta(db, env);
    expect(meta.find((p) => p.id === "github")?.label).toBe("GitHub 企业");
  });

  it("reorder 须完整覆盖注册表 id", async () => {
    const { db } = await createTestApp();
    const bad = await reorderProviders(db, ["google", "github"], null);
    expect(bad.ok).toBe(false);

    const ids = [...SOCIAL_PROVIDER_REGISTRY.map((d) => d.id)].reverse();
    const ok = await reorderProviders(db, ids, "admin@example.com");
    expect(ok.ok).toBe(true);

    const list = await listProviderStatus(db, {});
    expect(list.map((p) => p.id)).toEqual(ids);
  });

  it("isProviderEffective 对未知 id 为 false", async () => {
    const { db } = await createTestApp({ social: ["google"] });
    expect(await isProviderEffective(db, {}, "not-a-provider")).toBe(false);
  });
});

describe("Admin social-providers API", () => {
  it("GET 列表含能力字段且无 secret", async () => {
    const { app } = await createTestApp({ social: ["google", "github"] });
    const res = await app.request("/api/admin/social-providers", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      providers: Array<Record<string, unknown>>;
    };
    expect(body.ok).toBe(true);
    expect(body.providers.length).toBe(SOCIAL_PROVIDER_REGISTRY.length);
    const gh = body.providers.find((p) => p.id === "github")!;
    expect(gh.credentialsConfigured).toBe(true);
    expect(gh.effective).toBe(true);
    // 无 DB 行时为默认状态（configured=false）
    expect(gh.configured).toBe(false);
    // 不泄露真实密钥值（notes 文案可含 “client secret” 说明）
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("github-client-secret");
    expect(raw).not.toContain("google-client-secret");
    expect(raw).not.toContain("gh-secret");
    expect(Object.keys(gh).some((k) => /secret/i.test(k))).toBe(false);
  });

  it("PATCH 禁用 + 审计；无密钥启用 400", async () => {
    const { app, db } = await createTestApp({ social: ["google"] });

    const patch = await app.request("/api/admin/social-providers/google", {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ enabled: false, displayLabel: "谷歌账号" }),
    });
    expect(patch.status).toBe(200);
    const p = (await patch.json()) as {
      ok: boolean;
      provider: { enabled: boolean; label: string; effective: boolean };
    };
    expect(p.ok).toBe(true);
    expect(p.provider.enabled).toBe(false);
    expect(p.provider.label).toBe("谷歌账号");
    expect(p.provider.effective).toBe(false);

    const [audit] = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "social_provider.update"))
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(1);
    expect(audit?.targetId).toBe("google");

    const bad = await app.request("/api/admin/social-providers/discord", {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ enabled: true }),
    });
    expect(bad.status).toBe(400);

    const unknown = await app.request("/api/admin/social-providers/twitter", {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ enabled: false }),
    });
    expect(unknown.status).toBe(404);
  });

  it("PUT order 重排并写审计", async () => {
    const { app, db } = await createTestApp({ social: ["github"] });
    const orderedIds = [
      "github",
      "google",
      "microsoft",
      "apple",
      "discord",
      "gitlab",
    ];
    const res = await app.request("/api/admin/social-providers/order", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ orderedIds }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      providers: Array<{ id: string; sortOrder: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.providers.map((p) => p.id)).toEqual(orderedIds);

    const [audit] = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "social_provider.reorder"))
      .limit(1);
    expect(audit).toBeTruthy();
  });

  it("DELETE 重置为默认：删行恢复默认；未配置 400；未知 404；审计", async () => {
    const { app, db } = await createTestApp({ social: ["google", "github"] });

    // 先建行：禁用 google + 自定义名
    const patch = await app.request("/api/admin/social-providers/google", {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ enabled: false, displayLabel: "谷歌账号" }),
    });
    expect(patch.status).toBe(200);

    // 重置为默认 → 删行，恢复 enabled=true + 注册表默认名 + configured=false
    const reset = await app.request("/api/admin/social-providers/google", {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(reset.status).toBe(200);
    const r = (await reset.json()) as {
      ok: boolean;
      provider: {
        id: string;
        enabled: boolean;
        label: string;
        defaultLabel: string;
        configured: boolean;
        effective: boolean;
      };
    };
    expect(r.ok).toBe(true);
    expect(r.provider.id).toBe("google");
    expect(r.provider.enabled).toBe(true);
    expect(r.provider.label).toBe(r.provider.defaultLabel);
    expect(r.provider.configured).toBe(false);
    expect(r.provider.effective).toBe(true); // 密钥齐全 + allowlist

    const [audit] = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "social_provider.reset"))
      .limit(1);
    expect(audit?.targetId).toBe("google");

    // 无 DB 行（默认状态）→ 400
    const notConfigured = await app.request("/api/admin/social-providers/discord", {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(notConfigured.status).toBe(400);

    // 未知 id → 404
    const unknown = await app.request("/api/admin/social-providers/twitter", {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(unknown.status).toBe(404);
  });

  it("health socialCounts 反映密钥配置（effective 计数）", async () => {
    const { app } = await createTestApp({ social: ["google"] });
    const health = await app.request("/api/admin/health", {
      headers: adminHeaders(),
    });
    expect(health.status).toBe(200);
    const h = (await health.json()) as {
      socialCounts?: { total: number; enabled: number; effective: number };
    };
    expect(h.socialCounts?.total).toBeGreaterThan(0);
    // 无 DB 行默认启用 → enabled = 注册表全量
    expect(h.socialCounts?.enabled).toBe(h.socialCounts?.total);
    // 仅 google 密钥齐全 → effective = 1
    expect(h.socialCounts?.effective).toBe(1);
  });
});
