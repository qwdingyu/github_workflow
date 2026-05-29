/**
 * cf-tools — 项目配置
 *
 * 这是用户主要修改的文件。根据项目需求调整以下配置项：
 *
 * - 已注册的工具列表
 * - 用户认证设置（JWT 过期时间、密码策略）
 * - 限流策略
 * - 站点信息
 */

// ═══ 站点配置 ═══════════════════════════════════════════════════════════════

export const siteConfig = {
  /** 站点名称 */
  name: "CF Tools",
  /** 站点描述 */
  description: "在线工具箱 — 快速、安全、免费",
  /** 站点 Logo（可选，留空使用文字） */
  logo: "",
  /** 页脚文字 */
  footer: "Powered by Cloudflare Workers",
};

// ═══ 认证配置 ═══════════════════════════════════════════════════════════════

export const authConfig = {
  /** JWT 过期时间（秒），默认 7 天 */
  jwtExpiry: 7 * 24 * 60 * 60,

  /** 密码最小长度 */
  minPasswordLength: 8,

  /** 是否开放注册（关闭后仅管理员可创建用户） */
  openRegistration: true,

  /** 注册时是否需要 Turnstile 人机验证 */
  requireTurnstile: true,
};

// ═══ 限流配置 ═══════════════════════════════════════════════════════════════

export const rateLimitConfig = {
  /** 登录接口：窗口内最大请求数 */
  loginMaxRequests: 5,
  /** 登录接口：窗口时长（毫秒） */
  loginWindowMs: 15 * 60 * 1000,

  /** 注册接口：窗口内最大请求数 */
  registerMaxRequests: 3,
  /** 注册接口：窗口时长（毫秒） */
  registerWindowMs: 60 * 60 * 1000,

  /** 工具执行：窗口内最大请求数 */
  toolRunMaxRequests: 30,
  /** 工具执行：窗口时长（毫秒） */
  toolRunWindowMs: 60 * 1000,
};

// ═══ 已注册工具列表 ═════════════════════════════════════════════════════════
// 在此添加新工具。slug 必须与 ToolDriver 注册名一致。

export interface ToolMeta {
  /** 工具唯一标识（与 ToolDriver 注册名一致） */
  slug: string;
  /** 显示名称 */
  name: string;
  /** 简短描述 */
  description: string;
  /** 图标（Emoji 或 SVG） */
  icon: string;
  /** 分类标签 */
  category: string;
  /** 是否默认启用 */
  enabled: boolean;
}

export const registeredTools: ToolMeta[] = [
  {
    slug: "text-hash",
    name: "文本哈希生成器",
    description: "支持 SHA-256 / SHA-1 / MD5 等多种哈希算法",
    icon: "#",
    category: "编码",
    enabled: true,
  },
  // ── 添加更多工具 ──
  // {
  //   slug: "json-formatter",
  //   name: "JSON 格式化",
  //   description: "格式化、压缩、校验 JSON 数据",
  //   icon: "{}",
  //   category: "格式化",
  //   enabled: true,
  // },
];

// ═══ 管理端配置 ═══════════════════════════════════════════════════════════════

export const adminConfig = {
  /** 管理后台路径 */
  basePath: "/admin",
  /** 每页默认展示数量 */
  pageSize: 20,
};
