// Rate Limiting Middleware — per-user, per-endpoint rate limiting using Turso (LibSQL)
import type { Context } from "hono";
import type { Env } from "../index";

export interface RateLimitConfig {
  // Requests per window
  windowMs: number;
  maxRequests: number;
  // Per-plan overrides
  planOverrides?: Record<string, { windowMs: number; maxRequests: number }>;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms
}

// Default rate limits by plan
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  free: { windowMs: 60_000, maxRequests: 30 },           // 30 req/min
  starter: { windowMs: 60_000, maxRequests: 120 },       // 120 req/min
  pro: { windowMs: 60_000, maxRequests: 600 },           // 600 req/min
  agency: { windowMs: 60_000, maxRequests: 2000 },       // 2000 req/min
};

// Per-endpoint stricter limits
export const ENDPOINT_LIMITS: Record<string, Record<string, { windowMs: number; maxRequests: number }>> = {
  "/api/audit": {
    free: { windowMs: 300_000, maxRequests: 3 },    // 3 audits/5min
    starter: { windowMs: 60_000, maxRequests: 10 },
    pro: { windowMs: 60_000, maxRequests: 30 },
    agency: { windowMs: 60_000, maxRequests: 100 },
  },
  "/api/geo": {
    free: { windowMs: 300_000, maxRequests: 5 },    // 5 geo checks/5min
    starter: { windowMs: 60_000, maxRequests: 20 },
    pro: { windowMs: 60_000, maxRequests: 60 },
    agency: { windowMs: 60_000, maxRequests: 200 },
  },
  "/api/optimizer": {
    free: { windowMs: 600_000, maxRequests: 5 },    // 5 optimizations/10min
    starter: { windowMs: 300_000, maxRequests: 20 },
    pro: { windowMs: 60_000, maxRequests: 60 },
    agency: { windowMs: 60_000, maxRequests: 200 },
  },
};

// Create rate limiter middleware
export function rateLimiter(config?: RateLimitConfig) {
  const baseConfig: RateLimitConfig = config || { windowMs: 60_000, maxRequests: 30 };

  return async (c: Context<any, any, any>, next: () => Promise<void>) => {
    const token = c.req.header("x-auth-token");
    if (!token) {
      // Public endpoints — skip rate limiting or use IP-based
      return next();
    }

    // Get user
    let userId: string;
    let userPlan = "free";
    try {
      const user = await c.env.DB.prepare("SELECT id, plan FROM users WHERE token = ?")
        .bind(token)
        .first() as { id: string; plan: string } | undefined;
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      userId = user.id;
      userPlan = user.plan || "free";
    } catch {
      return c.json({ error: "Rate limit check failed" }, 500);
    }

    const now = Date.now();
    const endpoint = getEndpointKey(c.req.path);

    // Get plan-specific config
    const planConfig = getPlanConfig(endpoint, userPlan, baseConfig);
    const windowMs = planConfig.windowMs;
    const maxRequests = planConfig.maxRequests;

    const windowKey = `rl:${userId}:${endpoint}:${Math.floor(now / windowMs)}`;

    try {
      // Atomic increment using Turso
      const { results } = await c.env.DB.prepare(`
        INSERT INTO rate_limit_windows (key, count, window_start, created_at)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(key) DO UPDATE SET count = count + 1
        RETURNING count
      `).bind(windowKey, new Date(now - (now % windowMs)).toISOString(), new Date().toISOString()).all();

      const currentCount = results?.[0]?.count ?? 1;
      const allowed = currentCount <= maxRequests;
      const remaining = Math.max(0, maxRequests - currentCount);
      const resetAt = Math.floor(now / windowMs) * windowMs + windowMs;

      // Set rate limit headers
      c.header("X-RateLimit-Limit", String(maxRequests));
      c.header("X-RateLimit-Remaining", String(remaining));
      c.header("X-RateLimit-Reset", String(Math.floor(resetAt / 1000)));

      if (!allowed) {
        return c.json(
          {
            error: "Rate limit exceeded",
            retryAfter: Math.ceil((resetAt - now) / 1000),
            limit: maxRequests,
            window: `${windowMs / 1000}s`,
            upgradeMessage: `Upgrade your plan for higher limits. Current: ${userPlan}`,
          },
          429,
        );
      }

      await next();
    } catch (err: any) {
      console.warn("[RateLimit] Error:", err.message);
      // Fail open — don't block requests if rate limiter is down
      await next();
    }
  };
}

function getEndpointKey(path: string): string {
  if (path.startsWith("/api/audit")) return "audit";
  if (path.startsWith("/api/geo")) return "geo";
  if (path.startsWith("/api/optimizer")) return "optimizer";
  if (path.startsWith("/api/export")) return "export";
  return "general";
}

function getPlanConfig(
  endpoint: string,
  plan: string,
  baseConfig: RateLimitConfig,
): { windowMs: number; maxRequests: number } {
  // Check endpoint-specific limits first
  const endpointConfig = ENDPOINT_LIMITS[endpoint];
  if (endpointConfig && endpointConfig[plan]) {
    return endpointConfig[plan];
  }
  if (endpointConfig && endpointConfig.free) {
    return endpointConfig.free; // Default to free tier for unknown plans
  }

  // Fall back to base config
  const planOverride = (baseConfig as any).planOverrides?.[plan];
  if (planOverride) return planOverride;

  return {
    windowMs: (baseConfig as any).windowMs || 60_000,
    maxRequests: (baseConfig as any).maxRequests || 30,
  };
}
