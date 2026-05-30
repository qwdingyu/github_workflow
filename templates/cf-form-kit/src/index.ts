/**
 * cf-form-kit — Worker 入口
 *
 * 使用 @eforge/cf-core 的 bootstrap() 工厂函数创建应用。
 * 数据库初始化、安全响应头、错误处理由 bootstrap 自动注入。
 *
 * 路由结构:
 *   /api/health          — 健康检查
 *   /api/forms/*         — 表单提交（限流 + Turnstile）
 *   /api/admin/*         — 管理端（需 ADMIN_TOKEN）
 */

import { bootstrap } from "@eforge/cf-core/bootstrap";
import * as schema from "./db/schema";
import { healthRoute } from "./routes/health";
import { formsRoute } from "./routes/forms";
import { adminRoute } from "./routes/admin";

export default bootstrap({
  schema,
  apiPrefix: "/api",
  maxBodySize: 100 * 1024,

  securityHeaders: {
    extraScriptSrc: ["https://challenges.cloudflare.com"],
    extraConnectSrc: ["https://challenges.cloudflare.com"],
  },

  registerRoutes: (api) => {
    api.route("/health", healthRoute);
    api.route("/forms", formsRoute);
    api.route("/admin", adminRoute);
  },
});
