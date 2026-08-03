import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestDbs, createTestApp } from "./test-helpers";

afterEach(async () => {
  await cleanupTestDbs();
});

describe("health", () => {
  it("GET /api/health 返回 ok 与 db 连通", async () => {
    const { app } = await createTestApp({ enableOAuthProvider: false });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      db: boolean;
      dbError: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("cf-auth");
    expect(body.db).toBe(true);
    expect(body.dbError).toBeNull();
  });

  it("GET / 返回登录入口页", async () => {
    const { app } = await createTestApp({ enableOAuthProvider: false });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("cf-auth");
    expect(html).toContain("/sign-in");
  });
});
