/**
 * ChannelAdapter 接口 — 统一的渠道适配器抽象
 *
 * 每个外部渠道（第三方 API 服务商）实现一个 ChannelAdapter，
 * 由 ChannelManager 统一管理和调度。
 *
 * 设计原则:
 * - Adapter 封装渠道的 HTTP 调用细节
 * - 统一的输入/输出格式（与具体渠道无关）
 * - 内置健康检查和错误分类
 */

import type { ServiceType } from "../config";

/**
 * 渠道调用请求
 */
export interface ChannelRequest {
  /** 服务类型 */
  serviceType: ServiceType;
  /** 调用参数（已标准化） */
  params: Record<string, unknown>;
  /** 超时时间（毫秒） */
  timeoutMs: number;
}

/**
 * 渠道调用响应
 */
export interface ChannelResponse {
  /** 是否成功 */
  success: boolean;
  /** 外部追踪 ID */
  externalId?: string;
  /** 结果数据 */
  data?: Record<string, unknown>;
  /** 错误信息 */
  error?: string;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 原始响应（用于调试，不存数据库） */
  rawResponse?: unknown;
}

/**
 * 渠道健康状态
 */
export interface ChannelHealth {
  /** 是否健康 */
  healthy: boolean;
  /** 延迟（毫秒） */
  latencyMs: number;
  /** 最后检查时间 */
  checkedAt: string;
  /** 错误信息 */
  error?: string;
}

/**
 * ChannelAdapter 接口
 *
 * @example
 * ```ts
 * class ChannelAAdapter implements ChannelAdapter {
 *   readonly type = "channel_a";
 *   readonly name = "渠道 A";
 *
 *   supports(serviceType) {
 *     return ["email_verify", "sms_verify"].includes(serviceType);
 *   }
 *
 *   async call(request) { ... }
 *   async checkStatus(externalId) { ... }
 *   async healthCheck() { ... }
 * }
 * ```
 */
export interface ChannelAdapter {
  /** 渠道类型标识（对应 channels.type） */
  readonly type: string;

  /** 渠道显示名称 */
  readonly name: string;

  /**
   * 检查是否支持指定服务类型
   */
  supports(serviceType: ServiceType): boolean;

  /**
   * 发起服务调用
   */
  call(request: ChannelRequest): Promise<ChannelResponse>;

  /**
   * 查询异步调用结果（可选）
   * 对于同步服务可不实现。
   */
  checkStatus?(externalId: string): Promise<ChannelResponse>;

  /**
   * 健康检查（可选）
   * 用于渠道管理器判断是否可路由。
   */
  healthCheck?(): Promise<ChannelHealth>;
}
