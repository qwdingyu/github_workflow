// Optimization Routes — Schema Generator, llms.txt Generator, robots.txt AI Rules, OG Tags
// The "Fix Code Generator" that makes SEO Guardian a commercial product
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../index";
import {
  generateProductSchema,
  generateFaqSchema,
  generateBreadcrumbSchema,
  generateOrganizationSchema,
  generateHowToSchema,
  generateLocalBusinessSchema,
  generateBlogPostingSchema,
  generateLlmsTxt,
  generateRobotsAiRules,
  generateOgTags,
} from "../services/generator";

const optApp = new Hono<{ Bindings: Env }>();

// ─── Auth helper ──────────────────────────────────────────────────────────

interface User { id: string; email: string; plan: string; token: string; }

async function getUser(c: any): Promise<User | null> {
  const token = c.req.header("x-auth-token");
  if (!token) return null;
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE token = ?")
    .bind(token)
    .first();
  return (row as User) || null;
}

// ─── Schema Generators ────────────────────────────────────────────────────

// POST /api/optimize/schema/product — Generate Product JSON-LD
const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.string().url(),
  price: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.string().default("USD"),
  availability: z.string().optional(),
  brand: z.string().optional(),
  sku: z.string().optional(),
  reviewCount: z.string().optional(),
  ratingValue: z.string().optional(),
});

optApp.post("/schema/product", zValidator("json", productSchema), async (c) => {
  const data = c.req.valid("json");
  const code = generateProductSchema(data);
  return c.json({ code, preview: data });
});

// POST /api/optimize/schema/faq — Generate FAQPage JSON-LD
const faqSchema = z.object({
  questions: z.array(z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
  })).min(1),
});

optApp.post("/schema/faq", zValidator("json", faqSchema), async (c) => {
  const { questions } = c.req.valid("json");
  const code = generateFaqSchema(questions);
  return c.json({ code });
});

// POST /api/optimize/schema/breadcrumb — Generate BreadcrumbList JSON-LD
const breadcrumbSchema = z.object({
  items: z.array(z.object({
    name: z.string().min(1),
    url: z.string().url(),
  })).min(1),
});

optApp.post("/schema/breadcrumb", zValidator("json", breadcrumbSchema), async (c) => {
  const { items } = c.req.valid("json");
  const code = generateBreadcrumbSchema(items);
  return c.json({ code });
});

// POST /api/optimize/schema/organization — Generate Organization JSON-LD
const orgSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  logo: z.string().url().optional(),
  sameAs: z.array(z.string().url()).optional(),
  telephone: z.string().optional(),
  address: z.string().optional(),
});

optApp.post("/schema/organization", zValidator("json", orgSchema), async (c) => {
  const data = c.req.valid("json");
  const code = generateOrganizationSchema(data);
  return c.json({ code });
});

// POST /api/optimize/schema/howto — Generate HowTo JSON-LD
const howToSchema = z.object({
  name: z.string().min(1),
  steps: z.array(z.object({
    name: z.string().min(1),
    text: z.string().min(1),
    image: z.string().url().optional(),
  })).min(1),
  totalTime: z.string().optional(),
});

optApp.post("/schema/howto", zValidator("json", howToSchema), async (c) => {
  const data = c.req.valid("json");
  const code = generateHowToSchema(data);
  return c.json({ code });
});

// POST /api/optimize/schema/localbusiness — Generate LocalBusiness JSON-LD
const localBizSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  telephone: z.string().min(1),
  url: z.string().url().optional(),
  openingHours: z.array(z.string()).optional(),
});

optApp.post("/schema/localbusiness", zValidator("json", localBizSchema), async (c) => {
  const data = c.req.valid("json");
  const code = generateLocalBusinessSchema(data);
  return c.json({ code });
});

// POST /api/optimize/schema/blogposting — Generate BlogPosting JSON-LD
const blogSchema = z.object({
  headline: z.string().min(1),
  datePublished: z.string(),
  author: z.string().min(1),
  image: z.string().url(),
  description: z.string().optional(),
  dateModified: z.string().optional(),
});

optApp.post("/schema/blogposting", zValidator("json", blogSchema), async (c) => {
  const data = c.req.valid("json");
  const code = generateBlogPostingSchema(data);
  return c.json({ code });
});

// ─── llms.txt Generator ──────────────────────────────────────────────────

const llmsSchema = z.object({
  siteName: z.string().min(1),
  description: z.string().min(1),
  sections: z.array(z.object({
    title: z.string().min(1),
    content: z.string().min(1),
  })).optional(),
  techStack: z.string().optional(),
  version: z.string().optional(),
});

optApp.post("/llms-txt", zValidator("json", llmsSchema), async (c) => {
  const data = c.req.valid("json");
  const content = generateLlmsTxt(data);
  return c.json({ content, filename: "llms.txt" });
});

// ─── robots.txt AI Rules Generator ────────────────────────────────────────

const robotsAiSchema = z.object({
  allowedBots: z.array(z.string()),
  blockedBots: z.array(z.string()),
  sitemapUrl: z.string().url().optional(),
});

optApp.post("/robots-ai", zValidator("json", robotsAiSchema), async (c) => {
  const { allowedBots, blockedBots, sitemapUrl } = c.req.valid("json");
  const content = generateRobotsAiRules(allowedBots, blockedBots, sitemapUrl);
  return c.json({ content, filename: "robots.txt (AI rules section)" });
});

// ─── OG / Twitter Meta Tags Generator ─────────────────────────────────────

const ogSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  image: z.string().url(),
  url: z.string().url(),
  siteName: z.string().optional(),
  type: z.string().optional(),
});

optApp.post("/og-tags", zValidator("json", ogSchema), async (c) => {
  const data = c.req.valid("json");
  const code = generateOgTags(data);
  return c.json({ code });
});

// ─── Save generated code to optimization history (requires auth) ──────────

const saveOptSchema = z.object({
  siteId: z.string().uuid(),
  optimizationType: z.enum(["schema", "llms_txt", "robots_txt", "og_tags", "content"]),
  generatedCode: z.string(),
});

optApp.post("/save", zValidator("json", saveOptSchema), async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { siteId, optimizationType, generatedCode } = c.req.valid("json");

  // Verify site ownership
  const site = await c.env.DB.prepare(
    "SELECT id FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO optimizations (id, site_id, optimization_type, generated_code) VALUES (?, ?, ?, ?)"
  ).bind(id, siteId, optimizationType, generatedCode).run();

  return c.json({ success: true, id });
});

// ─── Get optimization history for a site ──────────────────────────────────

optApp.get("/history/:siteId", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const siteId = c.req.param("siteId");
  const site = await c.env.DB.prepare(
    "SELECT id FROM sites WHERE id = ? AND user_id = ?"
  ).bind(siteId, user.id).first();
  if (!site) return c.json({ error: "Site not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT optimization_type, generated_code, applied, created_at FROM optimizations WHERE site_id = ? ORDER BY created_at DESC"
  ).bind(siteId).all();

  return c.json({ optimizations: results || [] });
});

export { optApp as optRoutes };
