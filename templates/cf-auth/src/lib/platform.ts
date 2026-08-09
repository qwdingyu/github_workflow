/**
 * 平台适配层（Cloudflare Workers / Node.js）。
 * 差异收敛于此，路由与 auth 工厂不直接碰 CF-Connecting-IP / process.env 特例。
 */
import type { Context } from "hono";
import type { AppEnv, Bindings } from "../bindings";
import { getEnv as coreGetEnv, getClientIp as coreGetClientIp, waitUntil as coreWaitUntil } from "@usethink/cf-core/platform";

/**
 * 读取字符串环境变量：优先 c.env（Workers / 测试注入），回退 process.env（Node）。
 * 若 c.env **显式**带有该 key（含空串），视为调用方已注入完整 env，**不再**回退 process.env。
 * 这样 createTestApp({ admin: null }) 可稳定测 503，不被宿主机 ADMIN_* 污染。
 *
 * 委托 cf-core platform.getEnv（v0.5.0 起支持 process.env 回退）。
 * 本地保留 hasOwnProperty 语义：c.env 显式存在 key 时（哪怕空串/undefined）不 fallback，
 * 与 core 的「env 为空值也回退」不同，避免测试被宿主机 env 污染。
 */
export function getEnv(c: Context<AppEnv>, key: keyof Bindings): string | undefined {
  const bag = c.env as Record<string, unknown> | undefined;
  if (bag && Object.prototype.hasOwnProperty.call(bag, key as string)) {
    const binding = bag[key as string];
    if (typeof binding === "string" && binding.length > 0) return binding;
    return undefined;
  }
  return coreGetEnv(c as any, key as string) || undefined;
}

/**
 * 客户端 IP：Workers 用 CF-Connecting-IP；Node 仅在 TRUST_PROXY_HEADERS=true 时信任 XFF。
 *
 * 委托 cf-core platform.getClientIp（security 版安全实现，trustProxyHeaders 参数化）。
 */
export function getClientIp(c: Context<AppEnv>): string {
  const trustProxy = getEnv(c, "TRUST_PROXY_HEADERS") === "true";
  return coreGetClientIp(c as any, trustProxy);
}

/**
 * 异步延续：Workers waitUntil；Node fire-and-forget。
 * 委托 cf-core platform.waitUntil（v0.5.0 起同时支持 c.executionCtx 与 c.get("executionCtx")）。
 */
export function waitUntil(c: Context<AppEnv>, task: Promise<unknown>): void {
  coreWaitUntil(c as any, task);
}

/** 解析逗号分隔 origin 列表 */
export function parseTrustedOrigins(raw: string | undefined, fallback: string[]): string[] {
  if (!raw || !raw.trim()) return [...fallback];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 业务信任域的唯一默认源（bootstrap 用，仅本地开发端口）。
 * 生产 / Node / Workers 均须显式配置 TRUSTED_ORIGINS（wrangler vars、.env、env.cloud-server.example）。
 * 故意不硬编码生产域名：新 RP 未列入列表时跨域请求应被拒绝（fail-closed），
 * 而非静默放行——由 docs/013「加 RP 必改」运维纪律兜底。
 * app.ts（CORS）与 env.ts（Better Auth trustedOrigins）共用，避免多处漂移。
 */
export const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:8788",
  "http://localhost:8787",
];

/**
 * 管理端（Admin）独立信任域：ADMIN_TRUSTED_ORIGINS。
 * 与业务 RP 的 TRUSTED_ORIGINS 解耦——业务域不应自动获得管理写权限（最小化 CSRF 攻击面）。
 * 未配置 → 空列表：CSRF 校验默认仅信任同源（Admin SPA 由本站托管），fail-closed。
 */
export function resolveAdminTrustedOrigins(
  c: Context<AppEnv>,
): string[] {
  return parseTrustedOrigins(getEnv(c, "ADMIN_TRUSTED_ORIGINS"), []);
}
