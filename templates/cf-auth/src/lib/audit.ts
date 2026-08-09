/**
 * 管理审计写入（docs/013 P1-6 / §5.5）。
 * 只追加、不提供删除 API；普通用户不可读。
 */
import { adminAuditLog } from "../db/schema";
import type { AuthDb } from "../db/client";
import type { AdminActor } from "./admin-auth";

export type AuditAction =
  | "client.create"
  | "client.update"
  | "client.disable"
  | "client.enable"
  | "client.rotate_secret"
  | "client.batch_disable"
  | "client.batch_enable"
  | "client.delete"
  | "session.revoke"
  | "user.disable"
  | "user.enable"
  | "user.delete"
  | "blocklist.add"
  | "blocklist.remove"
  | "social_provider.update"
  | "social_provider.reorder"
  | "social_provider.reset"
  | "trusted_origin.create"
  | "trusted_origin.update"
  | "trusted_origin.delete"
  | "email_config.create"
  | "email_config.update"
  | "email_config.delete"
  | "admin.login_probe";

export async function writeAdminAudit(
  db: AuthDb,
  actor: AdminActor,
  input: {
    action: AuditAction | string;
    targetType?: string | null;
    targetId?: string | null;
    meta?: Record<string, unknown> | null;
  },
): Promise<void> {
  const now = new Date();
  await db.insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    meta: input.meta ? JSON.stringify(input.meta) : null,
    ip: actor.ip,
    createdAt: now,
  });
}
