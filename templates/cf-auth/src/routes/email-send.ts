import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import type { AppResources } from "../app";
import { oauthClient } from "../db/schema";
import { eq } from "drizzle-orm";
import { hashClientSecret } from "../lib/client-secret";
import { sendMail } from "../lib/email";
import { checkDbRateLimit } from "../lib/rate-limit";

const RATE_LIMIT_EMAIL_SEND = { windowMs: 60_000, max: 30 };
const MAX_BASIC_AUTH_CHARS = 4096;
const MAX_CLIENT_ID_CHARS = 256;
const MAX_CLIENT_SECRET_CHARS = 2048;

/**
 * 邮件网关 API（docs/093）：POST /api/email/send
 *
 * 消费方（cf-shop/cf-lottery/未来项目）通过 OAuth client 认证调用，
 * 由 cf-auth 集中发送邮件（复用 email_config 多通道链 + email-log 日志）。
 *
 * 认证：Basic client_id:client_secret（复用现有 OAuth client）
 * 授权：client.email_enabled === true（admin/clients 页面配置）
 * 发件人：client.metadata.sender_email / sender_name
 */
export function createEmailSendRoute(resources: AppResources) {
  const { db } = resources;
  const route = new Hono<AppEnv>();

  route.post("/send", async (c) => {
    const authFailed = () => c.json({ ok: false, error: "认证失败" }, 401);

    // ── 1. Basic auth 解析 client_id:client_secret ──
    const authHeader = c.req.header("Authorization") || "";
    const basicMatch = /^Basic\s+(.+)$/i.exec(authHeader);
    if (!basicMatch) {
      return authFailed();
    }
    const encodedCredentials = basicMatch[1];
    if (encodedCredentials.length > MAX_BASIC_AUTH_CHARS) {
      return authFailed();
    }
    let decoded: string;
    try {
      decoded = atob(encodedCredentials);
    } catch {
      return authFailed();
    }
    if (decoded.length > MAX_BASIC_AUTH_CHARS) {
      return authFailed();
    }
    const colon = decoded.indexOf(":");
    if (colon <= 0) {
      return authFailed();
    }
    const clientId = decoded.slice(0, colon);
    const clientSecret = decoded.slice(colon + 1);
    if (
      !clientId ||
      !clientSecret ||
      clientId.length > MAX_CLIENT_ID_CHARS ||
      clientSecret.length > MAX_CLIENT_SECRET_CHARS
    ) {
      return authFailed();
    }

    // ── 2. 先限流再查 client，避免用同一 clientId 反复探测认证分支 ──
    const allowed = await checkDbRateLimit(
      db,
      `email:${clientId}`,
      RATE_LIMIT_EMAIL_SEND.max,
      RATE_LIMIT_EMAIL_SEND.windowMs,
    );
    if (!allowed) {
      return c.json({ ok: false, error: "请求过于频繁，请稍后重试" }, 429);
    }

    // ── 3. 查 client + 校验 secret + disabled + email_enabled ──
    const [client] = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1);
    if (!client || client.disabled) {
      return authFailed();
    }
    const secretHash = await hashClientSecret(clientSecret);
    if (!client.clientSecret || client.clientSecret !== secretHash) {
      return authFailed();
    }
    if (!client.emailEnabled) {
      return c.json({ ok: false, error: "邮件发送未启用" }, 403);
    }

    // ── 4. 解析请求体 ──
    const body = await c.req.json().catch(() => null) as {
      to?: string;
      subject?: string;
      html?: string;
    } | null;
    if (!body || typeof body.to !== "string" || typeof body.subject !== "string" || typeof body.html !== "string") {
      return c.json({ ok: false, error: "请求体需包含 to / subject / html（字符串）" }, 400);
    }
    const to = body.to.trim();
    const subject = body.subject.trim();
    const html = body.html;
    if (!to || !to.includes("@")) {
      return c.json({ ok: false, error: "无效收件人" }, 400);
    }
    if (!subject) {
      return c.json({ ok: false, error: "主题不能为空" }, 400);
    }

    // ── 4. 发件人（client.metadata.sender_email / sender_name）──
    let from: string | undefined;
    try {
      const meta = client.metadata ? JSON.parse(client.metadata) as Record<string, unknown> : {};
      const senderEmail = typeof meta.sender_email === "string" ? meta.sender_email : undefined;
      const senderName = typeof meta.sender_name === "string" ? meta.sender_name : undefined;
      if (senderEmail) {
        from = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
      }
    } catch {
      // metadata 非法时忽略，用通道默认 from
    }

    // ── 5. 发送（email_config 多通道链 + email-log 日志）──
    const result = await sendMail(db, to, { subject, html, from, clientId });
    if (!result.ok) {
      return c.json({ ok: false, error: result.error || "发送失败" }, 502);
    }
    return c.json({ ok: true, provider: result.provider });
  });

  return route;
}
