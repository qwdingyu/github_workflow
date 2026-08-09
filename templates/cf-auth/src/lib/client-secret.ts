/**
 * OAuth client_secret 哈希：与 @better-auth/oauth-provider 默认 hashed 存储一致。
 * 官方 defaultHasher：SHA-256 → base64url（无 padding），长度 43。
 * 轮换 secret 时必须同一算法，否则 token 端校验失败。
 */
import { createHash } from "@better-auth/utils/hash";

/** 生成 32 字符明文 secret（与插件 generateRandomString 量级一致） */
export function generatePlainClientSecret(): string {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += alphabet[bytes[i]! % alphabet.length]!;
  }
  return out;
}

/** ArrayBuffer → base64url 无 padding（与 BA defaultHasher 实测一致） */
function toBase64UrlNoPad(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]!);
  }
  // btoa 在 Workers/Node 均可用（Node 18+ global）
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 存库用哈希（永不回传给列表 API） */
export async function hashClientSecret(plain: string): Promise<string> {
  const digest = await createHash("SHA-256").digest(
    new TextEncoder().encode(plain),
  );
  return toBase64UrlNoPad(digest as ArrayBuffer);
}
