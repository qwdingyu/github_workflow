/**
 * cf-tools — Worker 入口
 *
 * 使用 @eforge/cf-core 的 bootstrap() 工厂函数创建应用。
 * 注册所有业务路由和页面路由映射。
 *
 * 添加新工具只需：
 * 1. 实现 ToolDriver 接口（参考 src/services/tools/example-tool.ts）
 * 2. 在 registry.ts 中注册
 * 3. 在 config.ts 的 registeredTools 中添加元数据
 */

import { bootstrap } from "@eforge/cf-core/bootstrap";
import * as schema from "./db/schema";

// ── 导入路由模块 ──
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { toolRoutes } from "./routes/tools";
import { adminRoutes } from "./routes/admin";

// ── 使用 bootstrap 工厂创建应用 ──
export default bootstrap({
  // Drizzle schema（支持关系查询）
  schema,

  // API 路由前缀
  apiPrefix: "/api",

  // 请求体大小限制：100KB
  maxBodySize: 1024 * 100,

  // 安全响应头配置（admin 页面需要 unsafe-eval 以支持 Vue UMD）
  securityHeaders: {
    extraScriptSrc: ["https://unpkg.com", "https://cdn.jsdelivr.net"],
    extraStyleSrc: ["https://unpkg.com", "https://cdn.jsdelivr.net"],
    extraFontSrc: ["https://unpkg.com"],
  },

  // 注册业务路由
  registerRoutes: (api) => {
    api.route("/health", healthRoutes);
    api.route("/auth", authRoutes);
    api.route("/tools", toolRoutes);
    api.route("/admin", adminRoutes);
  },

  // 页面路由映射（精确匹配 → 返回指定 HTML 文件）
  pageRoutes: {
    "/admin": "/admin.html",
  },
});
