/**
 * OAuth client 对外 DTO：永远剥离 client_secret。
 * 列表/详情只暴露运维需要字段。
 */
import type { InferSelectModel } from "drizzle-orm";
import type { oauthClient } from "../db/schema";

export type OauthClientRow = InferSelectModel<typeof oauthClient>;

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    // 插件有时存空格分隔或已是 JSON 字符串数组
    if (raw.startsWith("[")) return [];
    return raw.split(/[\s,]+/).filter(Boolean);
  }
}

/** 脱敏后的管理端 client 视图 */
export function toAdminClientDto(row: OauthClientRow) {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    uri: row.uri,
    disabled: Boolean(row.disabled),
    skipConsent: Boolean(row.skipConsent),
    requirePKCE: row.requirePKCE == null ? true : Boolean(row.requirePKCE),
    redirectUris: parseJsonArray(row.redirectUris),
    grantTypes: parseJsonArray(row.grantTypes),
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    public: Boolean(row.public),
    type: row.type,
    userId: row.userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    /** 仅提示是否已配置 secret，不回传明文或哈希 */
    hasSecret: Boolean(row.clientSecret),
    /** docs/093 邮件网关：client 邮件发送开关 + 发件人配置 */
    emailEnabled: Boolean(row.emailEnabled),
    senderEmail: parseMetadataString(row.metadata, "sender_email"),
    senderName: parseMetadataString(row.metadata, "sender_name"),
  };
}

function parseMetadataString(raw: string | null | undefined, key: string): string | null {
  if (!raw) return null;
  try {
    const meta = JSON.parse(raw) as Record<string, unknown>;
    return typeof meta[key] === "string" ? (meta[key] as string) : null;
  } catch {
    return null;
  }
}
