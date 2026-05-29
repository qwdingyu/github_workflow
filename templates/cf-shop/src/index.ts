/**
 * 发卡商城 Worker 入口
 *
 * 使用 @eforge/cf-core 的 bootstrap() 工厂函数创建应用。
 * 自动处理：数据库初始化、请求体限制、安全响应头、静态资源分流。
 */

import { bootstrap } from "@eforge/cf-core/bootstrap";
import * as schema from "./db/schema";
import { healthRoutes } from "./routes/health";
import { productRoutes } from "./routes/products";
import { orderRoutes } from "./routes/orders";
import { adminRoutes } from "./routes/admin";

/**
 * 导出 Worker 应用
 *
 * bootstrap() 返回标准的 Workers fetch handler 导出对象。
 * 所有路由注册在 /api 前缀下。
 */
export default bootstrap({
  // 传入 schema 以支持关系查询
  schema,

  // API 路由前缀
  apiPrefix: "/api",

  // 请求体大小限制：100KB
  maxBodySize: 1024 * 100,

  // 安全响应头配置（admin 页面需要 unsafe-eval 以支持 Vue UMD）
  securityHeaders: {
    allowUnsafeEval: true,
    extraScriptSrc: [
      "https://cdn.jsdelivr.net",
      "https://unpkg.com",
    ],
    extraStyleSrc: [
      "https://cdn.jsdelivr.net",
      "https://unpkg.com",
    ],
    extraConnectSrc: [
      "https://challenges.cloudflare.com",
    ],
  },

  // 注册业务路由
  registerRoutes: (api) => {
    api.route("/health", healthRoutes);
    api.route("/products", productRoutes);
    api.route("/orders", orderRoutes);
    api.route("/admin", adminRoutes);
  },

  // 页面路由（精确匹配 → HTML 文件）
  pageRoutes: {
    "/admin": "/admin.html",
  },

  // SPA 路由（这些路径都返回 index.html）
  spaRoutes: {
    fallback: "/index.html",
    paths: ["/shop", "/order"],
  },
});
