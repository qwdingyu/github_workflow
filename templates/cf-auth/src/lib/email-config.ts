/**
 * 邮件配置 DB 化管理（docs/030）：AES-256-GCM 加密 + CRUD。
 *
 * ── 加密策略 ──
 * encrypted_secret 列存 AES-256-GCM 密文（base64 编码），
 * 密钥来自 env EMAIL_ENCRYPTION_KEY（≥32 字节，hex 或 utf8）。
 * 列表/详情永不回传明文（脱敏展示 "****"），仅创建时一次性接收明文；
 * 发送时从 DB 解密用于实际调用。
 *
 * ── 双平台兼容 ──
 * Node（VPS）：动态 import("node:crypto") → createCipheriv/createDecipheriv。
 * Workers（CF）：Web Crypto API → crypto.subtle.encrypt/decrypt。
 * 密文格式两平台完全一致：base64(iv(12) + ciphertext + authTag(16))，
 * 确保 Node 加密的数据 Workers 可解密，反之亦然。
 *
 * ── 为什么 async ──
 * Web Crypto API 的全部操作是异步的（crypto.subtle.* 返回 Promise），
 * Node 路径为了签名一致也必须改为 async（await import("node:crypto")）。
 * 顶层 import crypto from "node:crypto" 会导致 Workers 模块加载崩溃（见 bug 修复记录），
 * 因此改用动态 import 延迟到首次调用加密/解密时加载。
 *
 * ── 密钥格式 ──
 * EMAIL_ENCRYPTION_KEY：
 *   - 64 字符 hex（如 a1b2…32 字节）→ 直接 hex→bytes
 *   - 其他长度 → utf8→bytes（需 ≥32 字节）
 * 为什么不用 env 明文：密钥与密文分存——env 是"锁"、DB 是"保险箱"，
 * 即使 DB 泄露也无法解密。env 值通过 Cloudflare secrets / VPS .env 保护。
 */
import { asc, eq } from "drizzle-orm";
import { emailConfig } from "../db/schema";
import type { AuthDb } from "../db/client";

/** 加密密钥的环境变量名 */
const ENC_KEY_ENV = "EMAIL_ENCRYPTION_KEY";
/** AES-256-GCM 算法标识（Web Crypto 用大写，Node 用小写） */
const ALGO = "AES-256-GCM";
/** GCM 推荐 IV 长度：12 字节（96 位），NIST SP 800-38D 推荐值 */
const IV_LEN = 12;
/** GCM 认证标签长度：16 字节（128 位），提供完整 128 位完整性保护 */
const TAG_LEN = 16;

/** 加密密钥的字节表示（Uint8Array 而非 Buffer，跨平台兼容） */
type EncKey = Uint8Array;

/**
 * 从 env 读取加密密钥。
 *
 * 分支逻辑：
 * ① 未配置 → throw（调用方应在 try-catch 中处理，避免服务启动 crash）
 * ② 64 字符 hex → 每 2 字符解析为 1 字节（32 字节 = 256 位密钥）
 * ③ 其他长度 → utf8 encode 为字节（≥32 字节才合法）
 * ④ 最终校验：字节长度 < 32 → throw（AES-256 要求 256 位密钥）
 */
function loadEncKey(env: Record<string, string | undefined>): EncKey {
  const raw = (env[ENC_KEY_ENV] ?? "").trim();
  if (!raw) throw new Error(`${ENC_KEY_ENV} 未配置`);
  let bytes: Uint8Array;
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    // 分支 ②：hex 编码（如 openssl rand -hex 32 输出）
    bytes = new Uint8Array(raw.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(raw.substr(i * 2, 2), 16);
  } else {
    // 分支 ③：utf8 编码（如随机字符串）
    bytes = new TextEncoder().encode(raw);
  }
  // 分支 ④：长度校验
  if (bytes.length < 32) throw new Error(`${ENC_KEY_ENV} 须 ≥32 字节`);
  return bytes;
}

