/**
 * 渠道管理器
 *
 * 职责:
 * 1. 注册和管理渠道适配器
 * 2. 按优先级选择可用渠道
 * 3. 故障转移（主渠道失败时自动切换备用渠道）
 * 4. 渠道健康状态追踪
 *
 * 选择策略:
 * - 按 priority 升序遍历所有支持该服务类型的渠道
 * - 跳过 disabled / maintenance 状态的渠道
 * - 跳过健康检查失败的渠道
 * - 第一个成功的渠道即返回结果
 * - 全部失败时返回最后一个错误
 */

import type { ChannelAdapter, ChannelRequest, ChannelResponse } from "./types";
import type { ServiceType } from "../config";
import { TIMEOUTS } from "../config";
import { logger } from "@eforge/cf-core/logger";
import { classifyError, ErrorType } from "@eforge/cf-core/error";

/** 渠道管理器配置 */
export interface ChannelManagerOptions {
  /** 是否启用故障转移（默认 true） */
  enableFailover?: boolean;
  /** 最大重试渠道数（默认 3） */
  maxChannelRetries?: number;
}

export class ChannelManager {
  /** 适配器注册表（type → adapter） */
  private adapters = new Map<string, ChannelAdapter>();

  /** 渠道优先级（从数据库加载，type → priority） */
  private priorities = new Map<string, number>();

  /** 渠道状态（从数据库加载，type → status） */
  private statuses = new Map<string, string>();

  private enableFailover: boolean;
  private maxRetries: number;

  constructor(options: ChannelManagerOptions = {}) {
    this.enableFailover = options.enableFailover ?? true;
    this.maxRetries = options.maxChannelRetries ?? 3;
  }

  /**
   * 注册渠道适配器
   */
  register(adapter: ChannelAdapter, priority = 10, status = "active"): void {
    this.adapters.set(adapter.type, adapter);
    this.priorities.set(adapter.type, priority);
    this.statuses.set(adapter.type, status);
    logger.channelAction("register", adapter.type, { name: adapter.name, priority });
  }

  /**
   * 从数据库加载渠道配置（初始化时调用）
   */
  loadFromDb(channelList: Array<{ type: string; priority: number; status: string }>): void {
    for (const ch of channelList) {
      this.priorities.set(ch.type, ch.priority);
      this.statuses.set(ch.type, ch.status);
    }
  }

  /**
   * 选择可用渠道（按优先级排序，过滤不可用）
   */
  selectChannels(serviceType: ServiceType): ChannelAdapter[] {
    const candidates: Array<{ adapter: ChannelAdapter; priority: number }> = [];

    for (const [type, adapter] of this.adapters) {
      const status = this.statuses.get(type) || "active";
      const priority = this.priorities.get(type) ?? 99;

      // 跳过不可用状态
      if (status === "disabled" || status === "maintenance") continue;

      // 跳过不支持该服务类型的渠道
      if (!adapter.supports(serviceType)) continue;

      candidates.push({ adapter, priority });
    }

    // 按优先级升序排列
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.map((c) => c.adapter);
  }

  /**
   * 执行渠道调用（含故障转移）
   *
   * @param serviceType 服务类型
   * @param params 调用参数
   * @returns 渠道响应
   * @throws 所有渠道都失败时抛出错误
   */
  async execute(
    serviceType: ServiceType,
    params: Record<string, unknown>,
  ): Promise<ChannelResponse & { channelId: string }> {
    const available = this.selectChannels(serviceType);

    if (available.length === 0) {
      throw new Error(`无可用渠道: ${serviceType}`);
    }

    const request: ChannelRequest = {
      serviceType,
      params,
      timeoutMs: TIMEOUTS.channelCall,
    };

    let lastError: Error | undefined;
    const maxAttempts = this.enableFailover
      ? Math.min(available.length, this.maxRetries)
      : 1;

    for (let i = 0; i < maxAttempts; i++) {
      const adapter = available[i];

      try {
        logger.channelAction("call", adapter.type, { serviceType, attempt: i + 1 });

        const response = await this.callWithTimeout(adapter, request);

        if (response.success) {
          logger.channelAction("success", adapter.type, {
            serviceType,
            durationMs: response.durationMs,
          });
          return { ...response, channelId: adapter.type };
        }

        // 渠道返回业务失败
        const errType = classifyError(new Error(response.error || "channel error"));
        if (errType === ErrorType.PERMANENT) {
          // 不可重试错误，直接返回
          logger.channelAction("permanent_failure", adapter.type, {
            error: response.error,
          });
          return { ...response, channelId: adapter.type };
        }

        lastError = new Error(response.error || `渠道 ${adapter.name} 调用失败`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.channelAction("error", adapter.type, {
          error: lastError.message,
          attempt: i + 1,
        });

        // 不可重试错误直接抛出
        if (classifyError(err) === ErrorType.PERMANENT) {
          throw lastError;
        }
      }
    }

    // 所有渠道都失败
    throw lastError || new Error("所有渠道调用失败");
  }

  /**
   * 查询渠道异步结果
   */
  async checkStatus(
    channelType: string,
    externalId: string,
  ): Promise<ChannelResponse> {
    const adapter = this.adapters.get(channelType);
    if (!adapter) throw new Error(`未知渠道: ${channelType}`);
    if (!adapter.checkStatus) throw new Error(`渠道 ${channelType} 不支持异步查询`);

    return adapter.checkStatus(externalId);
  }

  /**
   * 带超时的渠道调用
   */
  private async callWithTimeout(
    adapter: ChannelAdapter,
    request: ChannelRequest,
  ): Promise<ChannelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const result = await adapter.call(request);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 全局渠道管理器实例 */
export const channelManager = new ChannelManager();

// ═══════════════════════════════════════════════════════════════════════════════
// 在此注册具体渠道适配器
// ═══════════════════════════════════════════════════════════════════════════════
//
// 示例（取消注释并实现后使用）：
//
// import { ChannelAAdapter } from "./adapters/channel-a";
// import { ChannelBAdapter } from "./adapters/channel-b";
//
// channelManager.register(new ChannelAAdapter(), 1, "active");
// channelManager.register(new ChannelBAdapter(), 10, "active");
//
// ═══════════════════════════════════════════════════════════════════════════════
