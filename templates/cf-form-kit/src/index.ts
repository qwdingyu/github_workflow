import { Hono } from "hono";
import type { AppEnv } from "./bindings";
import { healthRoute } from "./routes/health";
import { formsRoute } from "./routes/forms";
import { adminRoute } from "./routes/admin";
import { jsonError } from "./lib/http";

const app = new Hono<AppEnv>();

app.route("/api", healthRoute);
app.route("/api/forms", formsRoute);
app.route("/api/admin", adminRoute);

app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/")) return jsonError(c, "API not found", 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  console.error(error);
  return jsonError(c, "服务暂时不可用", 500);
});

export default app;