/**
 * 探测 Node 运行环境。
 *
 * 设计意图：不能用顶层 import crypto from "node:crypto"——Workers 加载时
 * 会直接抛 Error（模块未找到），导致整个 email-config.ts 不可用。
 * 改用动态 import()，Node 环境成功加载，Workers 环境 catch 返回 null。
 * 后续加密/解密根据返回值选择 Node crypto 或 Web Crypto 路径。
 */
async function getNodeCrypto(): Promise<any> {
  try { return await import("node:crypto"); } catch { return null; }
}

/** 分配 key：Web Crypto 或 Node */
async function importKey(raw: EncKey): Promise<CryptoKey | any> {
  const nc = await getNodeCrypto();
  if (nc) return nc; // Node 返回 crypto 对象，后续用 createCipheriv/createDecipheriv
  return crypto.subtle.importKey("raw", raw, { name: ALGO }, false, ["encrypt", "decrypt"]);
}

/**
 * AES-256-GCM 加密。
 *
 * ── 密文格式（base64）──
 * 输出 base64(iv(12) + ciphertext + authTag(16))。
 * 与 Node crypto 原版兼容——旧 DB 数据用此格式加密，本函数改用 async 后产物一致。
 * 加密后的密文写入 DB email_config.encrypted_secret 列。
 *
 * ── 双路径 ──
 * Node：用 crypto 模块（createCipheriv + getAuthTag），Buffer 拼接后 base64。
 * Workers：用 crypto.subtle.encrypt，ciphertext 已包含 authTag（AES-GCM 内置），
 *   手动拼接 iv + ciphertext 后 base64 编码。
 *
 * ── 安全 ──
 * IV 每次随机生成（12 字节），同一明文不同次加密产生不同密文（防彩虹表攻击）。
 * AES-GCM 是认证加密模式，篡改密文解密时会抛异常（完整性保护）。
 */
export async function encryptSecret(key: EncKey, plaintext: string): Promise<string> {
  const nc = await getNodeCrypto();
  if (nc) {
    // Node 路径：crypto 模块同步 API
    const iv = nc.randomBytes(IV_LEN);
    const cipher = nc.createCipheriv(ALGO.toLowerCase(), Buffer.from(key), iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, enc, tag]).toString("base64");
  }
  // Workers 路径：Web Crypto API（async）
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ck = await importKey(key) as CryptoKey;
  const buf = await crypto.subtle.encrypt({ name: ALGO, iv }, ck, new TextEncoder().encode(plaintext));
  // Web Crypto 的 ciphertext = encrypted + authTag（最后 16 字节自动附加）
  const result = new Uint8Array(IV_LEN + buf.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(buf), IV_LEN);
  return btoa(String.fromCharCode(...result));
}

/**
 * AES-256-GCM 解密。
 *
 * ── 输入格式 ──
 * base64(iv(12) + ciphertext(authTag 已嵌入末尾 16 字节))。
 * Node 路径：需手动切割 authTag——ciphertext 最后 16 字节为 tag，
 *   前面为实际加密数据，用 decipher.setAuthTag 设置 tag 后解密。
 * Workers 路径：ciphertext 直接传给 crypto.subtle.decrypt，
 *   Web Crypto 自动识别并校验末尾 16 字节 authTag。
 *
 * ── 错误处理 ──
 * 解密失败（密钥不匹配、密文损坏、authTag 校验失败）→ 抛出异常。
 * 调用方（listEnabledEmailConfigs / decryptOneSecret）应 catch 处理。
 */
