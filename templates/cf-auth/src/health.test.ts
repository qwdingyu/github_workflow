import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestDbs, createTestApp } from "./test-helpers";
import { systemConfig } from "./db/schema";

afterEach(async () => {
  await cleanupTestDbs();
});

async function setSystemConfig(
  db: Awaited<ReturnType<typeof createTestApp>>["db"],
  key: string,
  value: string,
) {
  await db
    .insert(systemConfig)
    .values({
      key,
      value,
      updatedAt: new Date(),
      updatedBy: "test",
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value, updatedAt: new Date(), updatedBy: "test" },
    });
}

describe("health", () => {
  it("GET /api/health 返回 ok 与 db 连通，并暴露 adminConfigured", async () => {
    const { app } = await createTestApp({ enableOAuthProvider: false });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      db: boolean;
      dbError: string | null;
      adminConfigured: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("cf-auth");
    expect(body.db).toBe(true);
    expect(body.dbError).toBeNull();
    // createTestApp 默认配置了 ADMIN_*
    expect(body.adminConfigured).toBe(true);
  });

  it("未配置 ADMIN_* 时 health.adminConfigured=false", async () => {
    const { app } = await createTestApp({
      enableOAuthProvider: false,
      admin: null,
    });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { adminConfigured: boolean };
    expect(body.adminConfigured).toBe(false);
  });

  it("GET / 返回登录入口页与平台管理入口", async () => {
    const { app } = await createTestApp({ enableOAuthProvider: false });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("cf-auth");
    expect(html).toContain("/sign-in");
    expect(html).toContain("/admin");
    expect(html).toContain("non-admin-session-actions");
    expect(html).toContain("/api/auth-meta/ui");
  });

  it("auth-meta/ui 默认不显示普通用户退出，可由系统配置开启", async () => {
    const { app, db } = await createTestApp({ enableOAuthProvider: false });

    const defaultRes = await app.request("/api/auth-meta/ui");
    expect(defaultRes.status).toBe(200);
    expect(await defaultRes.json()).toEqual({
      ui: { showNonAdminLogout: false },
    });

    await setSystemConfig(db, "ui.show_non_admin_logout", "true");
    const enabledRes = await app.request("/api/auth-meta/ui");
    expect(enabledRes.status).toBe(200);
    expect(await enabledRes.json()).toEqual({
      ui: { showNonAdminLogout: true },
    });
  });

  it("GET /sign-in 保留 Admin callbackURL 且防 open-redirect 脚本仍在", async () => {
    const { app } = await createTestApp({ enableOAuthProvider: false });
    const res = await app.request(
      "/sign-in?callbackURL=%2Fadmin%2Fblocklist",
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/admin/blocklist");
    expect(html).toContain("isAdminReturn");
    expect(html).toContain("safePath");
    // 不得把外域 callback 原样写成 postLogin 目标（由 safePath 约束）
    expect(html).toContain("function safePath");
    // Admin 深链文案不暴露服务端权限配置名或脚本鉴权细节
    expect(html).toContain("管理登录");
    expect(html).toContain("仅限已有账号登录");
    expect(html).toContain("服务端权限自动判断");
    expect(html).not.toContain("ADMIN_EMAILS");
    expect(html).not.toContain("ADMIN_USER_IDS");
    expect(html).not.toContain("ADMIN_API_KEY");
    expect(html).not.toContain("X-Admin-Api-Key");
  });
});
