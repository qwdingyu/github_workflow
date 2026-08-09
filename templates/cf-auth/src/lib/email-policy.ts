import { inArray } from "drizzle-orm";
import type { AuthDb } from "../db/client";
import { systemConfig } from "../db/schema";

export const EMAIL_POLICY_KEYS = {
  blockGmailPlusAlias: "email.block_gmail_plus_alias",
  blockPlusAlias: "email.block_plus_alias",
  domainRestrictionEnabled: "email.domain_restriction_enabled",
  domainWhitelist: "email.domain_whitelist",
  signupVerificationRequired: "email.signup_verification_required",
} as const;

const DEFAULT_POLICY = {
  blockGmailPlusAlias: true,
  blockPlusAlias: true,
  domainRestrictionEnabled: false,
  domainWhitelist: ["qq.com", "gmail.com"],
  signupVerificationRequired: false,
} as const;

export type EmailPolicy = {
  blockGmailPlusAlias: boolean;
  blockPlusAlias: boolean;
  domainRestrictionEnabled: boolean;
  domainWhitelist: string[];
  signupVerificationRequired: boolean;
};

export type EmailPolicyViolation = {
  code: "EMAIL_PLUS_ALIAS_BLOCKED" | "EMAIL_DOMAIN_NOT_ALLOWED";
  message: string;
};

function parseFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

function parseDomainList(raw: string | undefined): string[] {
  return (raw || "")
    .split(/[\n,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export async function loadEmailPolicy(db: AuthDb): Promise<EmailPolicy> {
  const keys = Object.values(EMAIL_POLICY_KEYS);
  const rows = await db
    .select({ key: systemConfig.key, value: systemConfig.value })
    .from(systemConfig)
    .where(inArray(systemConfig.key, keys));
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return {
    blockGmailPlusAlias: parseFlag(
      values.get(EMAIL_POLICY_KEYS.blockGmailPlusAlias),
      DEFAULT_POLICY.blockGmailPlusAlias,
    ),
    blockPlusAlias: parseFlag(
      values.get(EMAIL_POLICY_KEYS.blockPlusAlias),
      DEFAULT_POLICY.blockPlusAlias,
    ),
    domainRestrictionEnabled: parseFlag(
      values.get(EMAIL_POLICY_KEYS.domainRestrictionEnabled),
      DEFAULT_POLICY.domainRestrictionEnabled,
    ),
    domainWhitelist:
      parseDomainList(values.get(EMAIL_POLICY_KEYS.domainWhitelist)).length > 0
        ? parseDomainList(values.get(EMAIL_POLICY_KEYS.domainWhitelist))
        : [...DEFAULT_POLICY.domainWhitelist],
    signupVerificationRequired: parseFlag(
      values.get(EMAIL_POLICY_KEYS.signupVerificationRequired),
      DEFAULT_POLICY.signupVerificationRequired,
    ),
  };
}

export function findEmailPolicyViolation(
  policy: EmailPolicy,
  rawEmail: string,
): EmailPolicyViolation | null {
  const email = rawEmail.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at >= email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.includes("+")) {
    if (policy.blockPlusAlias) {
      return {
        code: "EMAIL_PLUS_ALIAS_BLOCKED",
        message: "邮箱+别名（user+tag@domain）不允许注册，请使用主邮箱地址",
      };
    }
    if (policy.blockGmailPlusAlias && domain === "gmail.com") {
      return {
        code: "EMAIL_PLUS_ALIAS_BLOCKED",
        message: "Gmail + 别名（user+tag@gmail.com）不允许注册，请使用主邮箱地址",
      };
    }
  }

  if (
    policy.domainRestrictionEnabled &&
    domain &&
    !policy.domainWhitelist.includes(domain)
  ) {
    return {
      code: "EMAIL_DOMAIN_NOT_ALLOWED",
      message: `邮箱域名 ${domain} 不在白名单中`,
    };
  }

  return null;
}
