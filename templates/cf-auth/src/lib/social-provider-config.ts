/**
 * 上游社交登录运营策略（docs/026 Phase A）。
 *
 * 有效集合 = 代码注册表 ∩ env 密钥成对 ∩ env allowlist ∩ DB.enabled
 * 密钥永不入库、永不经 Admin API 回显。
 */
import { asc, eq } from "drizzle-orm";
import { socialProviderConfig } from "../db/schema";
import type { AuthDb } from "../db/client";
import {
  SOCIAL_PROVIDER_REGISTRY,
  callbackPathFor,
  parseSocialAllowlist,
  type SocialProviderId,
} from "./social-providers";

export type SocialProviderStatus = {
  id: SocialProviderId;
  /** 登录页展示名（DB 覆盖或注册表默认） */
  label: string;
  /** 注册表图标（emoji） */
  icon: string;
  /** 注册表默认名 */
  defaultLabel: string;
  sortOrder: number;
  /** Admin 运营开关（无 DB 行时默认 true） */
  enabled: boolean;
  /** env 成对密钥是否齐全 */
  credentialsConfigured: boolean;
  /** env ENABLED_SOCIAL_PROVIDERS 是否放行（空名单=全放行） */
  inEnvAllowlist: boolean;
  /** 登录页/协议最终是否可用 */
  effective: boolean;
  /** 是否存在 DB 运营配置行（false=默认状态：启用、注册表顺序、默认名） */
  configured: boolean;
  callbackPath: string;
  notes?: string;
};

export type EffectiveSocialMeta = {
  id: SocialProviderId;
  label: string;
  icon: string;
};

function registryIds(): Set<string> {
  return new Set(SOCIAL_PROVIDER_REGISTRY.map((d) => d.id));
}

export function isKnownProviderId(id: string): id is SocialProviderId {
  return registryIds().has(id);
}

function hasCredentials(
  def: (typeof SOCIAL_PROVIDER_REGISTRY)[number],
  env: Record<string, string | undefined>,
): boolean {
  const id = env[def.clientIdEnv]?.trim();
  const secret = env[def.clientSecretEnv]?.trim();
  return Boolean(id && secret);
}

function allowlistSet(
  env: Record<string, string | undefined>,
): Set<string> | null {
  const raw = env.ENABLED_SOCIAL_PROVIDERS;
  const list = parseSocialAllowlist(raw);
  if (!list) return null;
  return new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean));
}

type DbRow = {
  providerId: string;
  enabled: boolean;
  sortOrder: number;
  displayLabel: string | null;
};

async function loadDbRows(db: AuthDb): Promise<Map<string, DbRow>> {
  const rows = await db
    .select()
    .from(socialProviderConfig)
    .orderBy(asc(socialProviderConfig.sortOrder));
  const map = new Map<string, DbRow>();
  for (const r of rows) {
    map.set(r.providerId, {
      providerId: r.providerId,
      enabled: Boolean(r.enabled),
      sortOrder: r.sortOrder,
      displayLabel: r.displayLabel,
    });
  }
  return map;
}

/**
 * 合并注册表 + env 能力 + DB 策略。
 * 无 DB 行：enabled 默认 true、sort 用注册表下标（兼容「仅 env」时代）。
 */
export async function listProviderStatus(
  db: AuthDb,
  env: Record<string, string | undefined>,
): Promise<SocialProviderStatus[]> {
  const dbMap = await loadDbRows(db);
  const allow = allowlistSet(env);

  const items: SocialProviderStatus[] = SOCIAL_PROVIDER_REGISTRY.map(
    (def, index) => {
      const row = dbMap.get(def.id);
      const credentialsConfigured = hasCredentials(def, env);
      const inEnvAllowlist = !allow || allow.has(def.id);
      const enabled = row ? row.enabled : true;
      const sortOrder = row ? row.sortOrder : index;
      const label =
        row?.displayLabel?.trim() || def.label;
      const effective =
        credentialsConfigured && inEnvAllowlist && enabled;
      return {
        id: def.id,
        label,
        icon: def.icon,
        defaultLabel: def.label,
        sortOrder,
        enabled,
        credentialsConfigured,
        inEnvAllowlist,
        effective,
        configured: row !== undefined,
        callbackPath: callbackPathFor(def.id),
        notes: def.notes,
      };
    },
  );

  items.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return items;
}

/** 登录页 / meta：仅 effective，按 sort */
export async function getEffectiveSocialMeta(
  db: AuthDb,
  env: Record<string, string | undefined>,
): Promise<EffectiveSocialMeta[]> {
  const all = await listProviderStatus(db, env);
  return all
    .filter((p) => p.effective)
    .map((p) => ({ id: p.id, label: p.label, icon: p.icon }));
}

export async function isProviderEffective(
  db: AuthDb,
  env: Record<string, string | undefined>,
  providerId: string,
): Promise<boolean> {
  if (!isKnownProviderId(providerId)) return false;
  const all = await listProviderStatus(db, env);
  return all.some((p) => p.id === providerId && p.effective);
}

export type PatchProviderInput = {
  enabled?: boolean;
  displayLabel?: string | null;
  sortOrder?: number;
};

