/**
 * DTC 故障码查询服务 — Worker 入口
 *
 * 使用 @usethink/cf-core 的 bootstrap() 工厂函数。
 * 所有基础设施（DB、安全头、错误处理、路由分流）由 bootstrap 自动注入。
 *
 * 路由结构：
 *   /api/v1/dtc/{code}            — 单码查询
 *   /api/v1/dtc/search            — 关键词搜索
 *   /api/v1/dtc/batch             — 批量查询
 *   /api/v1/dtc/stats             — 统计
 *   /api/v1/dtc/by-manufacturer   — 按制造商
 *   /api/v1/dtc/extract           — 从文本提取
 *   /api/v1/dtc/normalize/{code}  — 归一化
 *   /api/v1/manufacturers         — 制造商列表
 *   /api/health                   — 健康检查
 */

import { bootstrap } from "@usethink/cf-core/bootstrap";
import * as schema from "./db/schema";
import { health } from "./routes/health";
import { dtc } from "./routes/dtc";
import { manufacturersRoute } from "./routes/manufacturers";

export default bootstrap({
  // 完整 schema（支持 Drizzle 关系查询）
  schema,

  // API 路由前缀
  apiPrefix: "/api",

  // 请求体限制 50KB（DTC 查询用不到大 body）
  maxBodySize: 50 * 1024,

  // 安全响应头
  securityHeaders: {},

  // 注册业务路由
  registerRoutes: (api) => {
    api.route("/health", health);
    api.route("/v1/dtc", dtc);
    api.route("/v1/manufacturers", manufacturersRoute);
  },
});