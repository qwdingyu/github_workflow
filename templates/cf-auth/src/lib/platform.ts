/**
 * 平台适配层（Cloudflare Workers / Node.js）。
 * 差异收敛于此，路由与 auth 工厂不直接碰 CF-Connecting-IP / process.env 特例。
 */
import type { Context } from "hono";
import type { AppEnv, Bindings } from "../bindings";

/**
 * 读取字符串环境变量：优先 c.env（Workers / 测试注入），回退 process.env（Node）。
 */
export function getEnv(c: Context<AppEnv>, key: keyof Bindings): string | undefined {
  const binding = (c.env as Record<string, unknown> | undefined)?.[key as string];
  if (typeof binding === "string" && binding.length > 0) return binding;
  try {
    const fromProcess = (process.env as Record<string, string | undefined>)?.[key as string];
    return fromProcess && fromProcess.length > 0 ? fromProcess : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 客户端 IP：Workers 用 CF-Connecting-IP；Node 仅在 TRUST_PROXY_HEADERS=true 时信任 XFF。
 */
export function getClientIp(c: Context<AppEnv>): string {
  const cfIp = c.req.header("CF-Connecting-IP");
  if (cfIp) return cfIp;

  if (isProxyHeaderTrusted(c)) {
    return c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
  }
  return "unknown";
}

function isProxyHeaderTrusted(c: Context<AppEnv>): boolean {
  if (getEnv(c, "TRUST_PROXY_HEADERS") === "true") return true;
  return false;
}

/**
 * 异步延续：Workers waitUntil；Node fire-and-forget。
 */
export function waitUntil(c: Context<AppEnv>, task: Promise<unknown>): void {
  const ctx = c.get("executionCtx");
  if (ctx?.waitUntil) {
    ctx.waitUntil(task);
    return;
  }
  void task.catch((err) => console.error("[waitUntil] failed:", err));
}

/** 解析逗号分隔 origin 列表 */
export function parseTrustedOrigins(raw: string | undefined, fallback: string[]): string[] {
  if (!raw || !raw.trim()) return [...fallback];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
