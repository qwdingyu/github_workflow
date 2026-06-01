import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { USER_QUERIES } from "../db/schema";
import type { Env } from "../index";

const authApp = new Hono<{ Bindings: Env }>();

// Generate a simple random token (64-char hex)
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Password hashing with salt (SHA-256, stored as salt$hash)
function generateSalt(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split("$");
  if (!salt || !hash) return false;
  const computed = await hashPassword(password, salt);
  return hash === computed;
}

// POST /api/auth/signup — Email + password signup with 7-day trial
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  plan: z.enum(["free", "starter", "pro", "agency"]).default("free"),
});

authApp.post("/signup", zValidator("json", signupSchema), async (c) => {
  const { email, password, plan } = c.req.valid("json");
  const env = c.env;

  // Check if user exists
  const existing = await env.DB.prepare(USER_QUERIES.GET_BY_EMAIL).bind(email).first();
  if (existing) {
    return c.json({ error: "Email already registered" }, 409);
  }

  const id = crypto.randomUUID();
  const token = generateToken();
  const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const storedPassword = `${salt}$${passwordHash}`;

  await env.DB.prepare(
    "INSERT INTO users (id, email, token, password_hash, plan, trial_ends_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, email, token, storedPassword, plan, trialEndsAt).run();

  return c.json(
    {
      user: { id, email, plan, trial_ends_at: trialEndsAt },
      token,
    },
    201
  );
});

// POST /api/auth/login — Email + password login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authApp.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const env = c.env;

  const user = await env.DB.prepare(USER_QUERIES.GET_BY_EMAIL).bind(email).first();
  if (!user) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Verify password
  const storedPassword = (user as any).password_hash as string | undefined;
  if (!storedPassword || !(await verifyPassword(password, storedPassword))) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  return c.json({ token: user.token, user: { id: user.id, email: user.email, plan: user.plan } });
});

// GET /api/auth/me — Get current user
authApp.get("/me", async (c) => {
  const token = c.req.header("x-auth-token");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const env = c.env;
  const user = await env.DB.prepare(USER_QUERIES.GET_WITH_SITE_COUNT)
    .bind(token)
    .first();

  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Strip sensitive fields before returning to client
  const { password_hash: _, token: _t, ...safeUser } = user as any;
  return c.json({ user: safeUser });
});

export { authApp as authRoutes };
