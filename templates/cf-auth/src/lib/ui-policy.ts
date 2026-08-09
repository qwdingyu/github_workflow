import { eq } from "drizzle-orm";
import type { AuthDb } from "../db/client";
import { systemConfig } from "../db/schema";

export const UI_POLICY_KEYS = {
  showNonAdminLogout: "ui.show_non_admin_logout",
} as const;

const DEFAULT_POLICY = {
  showNonAdminLogout: false,
} as const;

export type UiPolicy = {
  showNonAdminLogout: boolean;
};

function parseFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

export async function loadUiPolicy(db: AuthDb): Promise<UiPolicy> {
  const [row] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, UI_POLICY_KEYS.showNonAdminLogout))
    .limit(1);

  return {
    showNonAdminLogout: parseFlag(row?.value, DEFAULT_POLICY.showNonAdminLogout),
  };
}
