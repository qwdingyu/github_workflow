/**
 * ServiceHandler 接口 — 统一的服务处理器抽象
 *
 * 每种服务类型（email_verify / sms_verify / ...）实现此接口，
 * 通过 HandlerRegistry 注册后由 TokenService 调用。
 *
 * 设计原则:
 * - 每种服务类型一个 Handler
 * - Handler 不关心渠道选择（由 ChannelManager 负责）
 * - Handler 只负责参数校验、数据转换、结果解析
 */

import type { ServiceType } from "../../config";

/**
 * 生成凭证时的参数和返回
 */
export interface GenerateContext {
  /** 服务类型 */
  serviceType: ServiceType;
  /** 客户端传入的业务参数 */
  params: Record<string, unknown>;
  /** API Key ID */
  apiKeyId: string;
}

/**
 * 使用凭证时的上下文
 */
export interface UseContext {
  /** Token ID */
  tokenId: string;
  /** 已解密的凭证载荷 */
  payload: Record<string, unknown>;
  /** 客户端附加参数 */
  params: Record<string, unknown>;
  /** 选中的渠道 ID */
  channelId: string;
}

/**
 * 查询结果时的上下文
 */
export interface CheckContext {
  /** Token ID */
  tokenId: string;
  /** 外部追踪 ID（渠道返回） */
  externalId: string;
  /** 渠道 ID */
  channelId: string;
}

/**
 * 服务调用结果
 */
export interface ServiceResult {
  /** 是否成功 */
  success: boolean;
  /** 结果数据 */
  data?: Record<string, unknown>;
  /** 错误信息 */
  error?: string;
  /** 外部追踪 ID */
  externalId?: string;
}

/**
 * ServiceHandler 接口
 *
 * @example
 * ```ts
 * class EmailVerifyHandler implements ServiceHandler {
 *   serviceType = "email_verify" as const;
 *
 *   async validateParams(params) { ... }
 *   async preparePayload(ctx) { ... }
 *   async execute(ctx) { ... }
 *   async checkResult(ctx) { ... }
 * }
 * ```
 */
export interface ServiceHandler {
  /** 服务类型标识 */
  readonly serviceType: ServiceType;

  /**
   * 校验客户端参数
   * @throws 校验失败时抛出错误
   */
  validateParams(params: Record<string, unknown>): Promise<void>;

  /**
   * 准备加密载荷（生成凭证时调用）
   * 返回的数据会被加密后存入数据库。
   */
  preparePayload(ctx: GenerateContext): Promise<Record<string, unknown>>;

  /**
   * 执行服务调用（使用凭证时调用）
   * 通过渠道适配器发起外部 API 调用。
   */
  execute(ctx: UseContext): Promise<ServiceResult>;

  /**
   * 查询异步结果（可选）
   * 对于异步服务，轮询渠道获取最终结果。
   */
  checkResult?(ctx: CheckContext): Promise<ServiceResult>;
}