export async function decryptSecret(key: EncKey, encoded: string): Promise<string> {
  const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, IV_LEN);
  const ct = raw.slice(IV_LEN); // ciphertext + authTag
  const nc = await getNodeCrypto();
  if (nc) {
    // Node 路径：手动分离 authTag（Node 的 createDecipheriv 不自动处理 GCM tag）
    const decipher = nc.createDecipheriv(ALGO.toLowerCase(), Buffer.from(key), Buffer.from(iv));
    decipher.setAuthTag(Buffer.from(ct.slice(ct.length - TAG_LEN))); // 末尾 16 字节 = tag
    const dec = Buffer.concat([decipher.update(Buffer.from(ct.slice(0, ct.length - TAG_LEN))), decipher.final()]);
    return dec.toString("utf8");
  }
  // Workers 路径：ciphertext 已含 authTag，Web Crypto 自动校验
  const ck = await importKey(key) as CryptoKey;
  const dec = await crypto.subtle.decrypt({ name: ALGO, iv }, ck, ct);
  return new TextDecoder().decode(dec);
}

export type EmailConfigRow = {
  id: string;
  provider: "resend" | "smtp";
  name: string | null;
  priority: number;
  enabled: boolean;
  host: string | null;
  port: number | null;
  username: string | null;
  /** SMTP TLS 策略：ssl | starttls | none（仅 provider=smtp 有效） */
  tlsMode: string;
  /** 列表/详情时脱敏为 "****"；仅在发送时解密 */
  secretHint: string;
  createdByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRow(
  r: typeof emailConfig.$inferSelect,
): EmailConfigRow {
  return {
    id: r.id,
    provider: r.provider as EmailConfigRow["provider"],
    name: r.name,
    priority: r.priority,
    enabled: Boolean(r.enabled),
    host: r.host,
    port: r.port,
    username: r.username,
    tlsMode: r.tlsMode,
    secretHint: "****",
    createdByEmail: r.createdByEmail,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Admin 列表（含停用行） */
export async function listEmailConfigs(
  db: AuthDb,
): Promise<EmailConfigRow[]> {
  const rows = await db
    .select()
    .from(emailConfig)
    .orderBy(asc(emailConfig.priority));
  return rows.map(toRow);
}

/** 发送时用：仅启用的配置，按 priority 升序 */
export async function listEnabledEmailConfigs(
  db: AuthDb,
  envRecord?: Record<string, string | undefined>,
): Promise<Array<Omit<EmailConfigRow, "secretHint"> & { plainSecret: string }>> {
  // Workers 传入 c.env；Node 回退 process.env
  const env = envRecord ?? (typeof process !== "undefined" ? (process.env as Record<string, string | undefined>) : {});
  const key = loadEncKey(env);
  const rows = await db.select().from(emailConfig).where(eq(emailConfig.enabled, true)).orderBy(asc(emailConfig.priority));
  const result: Array<Omit<EmailConfigRow, "secretHint"> & { plainSecret: string }> = [];
  for (const r of rows) {
    result.push({
      id: r.id,
      provider: r.provider as EmailConfigRow["provider"],
      name: r.name,
      priority: r.priority,
      enabled: true,
      host: r.host,
      port: r.port,
      username: r.username,
      tlsMode: r.tlsMode,
      plainSecret: await decryptSecret(key, r.encryptedSecret),
      createdByEmail: r.createdByEmail,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }
  return result;
}

export async function hasEnabledEmailConfigs(db: AuthDb): Promise<boolean> {
  const [row] = await db
    .select({ id: emailConfig.id })
    .from(emailConfig)
    .where(eq(emailConfig.enabled, true))
    .limit(1);
  return Boolean(row);
}

export type AddEmailConfigInput = {
  provider: "resend" | "smtp";
  name?: string | null;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  tlsMode?: string | null;
  priority?: number;
  plainSecret: string;
  actorEmail: string | null;
};

export type AddEmailConfigResult =
  | { ok: true; row: EmailConfigRow }
  | { ok: false; reason: "invalid_provider" | "missing_secret" };

export async function addEmailConfig(
  db: AuthDb,
  env: Record<string, string | undefined>,
  input: AddEmailConfigInput,
): Promise<AddEmailConfigResult> {
  if (input.provider !== "resend" && input.provider !== "smtp") {
    return { ok: false, reason: "invalid_provider" };
  }
  if (!input.plainSecret.trim()) {
    return { ok: false, reason: "missing_secret" };
  }
  const key = loadEncKey(env);
  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(emailConfig).values({
    id,
    provider: input.provider,
    name: input.name?.trim() || null,
    priority: input.priority ?? 100,
    enabled: true,
    host: input.host?.trim() || null,
    port: input.port ?? null,
    username: input.username?.trim() || null,
    tlsMode: input.tlsMode?.trim() || "starttls",
    encryptedSecret: await encryptSecret(key, input.plainSecret),
    createdByEmail: input.actorEmail,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db
    .select()
    .from(emailConfig)
    .where(eq(emailConfig.id, id))
    .limit(1);
  return { ok: true, row: toRow(row!) };
}

export type SetEmailConfigEnabledResult =
  | { ok: true; row: EmailConfigRow }
  | { ok: false; reason: "not_found" };

export async function setEmailConfigEnabled(
  db: AuthDb,
  id: string,
  enabled: boolean,
): Promise<SetEmailConfigEnabledResult> {
  const [existing] = await db
    .select()
    .from(emailConfig)
    .where(eq(emailConfig.id, id))
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };
  await db
    .update(emailConfig)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(emailConfig.id, id));
  const [row] = await db
    .select()
    .from(emailConfig)
    .where(eq(emailConfig.id, id))
    .limit(1);
  return { ok: true, row: toRow(row!) };
}

export type RemoveEmailConfigResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

export async function removeEmailConfig(
  db: AuthDb,
  id: string,
): Promise<RemoveEmailConfigResult> {
  const [existing] = await db
    .select()
    .from(emailConfig)
    .where(eq(emailConfig.id, id))
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };
  await db.delete(emailConfig).where(eq(emailConfig.id, id));
  return { ok: true };
}

export type UpdateEmailConfigInput = {
  name?: string | null;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  tlsMode?: string | null;
  priority?: number | null;
  enabled?: boolean | null;
  plainSecret?: string | null;
};

export type UpdateEmailConfigResult =
  | { ok: true; row: EmailConfigRow }
  | { ok: false; reason: "not_found" };

/** 编辑配置（含可选的 secret 更新）。 */
export async function updateEmailConfig(
  db: AuthDb,
  env: Record<string, string | undefined>,
  id: string,
  input: UpdateEmailConfigInput,
): Promise<UpdateEmailConfigResult> {
  const [existing] = await db
    .select()
    .from(emailConfig)
    .where(eq(emailConfig.id, id))
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name?.trim() || null;
  if (input.host !== undefined) patch.host = input.host?.trim() || null;
  if (input.port !== undefined) patch.port = input.port ?? null;
  if (input.username !== undefined) patch.username = input.username?.trim() || null;
  if (input.tlsMode !== undefined) {
    const v = input.tlsMode?.trim();
    if (v && v !== "ssl" && v !== "starttls" && v !== "none") return { ok: false, reason: "not_found" }; // 用 not_found 占位，admin 路由拦截
    patch.tlsMode = v || undefined;
  }
  if (input.priority !== undefined) patch.priority = input.priority ?? 100;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.plainSecret !== undefined && typeof input.plainSecret === "string" && input.plainSecret.trim()) {
    const key = loadEncKey(env);
    patch.encryptedSecret = await encryptSecret(key, input.plainSecret.trim());
  }
  await db.update(emailConfig).set(patch).where(eq(emailConfig.id, id));
  const [row] = await db.select().from(emailConfig).where(eq(emailConfig.id, id)).limit(1);
  return { ok: true, row: toRow(row!) };
}

/** 解密单条配置的 secret（测试邮件用） */
export async function decryptOneSecret(
  db: AuthDb,
  env: Record<string, string | undefined>,
  id: string,
): Promise<string | null> {
  const [row] = await db.select().from(emailConfig).where(eq(emailConfig.id, id)).limit(1);
  if (!row) return null;
  const key = loadEncKey(env);
  return await decryptSecret(key, row.encryptedSecret);
}
