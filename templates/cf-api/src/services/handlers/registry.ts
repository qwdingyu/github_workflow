/**
 * ServiceHandler 注册表
 *
 * 管理所有 ServiceHandler 实例，按 serviceType 索引。
 * TokenService 通过注册表获取对应 Handler。
 *
 * 使用方式:
 * 1. 在 src/services/handlers/ 目录下创建具体 Handler
 * 2. 在本文件中注册
 * 3. TokenService 自动从注册表获取
 */

import type { ServiceHandler } from "./types";
import type { ServiceType } from "../../config";
import { logger } from "@eforge/cf-core/logger";

/**
 * Handler 注册表（单例）
 */
class HandlerRegistry {
  private handlers = new Map<ServiceType, ServiceHandler>();

  /**
   * 注册 Handler
   */
  register(handler: ServiceHandler): void {
    if (this.handlers.has(handler.serviceType)) {
      logger.warn("handler.override", {
        serviceType: handler.serviceType,
      });
    }
    this.handlers.set(handler.serviceType, handler);
    logger.info("handler.registered", { serviceType: handler.serviceType });
  }

  /**
   * 获取 Handler
   * @throws 未注册时抛出错误
   */
  get(serviceType: ServiceType): ServiceHandler {
    const handler = this.handlers.get(serviceType);
    if (!handler) {
      throw new Error(`未注册的服务类型: ${serviceType}`);
    }
    return handler;
  }

  /**
   * 检查是否已注册
   */
  has(serviceType: ServiceType): boolean {
    return this.handlers.has(serviceType);
  }

  /**
   * 获取所有已注册的服务类型
   */
  listTypes(): ServiceType[] {
    return Array.from(this.handlers.keys());
  }
}

/** 全局单例 */
export const registry = new HandlerRegistry();

// ═══════════════════════════════════════════════════════════════════════════════
// 在此注册具体 Handler
// ═══════════════════════════════════════════════════════════════════════════════
//
// 示例（取消注释并实现后使用）：
//
// import { EmailVerifyHandler } from "./email-verify";
// import { SmsVerifyHandler } from "./sms-verify";
//
// registry.register(new EmailVerifyHandler());
// registry.register(new SmsVerifyHandler());
//
// ═══════════════════════════════════════════════════════════════════════════════
