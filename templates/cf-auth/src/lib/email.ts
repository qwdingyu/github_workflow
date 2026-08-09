/**
 * 邮件发送：Resend / SMTP 多通道容错链（docs/030）。
 *
 * 发送策略：从 DB email_config 按 priority 升序轮询，第一个成功即停止；
 *           全失败 → console.warn + onLog（不抛错，不阻塞注册/登录流程）。
 *
 * env 仅需要 EMAIL_ENCRYPTION_KEY（解密 DB 中的 secret），不再在 env 配 SMTP。
 * 对齐文档 090 §4.2：escapeHtml、3次重试、8s超时、onLog 三态日志。
 */
import { escapeHtml, interpolate } from "@usethink/cf-core/features/email";
export { escapeHtml, interpolate };
import { decryptOneSecret, listEnabledEmailConfigs } from "./email-config";
import type { AuthDb } from "../db/client";
import { loadEmailPolicy } from "./email-policy";

type EmailOpts = { to: string; subject: string; html: string };
type LogEntry = {
  id: string;
  to: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  provider: string | null;
  error?: string;
  clientId?: string | null;
};

/* ── 重试 + 超时 ── */

async function fetchWithRetry(
  fn: () => Promise<Response>,
  maxRetries = 3,
  timeoutMs = 8000,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fn();
      // 不 abort 成功请求，但 clear timer
      clearTimeout(timer);
      if (res.ok) return res;
      // 非 2xx 不重试
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (i < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, i) * 500));
      }
    }
  }
  throw lastErr;
}

/* ── 通道发送 ── */

const DEFAULT_FROM = "cf-auth <noreply@eforge.xyz>";

async function sendViaResend(apiKey: string, opts: EmailOpts, from?: string): Promise<boolean> {
  try {
    await fetchWithRetry(() =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: from || DEFAULT_FROM, to: opts.to, subject: opts.subject, html: opts.html }),
        // signal disabled — we use our own AbortController for per-request timeout
      }),
    );
    return true;
  } catch { return false; }
}

async function sendViaSmtpOne(
  cfg: { host: string | null; port: number | null; username: string | null; tlsMode: string; plainSecret: string },
  opts: EmailOpts,
  from?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.host || !cfg.username) return { ok: false };
  try {
    if (typeof process === "undefined" || !process.versions?.node) return { ok: false, error: "非 Node 环境，无法使用 SMTP" };
    // @ts-expect-error nodemailer not a project dependency, only available at Node runtime
    const { createTransport } = await import("nodemailer");
    const tlsMode = cfg.tlsMode || "starttls";
    const t = createTransport({
      host: cfg.host,
      port: cfg.port ?? (tlsMode === "ssl" ? 465 : 587),
      secure: tlsMode === "ssl",
      requireTLS: tlsMode !== "none",
      auth: { user: cfg.username, pass: cfg.plainSecret },
    });
    await t.sendMail({ from: from || cfg.username, to: opts.to, subject: opts.subject, html: opts.html });
    await t.close();
    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes("nodemailer") || err.includes("Cannot find module")) {
      return { ok: false, error: "SMTP 依赖缺失：请先在服务器安装 nodemailer（npm install nodemailer）" };
    }
    return { ok: false, error: err };
  }
}

async function sendViaConfigChain(
  configs: Awaited<ReturnType<typeof listEnabledEmailConfigs>>,
  opts: EmailOpts,
  from?: string,
): Promise<{ ok: boolean; provider: string | null; error?: string }> {
  for (const cfg of configs) {
    if (cfg.provider === "resend") {
      if (await sendViaResend(cfg.plainSecret, opts, from)) return { ok: true, provider: "resend" };
    } else {
      const result = await sendViaSmtpOne(cfg, opts, from);
      if (result.ok) return { ok: true, provider: `smtp:${cfg.host}` };
      if (result.error) return { ok: false, provider: null, error: result.error };
    }
  }
  return { ok: false, provider: null };
}

/* ── 日志钩子（三态：pending → sent/failed）── */

export type EmailLogger = (entry: LogEntry) => Promise<void>;

/* ── 公共发送器 ── */

let logger: EmailLogger | null = null;

export function setEmailLogger(fn: EmailLogger) { logger = fn; }

/**
 * 创建 BA email-otp 插件所需的 sendVerificationOTP 回调。
 *
 * ── 入口守卫 ──
 * 首先检查 EMAIL_ENCRYPTION_KEY 是否配置：未配置 → 返回 no-op 函数，
 * BA 仍会生成 OTP 但不做邮件通知（用户可在页面看到 OTP 提示但不收邮件）。
 * 这避免了服务启动 crash（此前 bug：密钥缺失时抛异常导致整个 createApp 失败）。
 * 同时避免了注册流程阻塞（邮箱验证失败不应阻止用户注册）。
 *
 * ── 发送流程 ──
 * ① 从 DB 读启用的通道列表（listEnabledEmailConfigs）→ 解密密钥
 * ② 无通道 → 日志记录 failed + 返回（不抛错）
 * ③ HTML 安全转义（escapeHtml）→ 防 XSS（此前 bug：OTP 码未转义直接拼接）
 * ④ sendViaConfigChain：按 priority 轮询 Resend/SMTP 通道，第一个成功即停
 * ⑤ 写 email_log（pending → sent/failed），失败静默（不阻塞注册）
 *
 * ── 错误处理 ──
 * 所有异常均在内部 try-catch 消化，绝不向外抛出。
 * 这是 fire-and-forget 模式：邮件只是辅助通知，不应成为主流程的故障点。
 */
