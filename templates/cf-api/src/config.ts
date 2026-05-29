/**
 * cf-api — 服务配置
 *
 * 集中管理 API 服务的业务配置：
 * - 支持的服务类型
 * - 渠道列表与优先级
 * - 超时与重试设置
 * - Token 状态机常量
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 服务类型
// ═══════════════════════════════════════════════════════════════════════════════

/** 支持的服务类型（按业务需求扩展） */
export const SERVICE_TYPES = [
  "email_verify",     // 邮箱验证
  "sms_verify",       // 短信验证
  "captcha_solve",    // 验证码破解
  "account_create",   // 账号注册
  "data_lookup",      // 数据查询
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// 渠道配置
// ═══════════════════════════════════════════════════════════════════════════════

/** 渠道状态 */
export const CHANNEL_STATUS = ["active", "degraded", "disabled", "maintenance"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUS)[number];

/** 默认渠道优先级（数字越小优先级越高） */
export const DEFAULT_CHANNEL_PRIORITY = 10;

// ═══════════════════════════════════════════════════════════════════════════════
// Token 状态机
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Token 生命周期状态
 *
 * 状态转换图:
 *   unused → pending → active → completed
 *                        ↓
 *                      failed
 *   unused → expired（惰性清理）
 *   active → released（手动释放）
 */
export const TOKEN_STATUS = [
  "unused",     // 已生成，未使用
  "pending",    // 已提交到渠道，等待结果
  "active",     // 渠道处理中
  "completed",  // 成功完成
  "failed",     // 处理失败
  "expired",    // 过期（惰性清理）
  "released",   // 手动释放
] as const;

export type TokenStatus = (typeof TOKEN_STATUS)[number];

/** 合法的状态转换 */
export const VALID_TRANSITIONS: Record<TokenStatus, TokenStatus[]> = {
  unused:    ["pending", "expired", "released"],
  pending:   ["active", "failed", "expired"],
  active:    ["completed", "failed", "released"],
  completed: [],
  failed:    [],
  expired:   [],
  released:  [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 超时与限制
// ═══════════════════════════════════════════════════════════════════════════════

/** 默认超时设置（毫秒） */
export const TIMEOUTS = {
  /** 渠道 API 调用超时 */
  channelCall: 30_000,
  /** Token 默认有效期（未使用时） */
  tokenTtl: 10 * 60 * 1000, // 10 分钟
  /** Token 活跃状态最大持续时间 */
  tokenMaxActive: 30 * 60 * 1000, // 30 分钟
  /** 渠道健康检查超时 */
  healthCheck: 5_000,
} as const;

/** 默认重试设置 */
export const RETRY_DEFAULTS = {
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 分页
// ═══════════════════════════════════════════════════════════════════════════════

export const PAGINATION = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 惰性清理
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 惰性清理策略
 *
 * Free 套餐无 Cron Triggers 支持，因此在请求路径中概率性触发清理。
 * 每次请求有 CLEANUP_PROBABILITY 的概率执行一次过期 Token 清理。
 */
export const CLEANUP_PROBABILITY = 0.02; // 2% 概率触发
export const CLEANUP_BATCH_SIZE = 50;    // 每次清理条数上限
