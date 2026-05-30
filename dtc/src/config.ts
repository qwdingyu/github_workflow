/**
 * DTC 查询服务 — 业务配置
 *
 * 站点元信息、默认分页、缓存 TTL 等运行时配置。
 */
export const config = {
  /** 站点名称 */
  siteName: "DTC Lookup",
  /** 站点描述（用于 SEO meta） */
  siteDescription: "Free OBD-II Diagnostic Trouble Code (DTC) Lookup Service. Search 18,000+ DTC codes by code, manufacturer, or keyword.",
  /** 站点关键词 */
  siteKeywords: "DTC, OBD-II, diagnostic trouble code, fault code, car diagnostic, check engine light",
  /** 默认每页条数 */
  defaultLimit: 20,
  /** 搜索最大返回条数 */
  maxLimit: 100,
  /** 缓存 TTL（秒） */
  cacheTtl: 3600,
  /** 批量查询最大条数 */
  maxBatchSize: 500,
  /** 搜索最小关键词长度 */
  minSearchLength: 2,
} as const;