export type PatchProviderResult =
  | { ok: true; status: SocialProviderStatus }
  | {
      ok: false;
      reason:
        | "unknown_provider"
        | "credentials_required"
        | "not_in_allowlist";
    };

/**
 * 更新单源运营策略。启用时必须已配置密钥且过 env allowlist。
 */
export async function patchProviderConfig(
  db: AuthDb,
  env: Record<string, string | undefined>,
  providerId: string,
  patch: PatchProviderInput,
  actorEmail: string | null,
): Promise<PatchProviderResult> {
  if (!isKnownProviderId(providerId)) {
    return { ok: false, reason: "unknown_provider" };
  }

  const current = (await listProviderStatus(db, env)).find(
    (p) => p.id === providerId,
  )!;
  const existing = (await loadDbRows(db)).get(providerId);

  const nextEnabled =
    patch.enabled !== undefined ? patch.enabled : current.enabled;
  if (nextEnabled) {
    if (!current.credentialsConfigured) {
      return { ok: false, reason: "credentials_required" };
    }
    if (!current.inEnvAllowlist) {
      return { ok: false, reason: "not_in_allowlist" };
    }
  }

  let nextLabel: string | null = existing?.displayLabel ?? null;
  if (patch.displayLabel !== undefined) {
    nextLabel =
      patch.displayLabel === null || String(patch.displayLabel).trim() === ""
        ? null
        : String(patch.displayLabel).trim().slice(0, 64);
  }

  const nextSort =
    patch.sortOrder !== undefined
      ? Math.max(0, Math.min(9999, Math.floor(Number(patch.sortOrder))))
      : current.sortOrder;

  const now = new Date();
  if (existing) {
    await db
      .update(socialProviderConfig)
      .set({
        enabled: nextEnabled,
        sortOrder: nextSort,
        displayLabel: nextLabel,
        updatedAt: now,
        updatedByEmail: actorEmail,
      })
      .where(eq(socialProviderConfig.providerId, providerId));
  } else {
    await db.insert(socialProviderConfig).values({
      providerId,
      enabled: nextEnabled,
      sortOrder: nextSort,
      displayLabel: nextLabel,
      updatedAt: now,
      updatedByEmail: actorEmail,
    });
  }

  const status = (await listProviderStatus(db, env)).find(
    (p) => p.id === providerId,
  )!;
  return { ok: true, status };
}

/**
 * 按 orderedIds 全量重排（须覆盖注册表全部 id，去重）。
 */
export async function reorderProviders(
  db: AuthDb,
  orderedIds: string[],
  actorEmail: string | null,
): Promise<{ ok: true } | { ok: false; reason: "invalid_order" }> {
  const expected = SOCIAL_PROVIDER_REGISTRY.map((d) => d.id);
  const unique = [...new Set(orderedIds.map((x) => String(x).trim()))];
  if (unique.length !== expected.length) {
    return { ok: false, reason: "invalid_order" };
  }
  for (const id of unique) {
    if (!isKnownProviderId(id)) return { ok: false, reason: "invalid_order" };
  }
  if (new Set(unique).size !== expected.length) {
    return { ok: false, reason: "invalid_order" };
  }

  const now = new Date();
  const envStub: Record<string, string | undefined> = {};
  // 重排不依赖 env；先读现有 enabled/label
  const statuses = await listProviderStatus(db, envStub);

  for (let i = 0; i < unique.length; i++) {
    const id = unique[i] as SocialProviderId;
    const cur = statuses.find((s) => s.id === id)!;
    const existing = (await loadDbRows(db)).get(id);
    const label =
      existing?.displayLabel ??
      (cur.label !== cur.defaultLabel ? cur.label : null);
    const enabled = existing ? existing.enabled : cur.enabled;

    if (existing) {
      await db
        .update(socialProviderConfig)
        .set({
          sortOrder: i,
          updatedAt: now,
          updatedByEmail: actorEmail,
        })
        .where(eq(socialProviderConfig.providerId, id));
    } else {
      await db.insert(socialProviderConfig).values({
        providerId: id,
        enabled,
        sortOrder: i,
        displayLabel: label,
        updatedAt: now,
        updatedByEmail: actorEmail,
      });
    }
  }

  return { ok: true };
}

export type ResetProviderResult =
  | { ok: true; status: SocialProviderStatus }
  | { ok: false; reason: "unknown_provider" | "not_configured" };

/**
 * 删除运营配置行 = 恢复默认：enabled=true、注册表顺序、默认展示名。
 * 仅当存在 DB 行时有效；env 密钥与 allowlist 仍生效（要下线请用 enabled=false，不是重置）。
 */
export async function resetProviderConfig(
  db: AuthDb,
  env: Record<string, string | undefined>,
  providerId: string,
): Promise<ResetProviderResult> {
  if (!isKnownProviderId(providerId)) {
    return { ok: false, reason: "unknown_provider" };
  }
  const existing = (await loadDbRows(db)).get(providerId);
  if (!existing) {
    return { ok: false, reason: "not_configured" };
  }
  await db
    .delete(socialProviderConfig)
    .where(eq(socialProviderConfig.providerId, providerId));
  const status = (await listProviderStatus(db, env)).find(
    (p) => p.id === providerId,
  )!;
  return { ok: true, status };
}
