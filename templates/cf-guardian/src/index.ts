/**
 * cf-guardian — Worker 入口
 *
 * 使用 @eforge/cf-core 的 bootstrap() 工厂函数创建应用。
 * bootstrap 提供：DB 初始化、安全响应头、请求超时、错误处理、静态资源路由。
 */

import { bootstrap } from "@eforge/cf-core/bootstrap";
import * as schema from "./db/schema";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { siteRoutes } from "./routes/sites";
import { scanRoutes } from "./routes/scans";
import { competitorRoutes } from "./routes/competitors";
import { geoRoutes } from "./routes/geo";
import { reportRoutes } from "./routes/reports";

export interface Env {
  // ── cf-core 基础设施 ──
  TURSO_URL: string;
  TURSO_TOKEN?: string;
  ASSETS: Fetcher;
  executionCtx: ExecutionContext;
  // ── SEO Guardian 业务配置 ──
  APP_ORIGIN?: string;
}

export default bootstrap({
  schema,
  apiPrefix: "/api",
  maxBodySize: 1024 * 100,
  securityHeaders: {
    extraScriptSrc: ["https://unpkg.com", "https://cdn.jsdelivr.net"],
    extraStyleSrc: ["https://unpkg.com", "https://cdn.jsdelivr.net"],
    extraFontSrc: ["https://unpkg.com"],
  },
  registerRoutes: (api) => {
    api.route("/health", healthRoutes);
    api.route("/auth", authRoutes);
    api.route("/sites", siteRoutes);
    api.route("/scans", scanRoutes);
    api.route("/competitors", competitorRoutes);
    api.route("/geo", geoRoutes);
    api.route("/reports", reportRoutes);
  },
  pageRoutes: {
    "/admin": "/admin.html",
  },
});
