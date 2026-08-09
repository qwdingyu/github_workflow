/**
 * 测试辅助：临时 SQLite + 完整 app。
 */
import { createClient, type Client } from "@libsql/client";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";
import { createDb } from "./db/client";
import { applyAuthMigrations } from "./db/migrate";
import { createAuth } from "./lib/auth";
import type { CreateAuthOptions } from "./lib/auth";
import { resolveAuthConfig } from "./lib/env";
import { createApp, type AppResources } from "./app";
import type { Bindings } from "./bindings";

const clients: Client[] = [];
const paths: string[] = [];

export async function cleanupTestDbs() {
  await Promise.all(
    clients.splice(0).map(async (c) => {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    }),
  );
  for (const p of paths.splice(0)) {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try {
        unlinkSync(`${p}${suffix}`);
      } catch {
        /* ignore */
      }
    }
  }
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export async function createTestApp(options?: {
  enableOAuthProvider?: boolean;
  /** 启用假的上游社交凭证（不发起真实 OAuth） */
  social?: Array<"google" | "github" | "discord">;
  baseURL?: string;
  /** 兼容旧参数 */
  google?: boolean;
  /**
   * 覆盖 ADMIN_*。传 null 表示刻意不配置管理面（测 503 / create-client 收口）。
   * 默认：API Key + 常见邮箱白名单。
   */
  admin?: {
    ADMIN_API_KEY?: string | null;
    ADMIN_EMAILS?: string | null;
    ADMIN_USER_IDS?: string | null;
    ADMIN_TRUSTED_ORIGINS?: string | null;
  } | null;
  sendVerificationOTP?: CreateAuthOptions["sendVerificationOTP"];
}) {
  const baseURL = options?.baseURL ?? "http://localhost:8788";
  const dbPath = join(tmpdir(), `cf-auth-test-${crypto.randomUUID()}.db`);
  paths.push(dbPath);
  const client = createClient({ url: `file:${dbPath}` });
  clients.push(client);
  await applyAuthMigrations(client);
  const db = createDb(client);

  const socialList =
    options?.social ??
    (options?.google ? (["google"] as const) : []);

  const socialEnv: Record<string, string> = {};
  for (const id of socialList) {
    const prefix = id.toUpperCase();
    socialEnv[`${prefix}_CLIENT_ID`] = `${id}-client-id-for-smoke-test`;
    socialEnv[`${prefix}_CLIENT_SECRET`] = `${id}-client-secret-for-smoke-test`;
  }

  const defaultAdmin = {
    ADMIN_API_KEY: "test-admin-api-key-for-cf-auth-m7",
    ADMIN_EMAILS: "admin@example.com,oauth-flow@example.com",
  };
  let adminEnv: Record<string, string> = { ...defaultAdmin };
  if (options?.admin === null) {
    // 显式空串：getEnv 见 key 在 c.env 上则不回退 process.env
    adminEnv = {
      ADMIN_API_KEY: "",
      ADMIN_EMAILS: "",
      ADMIN_USER_IDS: "",
    };
  } else if (options?.admin) {
    adminEnv = {
      ADMIN_API_KEY: "",
      ADMIN_EMAILS: "",
      ADMIN_USER_IDS: "",
    };
    for (const [k, v] of Object.entries(options.admin)) {
      if (v != null && v !== "") adminEnv[k] = v;
    }
  }

  const env: Bindings = {
    BETTER_AUTH_SECRET: "test-better-auth-secret-at-least-32-chars!!",
    BETTER_AUTH_URL: baseURL,
    TRUSTED_ORIGINS: `${baseURL},http://localhost:8787`,
    DATABASE_URL: `file:${dbPath}`,
    EMAIL_PASSWORD_ENABLED: "true",
    ...adminEnv,
    ...socialEnv,
  };

  const config = resolveAuthConfig(env);
  const auth = createAuth({
    config,
    db,
    enableOAuthProvider: options?.enableOAuthProvider !== false,
    sendVerificationOTP: options?.sendVerificationOTP,
  });
  const resources: AppResources = {
    client,
    db,
    auth,
    emailOtpSenderReady: Boolean(options?.sendVerificationOTP),
  };
  const { app } = await createApp({ resources, env });
  return { app, client, db, auth, env, baseURL, resources, config };
}

export function jsonPost(body: Record<string, unknown>, cookie?: string, origin = "http://localhost:8788") {
  return {
    method: "POST" as const,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

/** 从 Set-Cookie 拼出后续请求 Cookie 头（Better Auth 多 cookie） */
export function cookieHeaderFrom(setCookie: string | null): string {
  if (!setCookie) return "";
  // set-cookie 可能被 fetch 合并为单行，按 better-auth. 边界拆
  return setCookie
    .split(/,(?=\s*[^;]+=)/)
    .map((part) => part.trim().split(";")[0])
    .filter((c) => c.includes("="))
    .join("; ");
}

export function mergeCookies(...parts: string[]): string {
  const map = new Map<string, string>();
  for (const part of parts) {
    for (const pair of part.split(";")) {
      const trimmed = pair.trim();
      if (!trimmed || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const k = trimmed.slice(0, eq);
      const v = trimmed.slice(eq + 1);
      map.set(k, v);
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
