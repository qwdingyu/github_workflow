/**
 * TokenService — 凭证生命周期管理
 *
 * 核心职责:
 * 1. 生成凭证（generate）— 创建 Token 记录，加密存储载荷
 * 2. 使用凭证（use）— 通过渠道适配器发起服务调用
 * 3. 查询结果（checkResult）— 轮询异步服务结果
 * 4. 释放凭证（release）— 手动释放活跃凭证
 * 5. 过期回收（lazyCleanup）— 惰性清理过期 Token
 *
 * 状态机:
 *   unused → pending → active → completed / failed
 *   unused → expired（惰性清理）
 *   active → released（手动释放）
 *
 * 安全措施:
 * - 凭证载荷 AES-256-GCM 加密存储
 * - 状态转换严格校验（防止非法跳转）
 * - 权限隔离（只能操作自己 API Key 创建的凭证）
 */

import { eq, and, lt, sql } from "drizzle-orm";
import type { DrizzleInstance } from "@eforge/cf-core/db";
import { encrypt, decrypt, generateUUID, isEncryptionAvailable } from "@eforge/cf-core/crypto";
import { logger } from "@eforge/cf-core/logger";
import { tokens, serviceLogs, channels } from "../db/schema";
import { registry } from "./handlers/registry";
import { channelManager } from "../channels/manager";
import {
  TIMEOUTS,
  VALID_TRANSITIONS,
  CLEANUP_PROBABILITY,
  CLEANUP_BATCH_SIZE,
  type TokenStatus,
  type ServiceType,
} from "../config";
import type { AppBindings } from "../bindings";

// ── 类型定义 ──

interface GenerateInput {
  serviceType: ServiceType;
  params: Record<string, unknown>;
  apiKeyId: string;
  ipHash: string;
  idempotencyKey?: string;
}

interface UseInput {
  apiKeyId: string;
  ipHash: string;
  params: Record<string, unknown>;
}