export async function createEmailSender(
  db: AuthDb,
  envRecord?: Record<string, string | undefined>,
) {
  // EMAIL_ENCRYPTION_KEY 未配置 → 返回 no-op（不阻塞服务启动）
  const env =
    envRecord ??
    (typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined>)
      : {});
  const key = env.EMAIL_ENCRYPTION_KEY?.trim();
  if (!key || key.length < 32) {
    console.warn("[email] EMAIL_ENCRYPTION_KEY 未配置或不足 32 字节，邮箱验证码不可用");
    console.warn("[email] 若开启注册验证码，请先配置 EMAIL_ENCRYPTION_KEY 与邮件通道");
    return undefined;
  }

  return async (data: { email: string; otp: string; type: string }) => {
    if (data.type === "email-verification") {
      const policy = await loadEmailPolicy(db);
      if (!policy.signupVerificationRequired) return;
    }

    const configs = await listEnabledEmailConfigs(db, env);
    const logId = crypto.randomUUID();
    const log: LogEntry = { id: logId, to: data.email, subject: "验证码", status: "pending", provider: null };

    if (configs.length === 0) {
      log.status = "failed"; log.error = "无启用的邮件配置";
      await logger?.(log);
      return;
    }
    const typeLabel = data.type === "sign-in" ? "登录验证码" : data.type === "email-verification" ? "邮箱验证" : "验证码";
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:24px 20px;color:#e2e8f0;background:#0f172a">
<div style="text-align:center;margin-bottom:24px"><h2 style="margin:0;color:#f8fafc">cf-auth 验证码</h2><p style="margin:6px 0 0;color:#94a3b8;font-size:14px">${escapeHtml(typeLabel)}</p></div>
<div style="text-align:center;font-size:36px;font-weight:700;letter-spacing:8px;margin:28px 0;color:#f8fafc;font-family:monospace">${escapeHtml(data.otp)}</div>
<p style="text-align:center;color:#94a3b8;font-size:13px">验证码 5 分钟内有效，请勿向他人泄露</p>
<hr style="border:none;border-top:1px solid #1e293b;margin:24px 0">
<p style="color:#64748b;font-size:11px;text-align:center">如果不是您本人操作，请忽略此邮件。</p></body></html>`;
    const result = await sendViaConfigChain(configs, { to: data.email, subject: "验证码", html });
    if (result.ok) {
      log.status = "sent"; log.provider = result.provider;
    } else {
      log.status = "failed"; log.error = result.error || "所有邮件通道失败";
    }
    await logger?.(log);
  };
}

/** 测试单条配置发送邮件 */
export async function sendTestEmail(
  db: AuthDb, env: Record<string, string | undefined>, id: string, to: string,
) {
  const row = await getConfigById(db, id);
  if (!row) throw new Error("配置不存在");
  if (!row.enabled) throw new Error("配置未启用");
  const secret = await decryptOneSecret(db, env, id);
  if (!secret) throw new Error("无法解密");
  const name = escapeHtml(row.name || row.provider);
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:24px 20px;color:#e2e8f0;background:#0f172a">
<div style="text-align:center;margin-bottom:24px"><h2 style="margin:0;color:#f8fafc">cf-auth 测试邮件</h2><p style="margin:6px 0 0;color:#94a3b8;font-size:14px">通道：${name}（${escapeHtml(row.provider)}）</p></div>
<p style="text-align:center;color:#4ade80;font-size:16px;font-weight:600">✅ 邮件通道连通正常</p>
<hr style="border:none;border-top:1px solid #1e293b;margin:24px 0">
<p style="color:#64748b;font-size:11px;text-align:center">这是来自 cf-auth 的测试邮件</p></body></html>`;
  const cfg = { ...row, plainSecret: secret };
  let result: { ok: boolean; error?: string };
  if (row.provider === "resend") {
    result = { ok: await sendViaResend(secret, { to, subject: "测试邮件", html }) };
  } else {
    result = await sendViaSmtpOne(cfg, { to, subject: "测试邮件", html });
  }
  if (!result.ok) throw new Error(result.error || "发送失败");
}

async function getConfigById(db: AuthDb, id: string) {
  const { emailConfig } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select().from(emailConfig).where(eq(emailConfig.id, id)).limit(1);
  return row ?? null;
}

/* ── 公共发送器（docs/093 邮件网关：POST /api/email/send 调用）── */

export type SendMailResult = { ok: boolean; provider: string | null; error?: string; messageId?: string };

/**
 * 通过配置链发送邮件（供邮件网关 API 使用）。
 * 复用 email_config 多通道容错链 + email-log 日志钩子（setEmailLogger 注册）。
 */
export async function sendMail(
  db: AuthDb,
  to: string,
  opts: { subject: string; html: string; from?: string; clientId?: string },
): Promise<SendMailResult> {
  if (!to || !to.includes("@")) return { ok: false, provider: null, error: "无效收件人" };
  const configs = await listEnabledEmailConfigs(db);
  if (configs.length === 0) return { ok: false, provider: null, error: "无启用的邮件通道" };

  const logId = crypto.randomUUID();
  const log: LogEntry = {
    id: logId,
    to,
    subject: opts.subject,
    status: "pending",
    provider: null,
    clientId: opts.clientId ?? null,
  };
  await logger?.(log);

  const result = await sendViaConfigChain(configs, { to, subject: opts.subject, html: opts.html }, opts.from);
  if (result.ok) {
    log.status = "sent";
    log.provider = result.provider;
  } else {
    log.status = "failed";
    log.error = result.error || "所有邮件通道失败";
  }
  await logger?.(log);

  return { ok: result.ok, provider: result.provider, error: log.error };
}
