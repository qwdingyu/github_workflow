// Notification Routes — real-time SEO alert notifications
import { Hono } from "hono";
import type { Env } from "../index";
import { getUnreadNotifications, markAllRead } from "../services/alert-notifier";

const notifApp = new Hono<{ Bindings: Env }>();

interface User { id: string; email: string; plan: string; token: string; }

async function getUser(c: any): Promise<User | null> {
  const token = c.req.header("x-auth-token");
  if (!token) return null;
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE token = ?")
    .bind(token)
    .first();
  return (row as User) || null;
}

// GET /api/notifications — Get unread notifications
notifApp.get("/", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const notifications = await getUnreadNotifications(user.id, c.env.DB);
  return c.json({ notifications, count: notifications.length });
});

// POST /api/notifications/read-all — Mark all as read
notifApp.post("/read-all", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const marked = await markAllRead(user.id, c.env.DB);
  return c.json({ marked, message: `${marked} notifications marked as read` });
});

// GET /api/notifications/count — Get unread count (lightweight)
notifApp.get("/count", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const row = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM alerts a
    JOIN sites s ON a.site_id = s.id
    WHERE s.user_id = ? AND a.notified = 0
  `).bind(user.id).first();

  return c.json({ count: (row as any)?.cnt ?? 0 });
});

export { notifApp as notificationRoutes };