interface TokenRow {
  id: string;
  serviceType: string;
  channelId: string | null;
  apiKeyId: string;
  status: string;
  encryptedPayload: string;
  resultJson: string;
  externalId: string | null;
  errorMessage: string;
  ipHash: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export class TokenService {
  private db: DrizzleInstance;
  private env: AppBindings;

  constructor(db: DrizzleInstance, env: AppBindings) {
    this.db = db;
    this.env = env;

    // 概率性触发惰性清理（Free 套餐无 Cron）
    if (Math.random() < CLEANUP_PROBABILITY) {
      this.lazyCleanup().catch((err) =>
        logger.warn("lazyCleanup.failed", { error: String(err) }),
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. 生成凭证
  // ═══════════════════════════════════════════════════════════════════════════

  async generate(input: GenerateInput): Promise<TokenRow> {
    const { serviceType, params, apiKeyId, ipHash, idempotencyKey } = input;
    const now = new Date().toISOString();

    // 校验 Handler 是否已注册
    if (!registry.has(serviceType)) {
      throw new Error(`不支持的服务类型: ${serviceType}`);
    }

    const handler = registry.get(serviceType);

    // 参数校验
    await handler.validateParams(params);

    // 准备加密载荷
    const payload = await handler.preparePayload({ serviceType, params, apiKeyId });

    // 加密
    let encryptedPayload = "";
    if (isEncryptionAvailable(this.env)) {
      encryptedPayload = await encrypt(payload, this.env.CREDENTIALS_ENCRYPTION_KEY!);
    } else {
      // 未配置加密密钥时 base64 编码（仅开发环境）
      encryptedPayload = btoa(JSON.stringify(payload));
      logger.warn("token.unencrypted", { serviceType });
    }

    // 生成 Token
    const id = generateUUID();
    const expiresAt = new Date(Date.now() + TIMEOUTS.tokenTtl).toISOString();

    const tokenData = {
      id,
      serviceType,
      channelId: "",
      apiKeyId,
      status: "unused" as const,
      encryptedPayload,
      resultJson: "{}",
      externalId: "",
      errorMessage: "",
      ipHash,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(tokens).values(tokenData);

    // 记录日志
    await this.writeLog({
      tokenId: id,
      serviceType,
      action: "generate",
      result: "success",
      ipHash,
      apiKeyId,
    });

    logger.resourceAction("generate", id, { serviceType });
    return tokenData;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 查询凭证
  // ═══════════════════════════════════════════════════════════════════════════

  async getById(id: string): Promise<TokenRow | null> {
    const rows = await this.db.select().from(tokens).where(eq(tokens.id, id)).limit(1);
    if (rows.length === 0) return null;

    const row = rows[0];
    // 解析 resultJson
    let resultJson: string;
    try {
      resultJson = JSON.parse(row.resultJson || "{}");
    } catch {
      resultJson = {};
    }

    return {
      ...row,
      resultJson: resultJson as unknown as string,
    } as TokenRow;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 使用凭证
  // ═══════════════════════════════════════════════════════════════════════════

  async use(id: string, input: UseInput): Promise<TokenRow> {
    const now = new Date().toISOString();
    const token = await this.getById(id);

    if (!token) throw new Error("凭证不存在");
    if (token.apiKeyId !== input.apiKeyId) throw new Error("无权操作此凭证");

    // 检查状态
    this.assertTransition(token.status as TokenStatus, "pending");

    // 检查是否过期
    if (new Date(token.expiresAt) < new Date()) {
      await this.updateStatus(id, "expired", now);
      throw new Error("凭证已过期");
    }

    // 解密载荷
    let payload: Record<string, unknown>;
    if (isEncryptionAvailable(this.env)) {
      payload = await decrypt(token.encryptedPayload, this.env.CREDENTIALS_ENCRYPTION_KEY!);
    } else {
      payload = JSON.parse(atob(token.encryptedPayload));
    }

    // 状态: unused → pending
    await this.updateStatus(id, "pending", now);

    const startTime = Date.now();

    try {
      // 通过渠道管理器执行
      const result = await channelManager.execute(
        token.serviceType as ServiceType,
        { ...payload, ...input.params },
      );

      const durationMs = Date.now() - startTime;

      if (result.success) {
        // pending → active（异步服务）或 completed（同步服务）
        const nextStatus = result.externalId ? "active" : "completed";
        await this.db.update(tokens).set({
          status: nextStatus,
          channelId: result.channelId,
          externalId: result.externalId || "",
          resultJson: JSON.stringify(result.data || {}),
          updatedAt: new Date().toISOString(),
        }).where(eq(tokens.id, id));

        await this.writeLog({
          tokenId: id,
          serviceType: token.serviceType,
          channelId: result.channelId,
          action: "use",
          result: "success",
          durationMs,
          ipHash: input.ipHash,
          apiKeyId: input.apiKeyId,
        });

        return (await this.getById(id))!;
      } else {
        // 渠道返回业务失败
        await this.updateStatus(id, "failed", new Date().toISOString(), result.error);
        await this.writeLog({
          tokenId: id,
          serviceType: token.serviceType,
          action: "use",
          result: "failure",
          durationMs,
          errorMessage: result.error,
          ipHash: input.ipHash,
          apiKeyId: input.apiKeyId,
        });

        return (await this.getById(id))!;
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      await this.updateStatus(id, "failed", new Date().toISOString(), errorMsg);
      await this.writeLog({
        tokenId: id,
        serviceType: token.serviceType,
        action: "use",
        result: "failure",
        durationMs,
        errorMessage: errorMsg,
        ipHash: input.ipHash,
        apiKeyId: input.apiKeyId,
      });

      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 查询异步结果
  // ═══════════════════════════════════════════════════════════════════════════

  async checkResult(id: string): Promise<TokenRow> {
    const token = await this.getById(id);
    if (!token) throw new Error("凭证不存在");

    // 只有 active/pending 状态才需要查询
    if (token.status !== "active" && token.status !== "pending") {
      return token;
    }

    if (!token.externalId || !token.channelId) {
      return token;
    }

    try {
      const response = await channelManager.checkStatus(
        token.channelId,
        token.externalId,
      );

      if (response.success && response.data) {
        this.assertTransition(token.status as TokenStatus, "completed");
        await this.db.update(tokens).set({
          status: "completed",
          resultJson: JSON.stringify(response.data),
          updatedAt: new Date().toISOString(),
        }).where(eq(tokens.id, id));
      } else if (!response.success && response.error) {
        await this.db.update(tokens).set({
          status: "failed",
          errorMessage: response.error,
          updatedAt: new Date().toISOString(),
        }).where(eq(tokens.id, id));
      }
    } catch (err) {
      logger.warn("checkResult.failed", { tokenId: id, error: String(err) });
    }

    return (await this.getById(id))!;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. 释放凭证
  // ═══════════════════════════════════════════════════════════════════════════

  async release(id: string, apiKeyId: string): Promise<TokenRow> {
    const token = await this.getById(id);
    if (!token) throw new Error("凭证不存在");
    if (token.apiKeyId !== apiKeyId) throw new Error("无权操作此凭证");

    this.assertTransition(token.status as TokenStatus, "released");

    const now = new Date().toISOString();
    await this.db.update(tokens).set({
      status: "released",
      updatedAt: now,
    }).where(eq(tokens.id, id));

    await this.writeLog({
      tokenId: id,
      serviceType: token.serviceType,
      action: "release",
      result: "success",
      ipHash: "",
      apiKeyId,
    });

    logger.resourceAction("release", id, {});
    return (await this.getById(id))!;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. 终端用户提交数据
  // ═══════════════════════════════════════════════════════════════════════════

  async submitUserData(
    id: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = await this.getById(id);
    if (!token) throw new Error("凭证不存在");

    if (token.status !== "active" && token.status !== "pending") {
      throw new Error("凭证状态不允许提交数据");
    }

    // 更新结果数据
    const existingResult = JSON.parse(token.resultJson as unknown as string || "{}");
    const mergedResult = { ...existingResult, ...data, submittedAt: new Date().toISOString() };

    await this.db.update(tokens).set({
      resultJson: JSON.stringify(mergedResult),
      updatedAt: new Date().toISOString(),
    }).where(eq(tokens.id, id));

    return mergedResult;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. 惰性清理（过期 Token 回收）
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 惰性清理 — 标记过期 Token
   *
   * Free 套餐无 Cron Triggers，通过请求概率触发。
   * 将 unused 且已过期的 Token 标记为 expired。
   */
  private async lazyCleanup(): Promise<void> {
    const now = new Date().toISOString();

    try {
      await this.db
        .update(tokens)
        .set({
          status: "expired",
          updatedAt: now,
        })
        .where(
          and(
            eq(tokens.status, "unused"),
            lt(tokens.expiresAt, now),
          ),
        );

      logger.info("lazyCleanup.completed", { checkedAt: now });
    } catch (err) {
      logger.warn("lazyCleanup.error", { error: String(err) });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部工具方法
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 校验状态转换是否合法
   */
  private assertTransition(current: TokenStatus, target: TokenStatus): void {
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(target)) {
      throw new Error(`非法状态转换: ${current} → ${target}`);
    }
  }

  /**
   * 更新 Token 状态
   */
  private async updateStatus(
    id: string,
    status: TokenStatus,
    updatedAt: string,
    errorMessage?: string,
  ): Promise<void> {
    const updates: Record<string, unknown> = { status, updatedAt };
    if (errorMessage) updates.errorMessage = errorMessage;

    await this.db.update(tokens).set(updates).where(eq(tokens.id, id));
  }

  /**
   * 写入服务日志
   */
  private async writeLog(input: {
    tokenId: string;
    serviceType: string;
    channelId?: string;
    action: string;
    result: string;
    durationMs?: number;
    errorMessage?: string;
    ipHash: string;
    apiKeyId: string;
  }): Promise<void> {
    try {
      await this.db.insert(serviceLogs).values({
        id: generateUUID(),
        tokenId: input.tokenId,
        serviceType: input.serviceType,
        channelId: input.channelId || "",
        action: input.action,
        result: input.result,
        durationMs: input.durationMs || 0,
        requestJson: "{}",
        responseJson: "{}",
        errorMessage: input.errorMessage || "",
        ipHash: input.ipHash,
        apiKeyId: input.apiKeyId,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      // 日志写入失败不阻塞主流程
      logger.warn("serviceLog.write.failed", { error: String(err) });
    }
  }
}
