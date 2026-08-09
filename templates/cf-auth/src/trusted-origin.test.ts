/**
 * 信任域（docs/029）测试：规范化、env∪DB 合并解析、Admin CRUD、CORS/CSRF 集成。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTestDbs,
  createTestApp,
} from "./test-helpers";
import {
  addTrustedOrigin,
  normalizeOrigin,
  resolveTrustedOrigins,
  setTrustedOriginEnabled,
} from "./lib/trusted-origin";

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

describe("trusted-origin normalizeOrigin", () => {
  it("合法 origin 规范化（大小写/尾斜杠/回环 http）", () => {
    expect(normalizeOrigin("https://lucky.eforge.xyz")).toBe(
      "https://lucky.eforge.xyz",
    );
    expect(normalizeOrigin("HTTPS://AUTH.EFORGE.XYZ/")).toBe(
      "https://auth.eforge.xyz",
    );
    expect(normalizeOrigin("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
    expect(normalizeOrigin("http://127.0.0.1:8788/")).toBe(
      "http://127.0.0.1:8788",
    );
    // IPv6 回环（URL.hostname 返回 "[::1]"）与非默认端口
    expect(normalizeOrigin("http://[::1]:8788")).toBe(
      "http://[::1]:8788",
    );
    expect(normalizeOrigin("https://x.example:8443")).toBe(
      "https://x.example:8443",
    );
    expect(normalizeOrigin("  https://x.example  ")).toBe(
      "https://x.example",
    );
  });

  it("拒绝非法 origin（路径/query/凭据/非回环 http/其他协议）", () => {
    expect(normalizeOrigin("https://x.example/path")).toBeNull();
    expect(normalizeOrigin("https://x.example?q=1")).toBeNull();
    expect(normalizeOrigin("https://user:pass@x.example")).toBeNull();
    expect(normalizeOrigin("http://shop.eforge.xyz")).toBeNull();
    expect(normalizeOrigin("ftp://x.example")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin("not-a-url")).toBeNull();
  });
});

describe("resolveTrustedOrigins 合并解析", () => {
  it("env ∪ DB(enabled) ∪ baseOrigin；停用行不生效", async () => {
    const { db } = await createTestApp();
    await addTrustedOrigin(db, {
      origin: "https://from-db.example",
      purpose: "cors",
      actorEmail: "a@example.com",
    });
    const added = await addTrustedOrigin(db, {
      origin: "https://disabled.example",
      purpose: "cors",
      actorEmail: "a@example.com",
    });
    expect(added.ok).toBe(true);
    if (added.ok) {
      const toggled = await setTrustedOriginEnabled(db, added.row.id, false);
      expect(toggled.ok).toBe(true);
    }

    const list = await resolveTrustedOrigins(
      db,
      "cors",
      ["https://from-env.example", "https://from-db.example"],
      "http://localhost:8788",
    );
    expect(list).toContain("https://from-env.example");
    expect(list).toContain("https://from-db.example");
    expect(list).toContain("http://localhost:8788");
    expect(list).not.toContain("https://disabled.example");
  });

  it("purpose 维度隔离：cors 与 admin 互不串扰", async () => {
    const { db } = await createTestApp();
    await addTrustedOrigin(db, {
      origin: "https://only-cors.example",
      purpose: "cors",
      actorEmail: null,
    });
    const adminList = await resolveTrustedOrigins(db, "admin", []);
    const corsList = await resolveTrustedOrigins(db, "cors", []);
    expect(corsList).toContain("https://only-cors.example");
    expect(adminList).not.toContain("https://only-cors.example");
  });
});

describe("Admin trusted-origins API", () => {
  it("创建：校验/规范化/重复；列表含 env 锚；启停；删除；404；审计", async () => {
    const { app } = await createTestApp();

    // 非法 origin → 400
    const bad = await app.request("/api/admin/trusted-origins", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ origin: "https://x.example/path", purpose: "cors" }),
    });
    expect(bad.status).toBe(400);

    // purpose 非法 → 400
    const badPurpose = await app.request("/api/admin/trusted-origins", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ origin: "https://shop.eforge.xyz", purpose: "evil" }),
    });
    expect(badPurpose.status).toBe(400);

    // 创建（大写/尾斜杠 → 规范化入库）
    const create = await app.request("/api/admin/trusted-origins", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ origin: "HTTPS://SHOP.EFORGE.XYZ/", purpose: "cors" }),
    });
    expect(create.status).toBe(200);
    const c = (await create.json()) as {
      item: { id: string; origin: string; purpose: string; enabled: boolean };
    };
    expect(c.item.origin).toBe("https://shop.eforge.xyz");
    expect(c.item.purpose).toBe("cors");
    expect(c.item.enabled).toBe(true);
    const id = c.item.id;

    // 重复 → 400
    const dup = await app.request("/api/admin/trusted-origins", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ origin: "https://shop.eforge.xyz", purpose: "cors" }),
    });
    expect(dup.status).toBe(400);

    // 列表：items + envCors 部署锚（测试 env：baseURL + http://localhost:8787）
    const listRes = await app.request("/api/admin/trusted-origins", {
      headers: adminHeaders(),
    });
    expect(listRes.status).toBe(200);
    const l = (await listRes.json()) as {
      items: Array<{ id: string }>;
      total: number;
      envCors: string[];
    };
    expect(l.total).toBe(1);
    expect(l.envCors).toContain("http://localhost:8788");

    // 停用 → enabled=false
    const disable = await app.request(`/api/admin/trusted-origins/${id}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ enabled: false }),
    });
    expect(disable.status).toBe(200);
    const d = (await disable.json()) as { item: { enabled: boolean } };
    expect(d.item.enabled).toBe(false);

    // 删除 → 200；再删 → 404
    const del = await app.request(`/api/admin/trusted-origins/${id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(del.status).toBe(200);
    const missing = await app.request(`/api/admin/trusted-origins/${id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(missing.status).toBe(404);

    // 审计：trusted_origin.create 恰好 1 条
    const audit = await app.request("/api/admin/audit?action=trusted_origin.create", {
      headers: adminHeaders(),
    });
    const a = (await audit.json()) as { total: number };
    expect(a.total).toBe(1);
  });

  it("purpose 筛选：cors / admin 分别返回", async () => {
    const { app } = await createTestApp();
    const mk = (origin: string, purpose: string) =>
      app.request("/api/admin/trusted-origins", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ origin, purpose }),
      });
    expect((await mk("https://a.example", "cors")).status).toBe(200);
    expect((await mk("https://b.example", "admin")).status).toBe(200);

    const corsRes = await app.request("/api/admin/trusted-origins?purpose=cors", {
      headers: adminHeaders(),
    });
    const cors = (await corsRes.json()) as { items: Array<{ purpose: string }>; total: number };
    expect(cors.total).toBe(1);
    expect(cors.items[0]!.purpose).toBe("cors");

    const badFilter = await app.request("/api/admin/trusted-origins?purpose=evil", {
      headers: adminHeaders(),
    });
    expect(badFilter.status).toBe(400);
  });
});

describe("信任域集成（CORS + CSRF）", () => {
  it("DB cors 项出现在 CORS 响应头", async () => {
    const { app, db } = await createTestApp();
    await addTrustedOrigin(db, {
      origin: "https://cors-db.example",
      purpose: "cors",
      actorEmail: "a@example.com",
    });
    const res = await app.request("/api/health", {
      headers: { Origin: "https://cors-db.example" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://cors-db.example",
    );
  });

  it("DB admin 项可通过 CSRF 写请求；非信任域仍 403", async () => {
    const { app, db } = await createTestApp();
    await addTrustedOrigin(db, {
      origin: "https://admin-db.example",
      purpose: "admin",
      actorEmail: "a@example.com",
    });
    const body = JSON.stringify({
      name: "csrf-db",
      redirect_uris: ["https://csrf-db.example/cb"],
    });

    // DB admin 信任域 origin → 放行
    const ok = await app.request("/api/admin/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Api-Key": "test-admin-api-key-for-cf-auth-m7",
        Origin: "https://admin-db.example",
      },
      body,
    });
    expect(ok.status).toBe(200);

    // 非信任域 → 403
    const evil = await app.request("/api/admin/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Api-Key": "test-admin-api-key-for-cf-auth-m7",
        Origin: "https://evil.example.com",
      },
      body,
    });
    expect(evil.status).toBe(403);
  });
});
