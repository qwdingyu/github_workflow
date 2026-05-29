/**
 * cf-api — Worker 入口
 *
 * 使用 @eforge/cf-core 的 bootstrap() 工厂函数创建应用。
 * 只需注册路由和配置页面映射，所有基础设施（DB、安全头、错误处理）
 * 由 bootstrap 自动注入。
 *
 * 路由结构:
 *   /api/health         — 健康检查（无需认证）
 *   /api/tokens/*       — 凭证管理（需 API Key）
 *   /api/user/*         — 公开用户端（限流保护）
 *   /api/admin/*        — 管理端（需 ADMIN_TOKEN）
 */

import { bootstrap } from "@eforge/cf-core/bootstrap";
import * as schema from "./db/schema";
import { health } from "./routes/health";
import { tokens } from "./routes/tokens";
import { user } from "./routes/user";
import { admin } from "./routes/admin";

export default bootstrap({
  // 完整 schema（支持 Drizzle 关系查询）
  schema,

  // API 路由前缀
  apiPrefix: "/api",

  // 请求体限制 100KB
  maxBodySize: 100 * 1024,

  // 安全响应头（admin 页面允许 unsafe-eval，由 bootstrap 自动处理）
  securityHeaders: {
    extraScriptSrc: ["https://unpkg.com", "https://cdn.jsdelivr.net"],
    extraStyleSrc: ["https://unpkg.com", "https://cdn.jsdelivr.net"],
    extraConnectSrc: ["https://cdn.jsdelivr.net"],
    extraFontSrc: ["https://unpkg.com", "https://cdn.jsdelivr.net"],
  },

  // 注册业务路由
  registerRoutes: (api) => {
    api.route("/health", health);
    api.route("/tokens", tokens);
    api.route("/user", user);
    api.route("/admin", admin);
  },

  // 页面路由映射
  pageRoutes: {
    "/admin": "/admin.html",
  },
});
