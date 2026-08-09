/**
 * 平台 Admin API（docs/013 M7a）。
 *
 * 原则：
 * - 仅平台管理员（ADMIN_EMAILS / ADMIN_USER_IDS / ADMIN_API_KEY）
 * - client 列表走 Drizzle 全表（插件 getOAuthClients 仅返回「当前用户名下」）
 * - 创建优先 auth.api.adminCreateOAuthClient；API Key 路径用 Drizzle 直写 + 同源 secret 哈希
 * - GET 永不返回 client_secret
 * - 写操作写 admin_audit_log
 */
import { Hono } from "hono";
import { and, asc, count, desc, eq, gt, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { AppEnv } from "../bindings";
import type { AppResources } from "../app";
import {
  account,
  adminAuditLog,
  authBlocklist,
  emailLog,
  oauthClient,
  session,
  systemConfig,
  user,
} from "../db/schema";
import {
  adminPolicyFromContext,
  requirePlatformAdmin,
  type AdminActor,
} from "../lib/admin-auth";
import {
  HARD_DELETE_BATCH_MAX,
  hardDeleteOAuthClient,
  hardDeleteUser,
  hardDeleteUserFailMessage,
  isDeleteConfirmed,
  type UserDeleteGuards,
} from "../lib/admin-hard-delete";
import { writeAdminAudit } from "../lib/audit";
import {
  addToBlocklist,
  BLOCKLIST_TYPES,
  listBlocklist,
  normalizeEmail,
  removeFromBlocklist,
  type BlocklistType,
} from "../lib/blocklist";
import {
  generatePlainClientSecret,
  hashClientSecret,
} from "../lib/client-secret";
import { clampInteger, fail, ok, safeJsonBody, clientIp } from "../lib/http";
import { toAdminClientDto } from "../lib/oauth-client-dto";
import { parseSessionQuery } from "../lib/admin-session-query";
import {
  assertSkipConsentAllowed,
  parseRedirectUrisStrict,
  resolveFirstPartyHosts,
} from "../lib/oauth-client-validation";
import { buildOAuthClientEnvSnippet } from "../lib/oauth-client-env-snippet";
import { checkDbRateLimit, RATE_LIMITS } from "../lib/rate-limit";
import { getEnv, parseTrustedOrigins, resolveAdminTrustedOrigins } from "../lib/platform";
import { columnLikeContains, likeContains } from "../lib/search";
import {
  addEmailConfig,
  listEmailConfigs,
  removeEmailConfig,
  type UpdateEmailConfigInput,
  updateEmailConfig,
} from "../lib/email-config";
import { sendTestEmail } from "../lib/email";
import {
  addTrustedOrigin,
  isTrustedOriginPurpose,
  listTrustedOrigins,
  removeTrustedOrigin,
  resolveTrustedOrigins,
  setTrustedOriginEnabled,
  TRUSTED_ORIGIN_PURPOSES,
  type TrustedOriginPurpose,
} from "../lib/trusted-origin";
import {
  revokeAllAccessForUser,
  revokeOneSession,
} from "../lib/session-revoke";
import {
  isKnownProviderId,
  listProviderStatus,
  patchProviderConfig,
  reorderProviders,
  resetProviderConfig,
} from "../lib/social-provider-config";

/** 管理面展示用 issuer：BETTER_AUTH_URL → APP_ORIGIN → 请求 origin */
function resolveAdminIssuer(c: Parameters<typeof getEnv>[0]): string {
  const fromEnv =
    getEnv(c, "BETTER_AUTH_URL") || getEnv(c, "APP_ORIGIN") || "";
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  try {
    return new URL(c.req.url).origin;
  } catch {
    return "";
  }
}

function actor(c: { get: (k: "adminActor") => AdminActor | undefined }): AdminActor {
  const a = c.get("adminActor");
  if (!a) throw new Error("adminActor missing");
  return a;
}

/**
 * CSRF 防线（docs/013 §5.6 + docs/029）—— 动态信任域，不硬编码任何域名。
 *
 * ── 为什么需要 CSRF 校验 ──
 * Admin SPA 通过 Cookie（BA session）鉴权管理 API。与 API Key 不同，
 * Cookie 会被浏览器自动携带到同域名请求。攻击者页面若诱导管理员访问恶意网站，
 * 恶意网站可跨站 POST 到 /api/admin/* → 浏览器自动带 Cookie → 本应被拒绝。
 * 此中间件通过校验 Origin 头阻止此类跨站写请求。
 *
 * ── 信任模型（分层，fail-closed）──
 * ① 同源放行：Admin SPA 由 cf-auth 同源托管（/admin），
 *    浏览器 Origin = baseURL origin（BETTER_AUTH_URL/APP_ORIGIN）。
 *    本中间件以 BETTER_AUTH_URL 为权威（反代/多域部署下请求 URL 可能与 baseURL 不同）。
 * ② Admin 信任域放行：env ADMIN_TRUSTED_ORIGINS ∪ DB purpose=admin（docs/029 热配置）。
 *    内网管理域名、dev 代理、独立管理域等场景显式配置。
 * ③ 其余拒绝（403 fail-closed）：未配置任何 Admin 信任域时默认仅同源，
 *    不会误信业务 TRUSTED_ORIGINS 中的 RP 域名（攻击面最小化）。
 *
 * ── 放行路径（不校验）──
 * ① GET/HEAD 等读方法：不修改状态，CSRF 无意义
 * ② 无 Origin 头：非浏览器客户端（curl/CI 脚本/API Key 路径），
 *    API Key 不随 Cookie 自动携带，不受 CSRF 影响
 *
 * ── 为什么业务 TRUSTED_ORIGINS 不被信任 ──
 * TRUSTED_ORIGINS 是业务 RP 的跨域白名单（CORS/better-auth）。将业务域纳入
 * Admin 信任 = 扩大 CSRF 攻击面：业务域若被 XSS 攻破，管理员访问该域时
 * 恶意 JS 可跨站写 Admin API（SameSite=Lax 可缓解但纵深防御要求独立校验）。
 */
const ADMIN_WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

async function assertAdminWriteOrigin(
  c: Parameters<typeof clientIp>[0],
  db: AppResources["db"],
): Promise<Response | null> {
  if (!ADMIN_WRITE_METHODS.has(c.req.method)) return null;
  const origin = c.req.header("Origin");
  if (!origin) return null;
  // 同源参照以 baseURL（BETTER_AUTH_URL/APP_ORIGIN）为权威：
  // Admin SPA 由 baseURL 托管，浏览器 Origin 恒等于 baseURL origin；
  // 反代/多域部署下请求 URL 可能与 baseURL 不同，不能拿请求 URL 硬比。
  const own = resolveAdminIssuer(c);
  if (own && origin === own) return null;
  // 兼容：无 BETTER_AUTH_URL/APP_ORIGIN 配置时回退请求 URL 同源
  try {
    if (origin === new URL(c.req.url).origin) return null;
  } catch {
    /* 无法解析请求 URL 时走显式信任域 */
  }
  // env 部署锚 ∪ DB 运营扩展（docs/029）
  const envList = resolveAdminTrustedOrigins(c);
  const adminTrusted = await resolveTrustedOrigins(db, "admin", envList);
  if (adminTrusted.includes(origin)) return null;
  return fail(c, "跨站写请求被拒绝：Origin 不在 Admin 信任域", 403);
}

/** 硬删用户护栏：白名单 + 不可删本人 */
function userDeleteGuards(
  c: Parameters<typeof adminPolicyFromContext>[0],
  a: AdminActor,
): UserDeleteGuards {
  const policy = adminPolicyFromContext(c);
  return {
    protectedUserIds: policy.userIds,
    protectedEmails: policy.emails,
    actorUserId: a.userId,
  };
}

/** 批量 ids：去重、非空、上限（docs/020 防灾难） */
function parseIdList(input: unknown, max = 20): string[] | null {
  if (!Array.isArray(input)) return null;
  const ids = [
    ...new Set(
      input
        .map((x) => String(x).trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0 || ids.length > max) return null;
  return ids;
}

type LogCursorPayload = {
  v: 1;
  kind: "email_logs";
  snapshotAt: string;
  createdAt: string;
  id: string;
  scope: string;
  total: number;
};

class InvalidLogCursorError extends Error {
  constructor() {
    super("日志分页游标无效或与当前筛选条件不匹配");
    this.name = "InvalidLogCursorError";
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  if (!value || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidLogCursorError();
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeEmailLogCursor(payload: LogCursorPayload): string {
  return encodeBase64Url(JSON.stringify(payload));
}

function decodeEmailLogCursor(cursor: string, scope: string): LogCursorPayload {
  try {
    const payload = JSON.parse(decodeBase64Url(cursor)) as Partial<LogCursorPayload>;
    if (
      payload.v !== 1 ||
      payload.kind !== "email_logs" ||
      payload.scope !== scope ||
      typeof payload.snapshotAt !== "string" ||
      !Number.isFinite(Date.parse(payload.snapshotAt)) ||
      typeof payload.createdAt !== "string" ||
      !Number.isFinite(Date.parse(payload.createdAt)) ||
      typeof payload.id !== "string" ||
      payload.id.length === 0 ||
      !Number.isInteger(payload.total) ||
      (payload.total ?? -1) < 0
    ) {
      throw new InvalidLogCursorError();
    }
    return payload as LogCursorPayload;
  } catch (error) {
    if (error instanceof InvalidLogCursorError) throw error;
    throw new InvalidLogCursorError();
  }
}

function normalizeSnapshotAt(value?: string): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function resolveEmailLogSnapshot(
  cursor: LogCursorPayload | undefined,
  requestedSnapshot?: string,
): string {
  const normalizedRequested = normalizeSnapshotAt(requestedSnapshot);
  if (cursor && normalizedRequested && normalizedRequested !== cursor.snapshotAt) {
    throw new InvalidLogCursorError();
  }
  return cursor?.snapshotAt || normalizedRequested || new Date().toISOString();
}

type EmailLogFilter = {
  status: string;
  search: string;
  limit: number;
  snapshotAt?: string;
  cursor?: string;
};

const STALE_PENDING_EMAIL_LOG_MS = 15 * 60 * 1000;

function decorateEmailLogRow(row: Record<string, unknown>, nowMs: number): Record<string, unknown> {
  if (row.status !== "pending") {
    return { ...row, displayStatus: row.status, displayErrorMessage: row.error };
  }
  const createdMs = row.createdAt instanceof Date
    ? row.createdAt.getTime()
    : Date.parse(String(row.createdAt || ""));
  const stale = Number.isFinite(createdMs) && nowMs - createdMs >= STALE_PENDING_EMAIL_LOG_MS;
  if (!stale) return { ...row, displayStatus: "pending", displayErrorMessage: row.error };
  return {
    ...row,
    displayStatus: "stale_pending",
    displayErrorMessage: row.error || "发送任务已超过 15 分钟未回写结果，请按邮箱或后续 sent 记录核对",
  };
}

function buildEmailLogWhere(filter: EmailLogFilter, cursor?: LogCursorPayload): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(eq(emailLog.status, filter.status));
  const search = filter.search.trim();
  if (search) {
    const escaped = search.replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
    conditions.push(or(
      sql`${emailLog.toAddr} LIKE ${pattern} ESCAPE '\\'`,
      sql`${emailLog.orderId} LIKE ${pattern} ESCAPE '\\'`,
      sql`${emailLog.clientId} LIKE ${pattern} ESCAPE '\\'`,
      sql`${emailLog.subject} LIKE ${pattern} ESCAPE '\\'`,
      sql`${emailLog.provider} LIKE ${pattern} ESCAPE '\\'`,
      sql`${emailLog.error} LIKE ${pattern} ESCAPE '\\'`,
    ) as SQL);
  }
  if (filter.snapshotAt) {
    conditions.push(lte(emailLog.createdAt, new Date(filter.snapshotAt)));
  }
  if (cursor) {
    const cursorDate = new Date(cursor.createdAt);
    conditions.push(or(
      lt(emailLog.createdAt, cursorDate),
      and(eq(emailLog.createdAt, cursorDate), lt(emailLog.id, cursor.id)),
    ) as SQL);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function listEmailLogs(
  db: AppResources["db"],
  filter: EmailLogFilter,
): Promise<{
  total: number;
  results: Record<string, unknown>[];
  snapshotAt: string;
  nextCursor: string;
  hasMore: boolean;
}> {
  const status = filter.status.trim();
  const search = filter.search.trim();
  const scope = JSON.stringify([status, search]);
  const cursor = filter.cursor ? decodeEmailLogCursor(filter.cursor, scope) : undefined;
  const snapshotAt = resolveEmailLogSnapshot(cursor, filter.snapshotAt);
  const normalizedFilter = { ...filter, status, search, snapshotAt: filter.snapshotAt || "" };
  const countWhere = buildEmailLogWhere(normalizedFilter);
  const where = buildEmailLogWhere(normalizedFilter, cursor);

  let total = cursor?.total;
  if (total === undefined) {
    const countQuery = db.select({ count: count() }).from(emailLog);
    const [countRow] = countWhere ? await countQuery.where(countWhere) : await countQuery;
    total = countRow?.count ?? 0;
  }

  const rowsQuery = db
    .select({
      id: emailLog.id,
      orderId: emailLog.orderId,
      clientId: emailLog.clientId,
      toAddr: emailLog.toAddr,
      subject: emailLog.subject,
      status: emailLog.status,
      provider: emailLog.provider,
      error: emailLog.error,
      createdAt: emailLog.createdAt,
    })
    .from(emailLog)
    .orderBy(desc(emailLog.createdAt), desc(emailLog.id))
    .limit(filter.limit + 1);
  const rows = where ? await rowsQuery.where(where) : await rowsQuery;

  const hasMore = rows.length > filter.limit;
  const nowMs = Date.now();
  const results = (rows as unknown as Record<string, unknown>[])
    .slice(0, filter.limit)
    .map((row) => decorateEmailLogRow(row, nowMs));
  const lastLog = results.at(-1);
  const nextCursor = hasMore && lastLog
    ? encodeEmailLogCursor({
      v: 1,
      kind: "email_logs",
      snapshotAt,
      createdAt: String(lastLog.createdAt instanceof Date ? lastLog.createdAt.toISOString() : lastLog.createdAt),
      id: String(lastLog.id),
      scope,
      total,
    })
    : "";
  return { total, results, snapshotAt, nextCursor, hasMore };
}

async function enforceAdminWriteLimit(
  c: Parameters<typeof clientIp>[0],
  db: AppResources["db"],
): Promise<Response | null> {
  const ip = clientIp(c);
  const allowed = await checkDbRateLimit(
    db,
    `adminWrite:${ip}`,
    RATE_LIMITS.adminWrite.limit,
    RATE_LIMITS.adminWrite.windowMs,
  );
  if (!allowed) return fail(c, "请求过于频繁", 429);
  return null;
}

export function createAdminRoutes(resources: AppResources) {
  const { auth, db } = resources;
  const r = new Hono<AppEnv>();

  r.use("*", requirePlatformAdmin(auth, db));
  // CSRF 防线：浏览器写请求的 Origin 必须同源或在 Admin 信任域（docs/013 §5.6 / docs/029）
  r.use("*", async (c, next) => {
    const denied = await assertAdminWriteOrigin(c, db);
    if (denied) return denied;
    await next();
  });

  /** 健康 + 粗计数（含运营向指标） */
  r.get("/health", async (c) => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [userCount] = await db.select({ n: count() }).from(user);
    const [clientCount] = await db.select({ n: count() }).from(oauthClient);
    const [sessionCount] = await db.select({ n: count() }).from(session);
    const [disabledClients] = await db
      .select({ n: count() })
      .from(oauthClient)
      .where(eq(oauthClient.disabled, true));
    const [blocklistCount] = await db.select({ n: count() }).from(authBlocklist);
    // session.createdAt 为 timestamp 模式；与 BA 写入一致
    const [sessions24h] = await db
      .select({ n: count() })
      .from(session)
      .where(gt(session.createdAt, since24h));
    const firstPartyHosts = [...resolveFirstPartyHosts(c)].sort();
    // 社交渠道运营计数（Dashboard 卡片）
    const envBag = (c.env ?? {}) as Record<string, string | undefined>;
    const socialStatus = await listProviderStatus(db, envBag);
    return ok(c, {
      service: "cf-auth-admin",
      issuer: resolveAdminIssuer(c),
      /** 只读：skip_consent 允许的 redirect hostname（与 assertSkipConsentAllowed 同源） */
      firstPartyRedirectHosts: firstPartyHosts,
      counts: {
        users: userCount?.n ?? 0,
        clients: clientCount?.n ?? 0,
        sessions: sessionCount?.n ?? 0,
        disabledClients: disabledClients?.n ?? 0,
        blocklist: blocklistCount?.n ?? 0,
        sessionsCreated24h: sessions24h?.n ?? 0,
      },
      socialCounts: {
        total: socialStatus.length,
        enabled: socialStatus.filter((p) => p.enabled).length,
        effective: socialStatus.filter((p) => p.effective).length,
      },
    });
  });

  // ── Clients ──────────────────────────────────────────────

  r.get("/clients", async (c) => {
    const q = (c.req.query("q") || "").trim();
    const disabledParam = (c.req.query("disabled") || "").trim().toLowerCase();
    const disabledOnly =
      disabledParam === "1" || disabledParam === "true" || disabledParam === "yes";
    const limit = clampInteger(c.req.query("limit"), 50, 1, 200);
    const offset = clampInteger(c.req.query("offset"), 0, 0, 100_000);

    const pattern = likeContains(q);
    const parts = [];
    if (pattern) {
      parts.push(
        or(
          columnLikeContains(oauthClient.name, pattern),
          columnLikeContains(oauthClient.clientId, pattern),
        )!,
      );
    }
    if (disabledOnly) {
      parts.push(eq(oauthClient.disabled, true));
    }
    const where =
      parts.length === 0
        ? undefined
        : parts.length === 1
          ? parts[0]
          : and(...parts);

    const rows = await db
      .select()
      .from(oauthClient)
      .where(where)
      .orderBy(desc(oauthClient.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ n: count() })
      .from(oauthClient)
      .where(where);

    return ok(c, {
      clients: rows.map(toAdminClientDto),
      total: totalRow?.n ?? 0,
      limit,
      offset,
      disabledOnly,
    });
  });

  r.get("/clients/:clientId", async (c) => {
    const clientId = c.req.param("clientId");
    const [row] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1);
    if (!row) return fail(c, "client 不存在", 404);
    return ok(c, { client: toAdminClientDto(row) });
  });

  r.post("/clients", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{
      name?: string;
      client_name?: string;
      redirect_uris?: string[];
      skip_consent?: boolean;
      require_pkce?: boolean;
      disabled?: boolean;
      /** docs/093 邮件网关 */
      email_enabled?: boolean;
      sender_email?: string | null;
      sender_name?: string | null;
    }>(c);
    if (!body) return fail(c, "无效 JSON");

    const name = (body.name || body.client_name || "").trim() || "unnamed-rp";
    const parsedUris = parseRedirectUrisStrict(body.redirect_uris);
    if (!parsedUris.ok) return fail(c, parsedUris.message);
    const redirectUris = parsedUris.uris;
    if (body.skip_consent === true) {
      const sc = assertSkipConsentAllowed(
        redirectUris,
        resolveFirstPartyHosts(c),
      );
      if (!sc.ok) return fail(c, sc.message);
    }

    const a = actor(c);
    let clientId: string;
    let clientSecret: string | undefined;
    let createdVia: "better_auth" | "drizzle" = "drizzle";

    // 有 session 的管理员：走官方 adminCreate（含 skip_consent / require_pkce）
    if (a.via === "session" && c.req.raw.headers.get("cookie")) {
      try {
        const created = (await auth.api.adminCreateOAuthClient({
          body: {
            client_name: name,
            redirect_uris: redirectUris,
            skip_consent: body.skip_consent === true,
            require_pkce: body.require_pkce !== false,
          },
          headers: c.req.raw.headers,
        })) as { client_id: string; client_secret?: string };
        clientId = created.client_id;
        clientSecret = created.client_secret;
        createdVia = "better_auth";
        if (body.disabled === true) {
          await db
            .update(oauthClient)
            .set({ disabled: true, updatedAt: new Date() })
            .where(eq(oauthClient.clientId, clientId));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return fail(c, `创建 client 失败: ${msg}`, 400);
      }
    } else {
      // API Key 路径：无 BA session，直写表（哈希算法与插件一致）
      clientId = generatePlainClientSecret(); // 同字符集 32 位作 client_id
      const plain = generatePlainClientSecret();
      const hashed = await hashClientSecret(plain);
      clientSecret = plain;
      const now = new Date();
      const id = crypto.randomUUID();
      await db.insert(oauthClient).values({
        id,
        clientId,
        clientSecret: hashed,
        name,
        redirectUris: JSON.stringify(redirectUris),
        disabled: body.disabled === true,
        emailEnabled: body.email_enabled === true,
        metadata: (body.sender_email || body.sender_name) ? JSON.stringify({
          sender_email: body.sender_email || null,
          sender_name: body.sender_name || null,
        }) : undefined,
        skipConsent: body.skip_consent === true,
        requirePKCE: body.require_pkce !== false,
        tokenEndpointAuthMethod: "client_secret_basic",
        grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
        responseTypes: JSON.stringify(["code"]),
        public: false,
        type: "web",
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeAdminAudit(db, a, {
      action: "client.create",
      targetType: "oauth_client",
      targetId: clientId,
      meta: { name, redirectUris, via: createdVia, skipConsent: body.skip_consent === true },
    });

    const [row] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1);

    const dto = row ? toAdminClientDto(row) : { clientId, name, redirectUris };
    const issuer = resolveAdminIssuer(c);
    const envSnippet = buildOAuthClientEnvSnippet({
      issuer,
      clientId,
      clientSecret: clientSecret ?? null,
      redirectUris: row
        ? toAdminClientDto(row).redirectUris
        : redirectUris,
      name,
    });

    return ok(c, {
      client: dto,
      /** 明文 secret 仅创建响应出现一次 */
      clientSecret: clientSecret ?? null,
      /** 可粘贴业务 env（含一次性 secret）；列表/详情永不回传 secret */
      envSnippet,
      issuer,
      warning: "请立即保存 client_secret，此后无法再查看明文",
    });
  });

  /** 批量启停 client（串行 PATCH 语义；上限 20；docs/020） */
  r.post("/clients/batch-disabled", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{
      clientIds?: unknown;
      disabled?: boolean;
    }>(c);
    if (!body || typeof body.disabled !== "boolean") {
      return fail(c, "需要 disabled: boolean 与 clientIds: string[]");
    }
    const clientIds = parseIdList(body.clientIds, 20);
    if (!clientIds) return fail(c, "clientIds 须为 1–20 个非空 id");

    const a = actor(c);
    let success = 0;
    let failed = 0;
    const errors: Array<{ clientId: string; message: string }> = [];

    for (const clientId of clientIds) {
      try {
        const [existing] = await db
          .select({ clientId: oauthClient.clientId })
          .from(oauthClient)
          .where(eq(oauthClient.clientId, clientId))
          .limit(1);
        if (!existing) {
          failed++;
          errors.push({ clientId, message: "不存在" });
          continue;
        }
        await db
          .update(oauthClient)
          .set({ disabled: body.disabled, updatedAt: new Date() })
          .where(eq(oauthClient.clientId, clientId));
        await writeAdminAudit(db, a, {
          action: body.disabled ? "client.disable" : "client.enable",
          targetType: "oauth_client",
          targetId: clientId,
          meta: { via: "batch", disabled: body.disabled },
        });
        success++;
      } catch (e) {
        failed++;
        errors.push({
          clientId,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await writeAdminAudit(db, a, {
      action: body.disabled ? "client.batch_disable" : "client.batch_enable",
      targetType: "oauth_client_batch",
      targetId: null,
      meta: {
        disabled: body.disabled,
        requested: clientIds.length,
        success,
        failed,
      },
    });

    return ok(c, { success, failed, errors, disabled: body.disabled });
  });

  r.patch("/clients/:clientId", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const clientId = c.req.param("clientId");
    const [existing] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1);
    if (!existing) return fail(c, "client 不存在", 404);

    const body = await safeJsonBody<{
      name?: string;
      redirect_uris?: string[];
      skip_consent?: boolean;
      require_pkce?: boolean;
      disabled?: boolean;
      /** docs/093 邮件网关 */
      email_enabled?: boolean;
      sender_email?: string | null;
      sender_name?: string | null;
    }>(c);
    if (!body) return fail(c, "无效 JSON");

    const patch: Partial<typeof oauthClient.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof body.name === "string") patch.name = body.name.trim();

    // sender 信息存 metadata JSON（BA 不管理该列，无冲突风险）
    if (body.sender_email !== undefined || body.sender_name !== undefined) {
      let meta: Record<string, unknown> = {};
      try {
        if (existing.metadata) meta = JSON.parse(existing.metadata);
      } catch { /* 旧 metadata 非法时重置 */ }
      if (body.sender_email !== undefined) meta.sender_email = body.sender_email || null;
      if (body.sender_name !== undefined) meta.sender_name = body.sender_name || null;
      patch.metadata = JSON.stringify(meta);
    }

    let nextRedirects: string[] | null = null;
    if (body.redirect_uris) {
      const uris = parseRedirectUrisStrict(body.redirect_uris);
      if (!uris.ok) return fail(c, uris.message);
      nextRedirects = uris.uris;
      patch.redirectUris = JSON.stringify(uris.uris);
    }
    const nextSkip =
      typeof body.skip_consent === "boolean"
        ? body.skip_consent
        : Boolean(existing.skipConsent);
    if (nextSkip) {
      let redirectsForCheck = nextRedirects;
      if (!redirectsForCheck) {
        try {
          const raw = existing.redirectUris;
          const parsed = raw ? (JSON.parse(raw) as unknown) : [];
          redirectsForCheck = Array.isArray(parsed)
            ? parsed.map(String)
            : [];
        } catch {
          redirectsForCheck = [];
        }
      }
      const sc = assertSkipConsentAllowed(
        redirectsForCheck,
        resolveFirstPartyHosts(c),
      );
      if (!sc.ok) return fail(c, sc.message);
    }
    if (typeof body.skip_consent === "boolean") patch.skipConsent = body.skip_consent;
    if (typeof body.require_pkce === "boolean") patch.requirePKCE = body.require_pkce;
    if (typeof body.disabled === "boolean") patch.disabled = body.disabled;
    if (typeof body.email_enabled === "boolean") patch.emailEnabled = body.email_enabled;

    await db
      .update(oauthClient)
      .set(patch)
      .where(eq(oauthClient.clientId, clientId));

    const a = actor(c);
    const action =
      typeof body.disabled === "boolean"
        ? body.disabled
          ? "client.disable"
          : "client.enable"
        : "client.update";
    await writeAdminAudit(db, a, {
      action,
      targetType: "oauth_client",
      targetId: clientId,
      meta: { ...body, client_secret: undefined },
    });

    const [row] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1);
    return ok(c, { client: row ? toAdminClientDto(row) : null });
  });

  r.post("/clients/:clientId/rotate-secret", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const clientId = c.req.param("clientId");
    const [existing] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1);
    if (!existing) return fail(c, "client 不存在", 404);
    if (existing.public) return fail(c, "public client 无 secret 可轮换");

    const plain = generatePlainClientSecret();
    const hashed = await hashClientSecret(plain);
    await db
      .update(oauthClient)
      .set({ clientSecret: hashed, updatedAt: new Date() })
      .where(eq(oauthClient.clientId, clientId));

    await writeAdminAudit(db, actor(c), {
      action: "client.rotate_secret",
      targetType: "oauth_client",
      targetId: clientId,
      meta: { rotated: true },
    });

    return ok(c, {
      clientId,
      clientSecret: plain,
      warning: "旧 secret 立即失效；请立即保存新 secret",
    });
  });

  /**
   * 硬删除单个 OAuth client（不可逆）。
   * Body 必须 { confirm: "DELETE" }；先清 token/consent 再删行。
   */
  r.post("/clients/:clientId/delete", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const clientId = c.req.param("clientId");
    const body = await safeJsonBody<{ confirm?: unknown }>(c);
    if (!isDeleteConfirmed(body)) {
      return fail(c, '须在 body 中传 confirm: "DELETE" 以确认硬删除');
    }

    const result = await hardDeleteOAuthClient(db, clientId);
    if (!result.ok) return fail(c, "client 不存在", 404);

    await writeAdminAudit(db, actor(c), {
      action: "client.delete",
      targetType: "oauth_client",
      targetId: clientId,
      meta: {
        name: result.name,
        refreshDeleted: result.refreshDeleted,
        accessDeleted: result.accessDeleted,
        consentDeleted: result.consentDeleted,
      },
    });

    return ok(c, {
      deleted: true,
      clientId: result.clientId,
      name: result.name,
      refreshDeleted: result.refreshDeleted,
      accessDeleted: result.accessDeleted,
      consentDeleted: result.consentDeleted,
    });
  });

  /**
   * 批量硬删除 client：1–HARD_DELETE_BATCH_MAX，串行 + confirm DELETE。
   * 禁止无 id 列表的整表删除。
   */
  r.post("/clients/batch-delete", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{ clientIds?: unknown; confirm?: unknown }>(c);
    if (!isDeleteConfirmed(body)) {
      return fail(c, '须在 body 中传 confirm: "DELETE" 以确认硬删除');
    }
    const clientIds = parseIdList(body?.clientIds, HARD_DELETE_BATCH_MAX);
    if (!clientIds) {
      return fail(
        c,
        `clientIds 须为 1–${HARD_DELETE_BATCH_MAX} 个非空 id（硬删除上限严于启停）`,
      );
    }

    const a = actor(c);
    let success = 0;
    let failed = 0;
    const errors: Array<{ clientId: string; message: string }> = [];

    for (const clientId of clientIds) {
      const result = await hardDeleteOAuthClient(db, clientId);
      if (!result.ok) {
        failed++;
        errors.push({ clientId, message: "不存在" });
        continue;
      }
      success++;
      await writeAdminAudit(db, a, {
        action: "client.delete",
        targetType: "oauth_client",
        targetId: clientId,
        meta: {
          via: "batch",
          name: result.name,
          refreshDeleted: result.refreshDeleted,
          accessDeleted: result.accessDeleted,
          consentDeleted: result.consentDeleted,
        },
      });
    }

    await writeAdminAudit(db, a, {
      action: "client.delete",
      targetType: "oauth_client_batch",
      targetId: null,
      meta: {
        via: "batch",
        requested: clientIds.length,
        success,
        failed,
      },
    });

    return ok(c, { success, failed, errors });
  });

  // ── Users ────────────────────────────────────────────────

  r.get("/users", async (c) => {
    const q = (c.req.query("q") || "").trim();
    const limit = clampInteger(c.req.query("limit"), 50, 1, 200);
    const offset = clampInteger(c.req.query("offset"), 0, 0, 100_000);

    const pattern = likeContains(q);
    const where = pattern
      ? or(
          columnLikeContains(user.email, pattern),
          columnLikeContains(user.id, pattern),
          columnLikeContains(user.name, pattern),
        )
      : undefined;

    const rows = await db
      .select()
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db.select({ n: count() }).from(user).where(where);

    // 一次查出本页全部 providers，避免 N+1
    const userIds = rows.map((u) => u.id);
    const accountsByUser = new Map<
      string,
      Array<{ providerId: string; accountId: string }>
    >();
    if (userIds.length > 0) {
      const accounts = await db
        .select({
          userId: account.userId,
          providerId: account.providerId,
          accountId: account.accountId,
        })
        .from(account)
        .where(inArray(account.userId, userIds));
      for (const a of accounts) {
        const list = accountsByUser.get(a.userId) ?? [];
        list.push({ providerId: a.providerId, accountId: a.accountId });
        accountsByUser.set(a.userId, list);
      }
    }

    // 附加封禁状态（docs/013 §5.2：user_id 或 email 任一被封 = 已禁）
    const blockedIds = new Set<string>();
    if (userIds.length > 0) {
      const userBlockRows = await db
        .select({ value: authBlocklist.value })
        .from(authBlocklist)
        .where(
          and(
            eq(authBlocklist.type, "user_id"),
            inArray(authBlocklist.value, userIds),
          ),
        );
      for (const r of userBlockRows) blockedIds.add(r.value);
    }
    const emails = rows.map((u) => u.email).filter(Boolean) as string[];
    if (emails.length > 0) {
      const lowered = emails.map((e) => e.toLowerCase());
      const emailBlockRows = await db
        .select({ value: authBlocklist.value })
        .from(authBlocklist)
        .where(
          and(
            eq(authBlocklist.type, "email"),
            inArray(authBlocklist.value, lowered),
          ),
        );
      const blockedEmails = new Set(emailBlockRows.map((r) => r.value));
      for (const u of rows) {
        if (blockedEmails.has(u.email.toLowerCase())) blockedIds.add(u.id);
      }
    }

    const usersOut = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      image: u.image,
      createdAt: u.createdAt,
      providers: accountsByUser.get(u.id) ?? [],
      blocked: blockedIds.has(u.id),
    }));

    return ok(c, {
      users: usersOut,
      total: totalRow?.n ?? 0,
      limit,
      offset,
    });
  });

  /**
   * 单用户封禁：user_id + 可选 email 黑名单 + 完整下线一次。
   * audit action 沿用 user.disable（docs/020）。
   */
  async function blockOneUser(
    a: AdminActor,
    userId: string,
    opts: { reason: string | null; alsoEmail: boolean },
  ): Promise<
    | {
        ok: true;
        userId: string;
        email: string | null;
        revoke: Awaited<ReturnType<typeof addToBlocklist>>["revoke"];
        blocklistIds: string[];
      }
    | { ok: false; message: string }
  > {
    const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!u) return { ok: false, message: "用户不存在" };

    const blocklistIds: string[] = [];
    // 先写 user_id；email 失败时仍保留 user_id 封禁（登录已拦），并在响应/审计标明
    const byUser = await addToBlocklist(db, {
      type: "user_id",
      value: userId,
      reason: opts.reason,
      createdByUserId: a.userId,
      createdByEmail: a.email,
    });
    blocklistIds.push(byUser.entry.id);

    let emailNorm: string | null = null;
    if (opts.alsoEmail && u.email) {
      emailNorm = normalizeEmail(u.email);
      const byEmail = await addToBlocklist(db, {
        type: "email",
        value: u.email,
        reason: opts.reason,
        createdByUserId: a.userId,
        createdByEmail: a.email,
      });
      blocklistIds.push(byEmail.entry.id);
      // email 路径可能再次匹配同一用户；addToBlocklist 内部已按匹配列表 revoke，
      // user_id 路径已 revoke 过 → 计数可能累加展示，DB 已干净
    }

    await writeAdminAudit(db, a, {
      action: "user.disable",
      targetType: "user",
      targetId: userId,
      meta: {
        reason: opts.reason,
        alsoEmail: opts.alsoEmail,
        blocklistIds,
        revoke: byUser.revoke,
      },
    });

    return {
      ok: true,
      userId,
      email: emailNorm,
      revoke: byUser.revoke,
      blocklistIds,
    };
  }

  r.post("/users/:userId/block", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const userId = c.req.param("userId");
    const body = await safeJsonBody<{ reason?: string; alsoEmail?: boolean }>(c);
    const a = actor(c);
    const result = await blockOneUser(a, userId, {
      reason: body?.reason?.trim() || null,
      alsoEmail: body?.alsoEmail !== false,
    });
    if (!result.ok) return fail(c, result.message, 404);
    return ok(c, {
      blocked: true,
      userId: result.userId,
      email: result.email,
      revoke: result.revoke,
      blocklistIds: result.blocklistIds,
    });
  });

  /** 批量封禁：1–20；串行；与 clients batch 同纪律 */
  r.post("/users/batch-block", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{
      userIds?: unknown;
      reason?: string;
      alsoEmail?: boolean;
    }>(c);
    const userIds = parseIdList(body?.userIds, 20);
    if (!userIds) return fail(c, "userIds 须为 1–20 个非空 id");

    const a = actor(c);
    const reason = body?.reason?.trim() || null;
    const alsoEmail = body?.alsoEmail !== false;
    let success = 0;
    let failed = 0;
    const errors: Array<{ userId: string; message: string }> = [];

    for (const userId of userIds) {
      try {
        const result = await blockOneUser(a, userId, { reason, alsoEmail });
        if (!result.ok) {
          failed++;
          errors.push({ userId, message: result.message });
        } else {
          success++;
        }
      } catch (e) {
        failed++;
        errors.push({
          userId,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await writeAdminAudit(db, a, {
      action: "user.disable",
      targetType: "user_batch",
      targetId: null,
      meta: {
        via: "batch",
        requested: userIds.length,
        success,
        failed,
        reason,
      },
    });

    return ok(c, { success, failed, errors });
  });

  /**
   * 批量完整下线（不写黑名单）：1–20 userId，串行 revokeAllAccessForUser。
   * 与 batch-block 区分：用户仍可再登录（docs/020 §6.3 Users）。
   */
  r.post("/users/batch-revoke-access", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{ userIds?: unknown }>(c);
    const userIds = parseIdList(body?.userIds, 20);
    if (!userIds) return fail(c, "userIds 须为 1–20 个非空 id");

    const a = actor(c);
    let success = 0;
    let failed = 0;
    const errors: Array<{ userId: string; message: string }> = [];
    let sessionsDeleted = 0;
    let refreshRevoked = 0;
    let accessDeleted = 0;

    for (const userId of userIds) {
      try {
        const [u] = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1);
        if (!u) {
          failed++;
          errors.push({ userId, message: "用户不存在" });
          continue;
        }
        const result = await revokeAllAccessForUser(db, userId);
        success++;
        sessionsDeleted += result.sessionsDeleted;
        refreshRevoked += result.refreshRevoked;
        accessDeleted += result.accessDeleted;
        await writeAdminAudit(db, a, {
          action: "session.revoke",
          targetType: "user",
          targetId: userId,
          meta: {
            via: "batch_revoke_access",
            scope: "all_sessions_and_tokens",
            ...result,
          },
        });
      } catch (e) {
        failed++;
        errors.push({
          userId,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await writeAdminAudit(db, a, {
      action: "session.revoke",
      targetType: "user_batch",
      targetId: null,
      meta: {
        via: "batch_revoke_access",
        requested: userIds.length,
        success,
        failed,
        sessionsDeleted,
        refreshRevoked,
        accessDeleted,
      },
    });

    return ok(c, {
      success,
      failed,
      errors,
      sessionsDeleted,
      refreshRevoked,
      accessDeleted,
    });
  });

  /**
   * 硬删除单个用户（不可逆）。
   * Body 必须 { confirm: "DELETE" }；禁止删白名单管理员与本人。
   */
  r.post("/users/:userId/delete", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const userId = c.req.param("userId");
    const body = await safeJsonBody<{ confirm?: unknown }>(c);
    if (!isDeleteConfirmed(body)) {
      return fail(c, '须在 body 中传 confirm: "DELETE" 以确认硬删除');
    }

    const a = actor(c);
    const result = await hardDeleteUser(db, userId, userDeleteGuards(c, a));
    if (!result.ok) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "protected_admin" ||
              result.reason === "cannot_delete_self"
            ? 403
            : 400;
      return fail(c, hardDeleteUserFailMessage(result.reason), status);
    }

    await writeAdminAudit(db, a, {
      action: "user.delete",
      targetType: "user",
      targetId: userId,
      meta: {
        email: result.email,
        revoke: result.revoke,
        blocklistRemoved: result.blocklistRemoved,
      },
    });

    return ok(c, {
      deleted: true,
      userId: result.userId,
      email: result.email,
      revoke: result.revoke,
      blocklistRemoved: result.blocklistRemoved,
    });
  });

  /**
   * 批量硬删除用户：1–HARD_DELETE_BATCH_MAX，串行 + confirm DELETE。
   */
  r.post("/users/batch-delete", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{ userIds?: unknown; confirm?: unknown }>(c);
    if (!isDeleteConfirmed(body)) {
      return fail(c, '须在 body 中传 confirm: "DELETE" 以确认硬删除');
    }
    const userIds = parseIdList(body?.userIds, HARD_DELETE_BATCH_MAX);
    if (!userIds) {
      return fail(
        c,
        `userIds 须为 1–${HARD_DELETE_BATCH_MAX} 个非空 id（硬删除上限严于封禁）`,
      );
    }

    const a = actor(c);
    const guards = userDeleteGuards(c, a);
    let success = 0;
    let failed = 0;
    const errors: Array<{ userId: string; message: string }> = [];

    for (const userId of userIds) {
      const result = await hardDeleteUser(db, userId, guards);
      if (!result.ok) {
        failed++;
        errors.push({
          userId,
          message: hardDeleteUserFailMessage(result.reason),
        });
        continue;
      }
      success++;
      await writeAdminAudit(db, a, {
        action: "user.delete",
        targetType: "user",
        targetId: userId,
        meta: {
          via: "batch",
          email: result.email,
          revoke: result.revoke,
          blocklistRemoved: result.blocklistRemoved,
        },
      });
    }

    await writeAdminAudit(db, a, {
      action: "user.delete",
      targetType: "user_batch",
      targetId: null,
      meta: {
        via: "batch",
        requested: userIds.length,
        success,
        failed,
      },
    });

    return ok(c, { success, failed, errors });
  });

  /**
   * 解禁用户：移除 user_id 与 email 类型的 blocklist 记录。
   * 与"封禁并下线"对称——解禁后用户可重新登录（前提：未被邮箱域级屏蔽）。
   */
  r.post("/users/:userId/enable", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const userId = c.req.param("userId");
    const [userRow] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!userRow) return fail(c, "用户不存在", 404);

    const emailLower = userRow.email.toLowerCase();
    const blockRows = await db
      .select({ id: authBlocklist.id, type: authBlocklist.type })
      .from(authBlocklist)
      .where(
        or(
          and(
            eq(authBlocklist.type, "user_id"),
            eq(authBlocklist.value, userId),
          ),
          and(
            eq(authBlocklist.type, "email"),
            eq(authBlocklist.value, emailLower),
          ),
        ),
      );
    let removed = 0;
    for (const r of blockRows) {
      await db.delete(authBlocklist).where(eq(authBlocklist.id, r.id));
      removed++;
    }

    await writeAdminAudit(db, actor(c), {
      action: "user.enable",
      targetType: "user",
      targetId: userId,
      meta: { email: emailLower, removedEntries: removed },
    });
    return ok(c, { enabled: true, userId, email: emailLower, removedEntries: removed });
  });

  // ── Sessions ─────────────────────────────────────────────

  /**
   * 按邮箱或 userId 列会话（运维主入口）。
   * query: q | email | userId（优先 q；email/userId 兼容深链）
   * - 邮箱精确匹配（规范化小写）；无用户 → 200 + sessions=[] + message
   * - userId 原样；无会话 → 空数组（不 404，与旧 /users/:id/sessions 一致）
   */
  r.get("/sessions", async (c) => {
    const qRaw =
      c.req.query("q") ||
      c.req.query("email") ||
      c.req.query("userId") ||
      "";
    const parsed = parseSessionQuery(qRaw);
    if (parsed.kind === "empty") {
      return fail(c, "请提供 q（邮箱或用户 ID）", 400);
    }

    let resolvedUserId: string | null = null;
    let resolvedEmail: string | null = null;

    if (parsed.kind === "email") {
      const [u] = await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.email, parsed.email))
        .limit(1);
      if (!u) {
        return ok(c, {
          sessions: [],
          userId: null,
          email: parsed.email,
          queryKind: "email",
          message: `未找到邮箱为 ${parsed.email} 的用户`,
        });
      }
      resolvedUserId = u.id;
      resolvedEmail = u.email;
    } else {
      resolvedUserId = parsed.userId;
      const [u] = await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.id, parsed.userId))
        .limit(1);
      resolvedEmail = u?.email ?? null;
    }

    const page = clampInteger(c.req.query("page"), 1, 1, 1000);
    const limit = clampInteger(c.req.query("limit"), 20, 1, 100);
    const offset = (page - 1) * limit;

    const baseQuery = db
      .select({
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      })
      .from(session)
      .where(eq(session.userId, resolvedUserId!))
      .orderBy(desc(session.createdAt));

    const [rows, [{ count: total }]] = await Promise.all([
      baseQuery.limit(limit).offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(session)
        .where(eq(session.userId, resolvedUserId!)),
    ]);

    return ok(c, {
      sessions: rows,
      userId: resolvedUserId,
      email: resolvedEmail,
      queryKind: parsed.kind,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  r.get("/users/:userId/sessions", async (c) => {
    const userId = c.req.param("userId");
    const rows = await db
      .select({
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        // 不返回 session.token
      })
      .from(session)
      .where(eq(session.userId, userId))
      .orderBy(desc(session.createdAt));
    return ok(c, { sessions: rows, userId });
  });

  r.delete("/users/:userId/sessions", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const userId = c.req.param("userId");
    const result = await revokeAllAccessForUser(db, userId);
    await writeAdminAudit(db, actor(c), {
      action: "session.revoke",
      targetType: "user",
      targetId: userId,
      meta: { scope: "all_sessions_and_tokens", ...result },
    });
    return ok(c, { revoked: "all", ...result });
  });

  r.delete("/sessions/:sessionId", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const sessionId = c.req.param("sessionId");
    const result = await revokeOneSession(db, sessionId);
    if (!result.ok) return fail(c, "session 不存在", 404);
    await writeAdminAudit(db, actor(c), {
      action: "session.revoke",
      targetType: "session",
      targetId: sessionId,
      meta: {
        userId: result.userId,
        refreshRevoked: result.refreshRevoked,
        accessDeleted: result.accessDeleted,
      },
    });
    return ok(c, {
      revoked: sessionId,
      userId: result.userId,
      refreshRevoked: result.refreshRevoked,
      accessDeleted: result.accessDeleted,
    });
  });

  /** 批量下线会话：1–20 个 sessionId，串行 */
  r.post("/sessions/batch-revoke", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{ sessionIds?: unknown }>(c);
    const sessionIds = parseIdList(body?.sessionIds, 20);
    if (!sessionIds) return fail(c, "sessionIds 须为 1–20 个非空 id");

    const a = actor(c);
    let success = 0;
    let failed = 0;
    const errors: Array<{ sessionId: string; message: string }> = [];
    let refreshRevoked = 0;
    let accessDeleted = 0;

    for (const sessionId of sessionIds) {
      const result = await revokeOneSession(db, sessionId);
      if (!result.ok) {
        failed++;
        errors.push({ sessionId, message: "不存在" });
        continue;
      }
      success++;
      refreshRevoked += result.refreshRevoked;
      accessDeleted += result.accessDeleted;
      await writeAdminAudit(db, a, {
        action: "session.revoke",
        targetType: "session",
        targetId: sessionId,
        meta: {
          via: "batch",
          userId: result.userId,
          refreshRevoked: result.refreshRevoked,
          accessDeleted: result.accessDeleted,
        },
      });
    }

    await writeAdminAudit(db, a, {
      action: "session.revoke",
      targetType: "session_batch",
      targetId: null,
      meta: {
        via: "batch",
        requested: sessionIds.length,
        success,
        failed,
        refreshRevoked,
        accessDeleted,
      },
    });

    return ok(c, { success, failed, errors, refreshRevoked, accessDeleted });
  });

  // ── Blocklist ────────────────────────────────────────────

  r.get("/blocklist", async (c) => {
    const limit = clampInteger(c.req.query("limit"), 50, 1, 200);
    const offset = clampInteger(c.req.query("offset"), 0, 0, 100_000);
    const type = (c.req.query("type") || "").trim();
    const data = await listBlocklist(db, {
      limit,
      offset,
      type: type || undefined,
    });
    return ok(c, { ...data, limit, offset });
  });

  r.post("/blocklist", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{
      type?: string;
      value?: string;
      reason?: string;
      expiresAt?: string | null;
    }>(c);
    if (!body?.type || !body?.value) {
      return fail(c, "type 与 value 必填");
    }
    if (!BLOCKLIST_TYPES.includes(body.type as BlocklistType)) {
      return fail(c, `type 须为 ${BLOCKLIST_TYPES.join(" | ")}`);
    }

    let expiresAt: Date | null | undefined;
    if (body.expiresAt === null) expiresAt = null;
    else if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
      const d = new Date(body.expiresAt);
      if (Number.isNaN(d.getTime())) return fail(c, "expiresAt 非法");
      expiresAt = d;
    }

    const a = actor(c);
    try {
      const result = await addToBlocklist(db, {
        type: body.type as BlocklistType,
        value: body.value,
        reason: body.reason,
        expiresAt,
        createdByUserId: a.userId,
        createdByEmail: a.email,
      });
      await writeAdminAudit(db, a, {
        action: "blocklist.add",
        targetType: "blocklist",
        targetId: result.entry.id,
        meta: {
          type: result.entry.type,
          value: result.entry.value,
          created: result.created,
          matchedUserIds: result.matchedUserIds,
          revoke: result.revoke,
        },
      });
      return ok(c, {
        entry: result.entry,
        created: result.created,
        matchedUserIds: result.matchedUserIds,
        revoke: result.revoke,
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      if (code === "invalid_email") return fail(c, "请输入有效的邮箱地址");
      if (code === "invalid_email_domain") return fail(c, "邮箱域格式无效");
      if (code === "empty_blocklist_value") return fail(c, "value 不能为空");
      if (code === "invalid_blocklist_type") return fail(c, "type 无效");
      return fail(c, `添加失败: ${code}`, 400);
    }
  });

  r.delete("/blocklist/:id", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const id = c.req.param("id");
    const removed = await removeFromBlocklist(db, id);
    if (!removed) return fail(c, "记录不存在", 404);
    await writeAdminAudit(db, actor(c), {
      action: "blocklist.remove",
      targetType: "blocklist",
      targetId: id,
    });
    return ok(c, { deleted: true, id });
  });

  /**
   * 批量移除黑名单：1–20 个 id，串行单条删除 + 逐条 audit（docs/020 §6.3）。
   * 仅解除登录拦截，不“反向创建”用户；移除后对方可再登录。
   */
  r.post("/blocklist/batch-remove", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{ ids?: unknown }>(c);
    const ids = parseIdList(body?.ids, 20);
    if (!ids) return fail(c, "ids 须为 1–20 个非空 id");

    const a = actor(c);
    let success = 0;
    let failed = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const id of ids) {
      const removed = await removeFromBlocklist(db, id);
      if (!removed) {
        failed++;
        errors.push({ id, message: "不存在" });
        continue;
      }
      success++;
      await writeAdminAudit(db, a, {
        action: "blocklist.remove",
        targetType: "blocklist",
        targetId: id,
        meta: { via: "batch" },
      });
    }

    await writeAdminAudit(db, a, {
      action: "blocklist.remove",
      targetType: "blocklist_batch",
      targetId: null,
      meta: {
        via: "batch",
        requested: ids.length,
        success,
        failed,
      },
    });

    return ok(c, { success, failed, errors });
  });

  // ── Trusted origins（docs/029：env 部署锚 ∪ DB 运营扩展，Admin 热管理）──

  r.get("/trusted-origins", async (c) => {
    const purposeParam = (c.req.query("purpose") || "").trim();
    let purpose: TrustedOriginPurpose | undefined;
    if (purposeParam) {
      if (!isTrustedOriginPurpose(purposeParam)) {
        return fail(c, `purpose 须为 ${TRUSTED_ORIGIN_PURPOSES.join(" | ")}`);
      }
      purpose = purposeParam;
    }
    const limit = clampInteger(c.req.query("limit"), 100, 1, 200);
    const offset = clampInteger(c.req.query("offset"), 0, 0, 100_000);
    const rows = await listTrustedOrigins(db, purpose ? { purpose } : {});
    const paged = rows.slice(offset, offset + limit);
    return ok(c, {
      items: paged,
      total: rows.length,
      limit,
      offset,
      purpose: purpose ?? null,
      // env 部署锚只读展示：部署基线，不可在此改删（DB 行是运营扩展）
      envCors: parseTrustedOrigins(getEnv(c, "TRUSTED_ORIGINS"), []),
      envAdmin: parseTrustedOrigins(getEnv(c, "ADMIN_TRUSTED_ORIGINS"), []),
      note:
        "env 部署锚（TRUSTED_ORIGINS / ADMIN_TRUSTED_ORIGINS）只读展示，不可在此删除；DB 行新增/启停即时生效，无需重新部署。",
    });
  });

  r.post("/trusted-origins", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{ origin?: unknown; purpose?: unknown }>(c);
    if (!body || typeof body.origin !== "string" || !body.origin.trim()) {
      return fail(c, "origin 必填");
    }
    const result = await addTrustedOrigin(db, {
      origin: body.origin,
      purpose: body.purpose as TrustedOriginPurpose,
      actorEmail: actor(c).email,
    });
    if (!result.ok) {
      if (result.reason === "invalid_origin") {
        return fail(
          c,
          "origin 无效：仅 https:// 或 http://localhost / 127.0.0.1 / ::1，且不含路径、query、用户名密码",
        );
      }
      if (result.reason === "invalid_purpose") {
        return fail(c, `purpose 须为 ${TRUSTED_ORIGIN_PURPOSES.join(" | ")}`);
      }
      return fail(c, "该 origin 已存在于同 purpose 信任域", 400);
    }

    await writeAdminAudit(db, actor(c), {
      action: "trusted_origin.create",
      targetType: "trusted_origin",
      targetId: result.row.id,
      meta: { origin: result.row.origin, purpose: result.row.purpose },
    });
    return ok(c, { item: result.row });
  });

  /** 软启停；origin 不可修改（改 = 删 + 建，防绕过审计） */
  r.patch("/trusted-origins/:id", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const id = c.req.param("id");
    const body = await safeJsonBody<{ enabled?: unknown }>(c);
    if (!body || typeof body.enabled !== "boolean") {
      return fail(c, "enabled 须为 boolean；origin 不可修改（改 = 删 + 建）");
    }
    const result = await setTrustedOriginEnabled(db, id, body.enabled);
    if (!result.ok) return fail(c, "记录不存在", 404);

    await writeAdminAudit(db, actor(c), {
      action: "trusted_origin.update",
      targetType: "trusted_origin",
      targetId: id,
      meta: {
        origin: result.row.origin,
        purpose: result.row.purpose,
        enabled: result.row.enabled,
      },
    });
    return ok(c, { item: result.row });
  });

  r.delete("/trusted-origins/:id", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const id = c.req.param("id");
    const result = await removeTrustedOrigin(db, id);
    if (!result.ok) return fail(c, "记录不存在", 404);

    await writeAdminAudit(db, actor(c), {
      action: "trusted_origin.delete",
      targetType: "trusted_origin",
      targetId: id,
      meta: { origin: result.origin },
    });
    return ok(c, { deleted: true, origin: result.origin });
  });

  /** 批量删除信任域：1–20 个 id，串行单条删除 + 逐条 audit。 */
  r.post("/trusted-origins/batch-delete", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;
    const body = await safeJsonBody<{ ids?: unknown }>(c);
    const ids = parseIdList(body?.ids, 20);
    if (!ids) return fail(c, "ids 须为 1–20 个非空 id");

    const a = actor(c);
    let success = 0;
    let failed = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const id of ids) {
      const result = await removeTrustedOrigin(db, id);
      if (!result.ok) {
        failed++;
        errors.push({ id, message: "记录不存在" });
        continue;
      }
      success++;
      await writeAdminAudit(db, a, {
        action: "trusted_origin.delete",
        targetType: "trusted_origin",
        targetId: id,
        meta: { origin: result.origin, via: "batch" },
      });
    }

    await writeAdminAudit(db, a, {
      action: "trusted_origin.delete",
      targetType: "trusted_origin_batch",
      targetId: null,
      meta: {
        via: "batch",
        requested: ids.length,
        success,
        failed,
      },
    });

    return ok(c, { success, failed, errors });
  });

  // ── Email config（docs/030：Resend / SMTP 多通道容错链，Admin 管理）──

  r.get("/email-config", async (c) => {
    const rows = await listEmailConfigs(db);
    return ok(c, { items: rows, total: rows.length });
  });

  r.post("/email-config", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{
      provider?: unknown; name?: unknown; host?: unknown;
      port?: unknown; username?: unknown; tlsMode?: unknown;
      priority?: unknown; plainSecret?: unknown;
    }>(c);
    if (!body || typeof body.provider !== "string" || typeof body.plainSecret !== "string") {
      return fail(c, "provider 与 plainSecret 必填");
    }
    const envBag = (c.env ?? {}) as Record<string, string | undefined>;
    const result = await addEmailConfig(db, envBag, {
      provider: body.provider as "resend" | "smtp",
      name: typeof body.name === "string" ? body.name : null,
      host: typeof body.host === "string" ? body.host : null,
      port: typeof body.port === "number" ? body.port : null,
      username: typeof body.username === "string" ? body.username : null,
      tlsMode: typeof body.tlsMode === "string" ? body.tlsMode : null,
      priority: typeof body.priority === "number" ? body.priority : undefined,
      plainSecret: String(body.plainSecret),
      actorEmail: actor(c).email,
    });
    if (!result.ok) {
      if (result.reason === "invalid_provider") return fail(c, "provider 须为 resend | smtp");
      return fail(c, "plainSecret 不能为空");
    }
    await writeAdminAudit(db, actor(c), {
      action: "email_config.create",
      targetType: "email_config",
      targetId: result.row.id,
      meta: { provider: result.row.provider, name: result.row.name },
    });
    return ok(c, { item: result.row });
  });

  /** 编辑配置（支持可选更新 secret）。 */
  r.patch("/email-config/:id", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const id = c.req.param("id");
    const body = await safeJsonBody<{
      enabled?: unknown; name?: unknown; host?: unknown;
      port?: unknown; username?: unknown; tlsMode?: unknown;
      priority?: unknown; plainSecret?: unknown;
    }>(c);
    const patchInput: UpdateEmailConfigInput = {};
    if (body?.enabled !== undefined && typeof body.enabled === "boolean") patchInput.enabled = body.enabled;
    if (body?.name !== undefined) patchInput.name = typeof body.name === "string" ? body.name : null;
    if (body?.host !== undefined) patchInput.host = typeof body.host === "string" ? body.host : null;
    if (body?.port !== undefined) patchInput.port = typeof body.port === "number" ? body.port : null;
    if (body?.username !== undefined) patchInput.username = typeof body.username === "string" ? body.username : null;
    if (body?.tlsMode !== undefined) {
      const v = typeof body.tlsMode === "string" ? body.tlsMode.trim() : "";
      if (v && v !== "ssl" && v !== "starttls" && v !== "none") return fail(c, "tlsMode 须为 ssl | starttls | none");
      patchInput.tlsMode = v || null;
    }
    if (body?.priority !== undefined) patchInput.priority = typeof body.priority === "number" ? body.priority : null;
    if (body?.plainSecret !== undefined) patchInput.plainSecret = typeof body.plainSecret === "string" ? body.plainSecret : null;
    if (Object.keys(patchInput).length === 0) return fail(c, "无有效字段");

    const envBag = (c.env ?? {}) as Record<string, string | undefined>;
    const result = await updateEmailConfig(db, envBag, id, patchInput);
    if (!result.ok) return fail(c, "记录不存在", 404);

    await writeAdminAudit(db, actor(c), {
      action: "email_config.update",
      targetType: "email_config",
      targetId: id,
      meta: { ...patchInput, plainSecret: patchInput.plainSecret ? "***" : undefined },
    });
    return ok(c, { item: result.row });
  });

  /** 发送测试邮件到指定地址 */
  r.post("/email-config/:id/test", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;
    const id = c.req.param("id");
    const body = await safeJsonBody<{ to?: unknown }>(c);
    const to = typeof body?.to === "string" && body.to.includes("@") ? body.to.trim() : null;
    if (!to) return fail(c, "收件邮箱必填");
    const envBag = (c.env ?? {}) as Record<string, string | undefined>;
    try {
      await sendTestEmail(db, envBag, id, to);
      return ok(c, { sent: true, to, id });
    } catch (e: unknown) {
      return fail(c, (e as Error).message || "发送失败", 502);
    }
  });

  r.delete("/email-config/:id", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const id = c.req.param("id");
    const result = await removeEmailConfig(db, id);
    if (!result.ok) return fail(c, "记录不存在", 404);

    await writeAdminAudit(db, actor(c), {
      action: "email_config.delete",
      targetType: "email_config",
      targetId: id,
    });
    return ok(c, { deleted: true });
  });

  /** 批量删除邮件配置：1–20 个 id，串行单条删除 + 逐条 audit。 */
  r.post("/email-config/batch-delete", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;
    const body = await safeJsonBody<{ ids?: unknown }>(c);
    const ids = parseIdList(body?.ids, 20);
    if (!ids) return fail(c, "ids 须为 1–20 个非空 id");

    const a = actor(c);
    let success = 0;
    let failed = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const id of ids) {
      const result = await removeEmailConfig(db, id);
      if (!result.ok) {
        failed++;
        errors.push({ id, message: "记录不存在" });
        continue;
      }
      success++;
      await writeAdminAudit(db, a, {
        action: "email_config.delete",
        targetType: "email_config",
        targetId: id,
        meta: { via: "batch" },
      });
    }

    await writeAdminAudit(db, a, {
      action: "email_config.delete",
      targetType: "email_config_batch",
      targetId: null,
      meta: {
        via: "batch",
        requested: ids.length,
        success,
        failed,
      },
    });

    return ok(c, { success, failed, errors });
  });

  // ── Email logs（cf-core email_log 标准表）──

  r.get("/email-logs", async (c) => {
    const status = (c.req.query("status") || "").trim();
    const search = (c.req.query("search") || "").trim();
    const limit = clampInteger(c.req.query("limit"), 20, 1, 100);
    const snapshotAt = c.req.query("snapshotAt") || undefined;
    const cursor = c.req.query("cursor") || undefined;
    if (status.length > 50 || search.length > 200) {
      return fail(c, "邮件日志筛选条件过长", 400);
    }
    if (!cursor && clampInteger(c.req.query("page"), 1, 1, 100_000) > 1) {
      return fail(c, "邮件日志分页已改用 cursor；请求下一页时必须提供上一页返回的 nextCursor", 400);
    }

    try {
      const result = await listEmailLogs(db, { status, search, limit, snapshotAt, cursor });
      return ok(c, result);
    } catch (error) {
      if (error instanceof Error && error.name === "InvalidLogCursorError") {
        return fail(c, error.message, 400);
      }
      throw error;
    }
  });

  r.post("/email-logs/batch-delete", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;
    const body = await safeJsonBody<{ ids?: unknown }>(c);
    const ids = parseIdList(body?.ids, 200);
    if (!ids) return fail(c, "ids 须为 1–200 个非空 id");
    const result = await db.delete(emailLog).where(inArray(emailLog.id, ids));
    const deleted = result.rowsAffected ?? 0;
    await writeAdminAudit(db, actor(c), {
      action: "email_log.batch_delete",
      targetType: "email_log",
      targetId: "",
      meta: { requested: ids.length, deleted },
    });
    return ok(c, { deleted });
  });

  // ── Social providers（运营开关；密钥仍在 env，本 API 永不回显 secret）──

  r.get("/social-providers", async (c) => {
    const envBag = (c.env ?? {}) as Record<string, string | undefined>;
    const providers = await listProviderStatus(db, envBag);
    return ok(c, {
      providers,
      note:
        "密钥仅存 Cloudflare / 环境变量；本页只管理启用、排序、展示名。登录页可用 = 密钥已配置 + 环境允许列表 + 本页启用。",
    });
  });

  r.patch("/social-providers/:id", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const providerId = c.req.param("id")?.trim() ?? "";
    if (!providerId || !isKnownProviderId(providerId)) {
      return fail(c, "未知社交登录源", 404);
    }

    const body = await safeJsonBody<{
      enabled?: unknown;
      displayLabel?: unknown;
      sortOrder?: unknown;
    }>(c);
    if (!body) return fail(c, "请求体须为 JSON");

    const patch: {
      enabled?: boolean;
      displayLabel?: string | null;
      sortOrder?: number;
    } = {};

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return fail(c, "enabled 须为 boolean");
      }
      patch.enabled = body.enabled;
    }
    if (body.displayLabel !== undefined) {
      if (body.displayLabel === null) {
        patch.displayLabel = null;
      } else if (typeof body.displayLabel === "string") {
        patch.displayLabel = body.displayLabel;
      } else {
        return fail(c, "displayLabel 须为 string 或 null");
      }
    }
    if (body.sortOrder !== undefined) {
      const n = Number(body.sortOrder);
      if (!Number.isFinite(n)) return fail(c, "sortOrder 须为数字");
      patch.sortOrder = n;
    }

    if (
      patch.enabled === undefined &&
      patch.displayLabel === undefined &&
      patch.sortOrder === undefined
    ) {
      return fail(c, "至少提供 enabled / displayLabel / sortOrder 之一");
    }

    const a = actor(c);
    const envBag = (c.env ?? {}) as Record<string, string | undefined>;
    const result = await patchProviderConfig(
      db,
      envBag,
      providerId,
      patch,
      a.email,
    );

    if (!result.ok) {
      if (result.reason === "credentials_required") {
        return fail(
          c,
          "无法启用：该渠道尚未配置 Client ID/Secret（请在 Cloudflare secrets / 环境变量中配置）",
          400,
        );
      }
      if (result.reason === "not_in_allowlist") {
        return fail(
          c,
          "无法启用：该渠道未列入 ENABLED_SOCIAL_PROVIDERS 环境允许列表",
          400,
        );
      }
      return fail(c, "未知社交登录渠道", 404);
    }

    await writeAdminAudit(db, a, {
      action: "social_provider.update",
      targetType: "social_provider",
      targetId: providerId,
      meta: {
        enabled: result.status.enabled,
        displayLabel: result.status.label,
        sortOrder: result.status.sortOrder,
        effective: result.status.effective,
        patch,
      },
    });

    return ok(c, { provider: result.status });
  });

  r.put("/social-providers/order", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const body = await safeJsonBody<{ orderedIds?: unknown }>(c);
    if (!body || !Array.isArray(body.orderedIds)) {
      return fail(c, "orderedIds 须为完整 provider id 数组");
    }
    const orderedIds = body.orderedIds.map((x) => String(x));

    const a = actor(c);
    const result = await reorderProviders(db, orderedIds, a.email);
    if (!result.ok) {
      return fail(c, "排序无效：须覆盖注册表全部 id 且无重复/未知项");
    }

    const envBag = (c.env ?? {}) as Record<string, string | undefined>;
    const providers = await listProviderStatus(db, envBag);

    await writeAdminAudit(db, a, {
      action: "social_provider.reorder",
      targetType: "social_provider",
      targetId: null,
      meta: { orderedIds },
    });

    return ok(c, { providers });
  });

  /**
   * 重置为默认：删除运营配置行（恢复 enabled=true、注册表顺序、默认展示名）。
   * 与"禁用"语义相反——要下线请用 PATCH enabled=false；env 密钥与 allowlist 仍生效。
   */
  r.delete("/social-providers/:id", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;

    const providerId = c.req.param("id")?.trim() ?? "";
    const envBag = (c.env ?? {}) as Record<string, string | undefined>;
    const result = await resetProviderConfig(db, envBag, providerId);
    if (!result.ok) {
      if (result.reason === "unknown_provider") {
        return fail(c, "未知社交登录源", 404);
      }
      return fail(c, "该渠道未配置运营策略（当前即默认状态），无需重置", 400);
    }

    await writeAdminAudit(db, actor(c), {
      action: "social_provider.reset",
      targetType: "social_provider",
      targetId: providerId,
      meta: { restored: true, effective: result.status.effective },
    });
    return ok(c, { provider: result.status });
  });

  // ── System config（key-value，Admin 页面管理）──

  r.get("/system-config", async (c) => {
    const rows = await db.select().from(systemConfig).orderBy(asc(systemConfig.key));
    return ok(c, { items: rows });
  });

  r.put("/system-config/:key", async (c) => {
    const limited = await enforceAdminWriteLimit(c, db);
    if (limited) return limited;
    const key = c.req.param("key");
    const body = await safeJsonBody<{ value?: unknown }>(c);
    if (!body || typeof body.value !== "string") return fail(c, "value 必填");
    const now = new Date();
    await db.insert(systemConfig).values({
      key, value: body.value, updatedAt: now, updatedBy: actor(c).email,
    }).onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: body.value, updatedAt: now, updatedBy: actor(c).email },
    });
    await writeAdminAudit(db, actor(c), { action: "system_config.update", targetType: "system_config", targetId: key, meta: { value: body.value } });
    return ok(c, { key, value: body.value });
  });

  // ── Audit ────────────────────────────────────────────────

  r.get("/audit", async (c) => {
    const limit = clampInteger(c.req.query("limit"), 50, 1, 200);
    const offset = clampInteger(c.req.query("offset"), 0, 0, 100_000);
    const actionFilter = (c.req.query("action") || "").trim();
    const targetIdFilter = (c.req.query("targetId") || "").trim();
    const targetTypeFilter = (c.req.query("targetType") || "").trim();

    const clauses = [];
    if (actionFilter) clauses.push(eq(adminAuditLog.action, actionFilter));
    if (targetIdFilter) clauses.push(eq(adminAuditLog.targetId, targetIdFilter));
    if (targetTypeFilter) {
      clauses.push(eq(adminAuditLog.targetType, targetTypeFilter));
    }
    const where = clauses.length > 0 ? and(...clauses) : undefined;

    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(where)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ n: count() })
      .from(adminAuditLog)
      .where(where);

    return ok(c, {
      logs: rows.map((row) => ({
        ...row,
        meta: row.meta
          ? (() => {
              try {
                return JSON.parse(row.meta);
              } catch {
                return row.meta;
              }
            })()
          : null,
      })),
      total: totalRow?.n ?? 0,
      limit,
      offset,
    });
  });

  return r;
}
