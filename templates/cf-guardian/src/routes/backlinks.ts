// Backlink Checker Routes
import { Hono } from "hono";
import type { Env } from "../index";
import { checkBacklinkProfile } from "../services/backlink-checker";

const backlinkApp = new Hono<{ Bindings: Env }>();

interface User { id: string; email: string; plan: string; token: string; }

async function getUser(c: any): Promise<User | null> {
  const token = c.req.header("x-auth-token");
  if (!token) return null;
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE token = ?")
    .bind(token)
    .first();
  return (row as User) || null;
}

// GET /api/backlinks/check?url=https://example.com — Check backlink profile
backlinkApp.get("/check", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Free tier limited
  if (user.plan === "free") {
    return c.json({ error: "Backlink checking requires Starter plan or higher" }, 403);
  }

  const url = c.req.query("url");
  if (!url) return c.json({ error: "url parameter required" }, 400);

  try {
    new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const profile = await checkBacklinkProfile(url, { AI: c.env.AI });
  return c.json({ backlinkProfile: profile });
});

// GET /api/backlinks/:siteId — Get backlink profile for monitored site
backlinkApp.get("/:siteId", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id, url, name FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const profile = await checkBacklinkProfile((site as any).url, { AI: c.env.AI });
  return c.json({
    site: { id: siteId, url: (site as any).url, name: (site as any).name },
    backlinkProfile: profile,
  });
});

export { backlinkApp as backlinkRoutes };
