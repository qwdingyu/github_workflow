// SEO Guardian MCP Server
// Allows any MCP-compatible client (Claude Code, Cursor, Copilot, etc.)
// to call our SEO/GEO audit capabilities programmatically.
//
// Usage: npx @modelcontextprotocol/inspector build/mcp-server.js
// Or embed in any MCP-enabled application.
//
// This is a standalone entry point — NOT part of the Workers runtime.
// It calls the SEO Guardian API endpoints via HTTP.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "seo-guardian",
  version: "1.0.0",
});

// Configurable API base URL
const API_BASE = process.env.SEO_GUARDIAN_API || "https://api.seoguardian.dev";

// ─── Tool: Quick SEO Scan ─────────────────────────────────────────────
server.tool(
  "quick-seo-scan",
  "Perform a quick SEO scan on any URL. Returns score (0-100), issues, and AI summary.",
  {
    url: { type: "string", description: "The URL to scan" },
  },
  async ({ url }) => {
    const resp = await fetch(`${API_BASE}/api/scans/quick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok) throw new Error(`Scan failed: ${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
);

// ─── Tool: Full GEO Audit ─────────────────────────────────────────────
server.tool(
  "geo-audit",
  "Run a comprehensive GEO (Generative Engine Optimization) audit. Checks 9 dimensions: robots.txt AI bot access, llms.txt, Schema.org, meta/OG tags, content quality, E-E-A-T signals, brand entity, Princeton citation methods, and AI discovery endpoints.",
  {
    url: { type: "string", description: "The URL to audit" },
  },
  async ({ url }) => {
    const resp = await fetch(`${API_BASE}/api/geo/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok) throw new Error(`GEO audit failed: ${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
);

// ─── Tool: Generate llms.txt ──────────────────────────────────────────
server.tool(
  "generate-llms-txt",
  "Generate an llms.txt file for AI search engine discovery. llms.txt is the standard file that tells AI systems what your site is about.",
  {
    siteName: { type: "string", description: "Name of the website" },
    description: { type: "string", description: "Brief description of the site" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["title", "content"],
      },
      description: "Optional sections for the llms.txt file",
    },
    techStack: { type: "string", description: "Technology stack used" },
    version: { type: "string", description: "Site version" },
  },
  async (args) => {
    const resp = await fetch(`${API_BASE}/api/optimize/llms-txt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!resp.ok) throw new Error(`llms.txt generation failed: ${resp.status}`);
    const data = await resp.json();
    return {
      content: [
        { type: "text", text: `llms.txt generated for ${args.siteName}:\n\n\`\`\`markdown\n${data.content}\n\`\`\`\n\nSave this as \`llms.txt\` at your site root (e.g., https://example.com/llms.txt).` },
      ],
    };
  },
);

// ─── Tool: Check AI Bot Access ────────────────────────────────────────
server.tool(
  "check-ai-bots",
  "Check which AI bots can access a website via robots.txt. Checks 27 AI bots across 3 tiers: search (13), training (9), regional/assistant (5).",
  {
    url: { type: "string", description: "The website URL to check" },
  },
  async ({ url }) => {
    const resp = await fetch(`${API_BASE}/api/geo/bots?url=${encodeURIComponent(url)}`);
    if (!resp.ok) throw new Error(`Bot check failed: ${resp.status}`);
    const data = await resp.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
);

// ─── Tool: Generate Schema JSON-LD ────────────────────────────────────
server.tool(
  "generate-schema",
  "Generate Schema.org JSON-LD structured data. Supports: product, faq, breadcrumb, organization, howto, localbusiness, blogposting.",
  {
    type: {
      type: "string",
      enum: ["product", "faq", "breadcrumb", "organization", "howto", "localbusiness", "blogposting"],
      description: "Schema type to generate",
    },
    data: {
      type: "object",
      description: "Data for the schema (fields depend on type)",
    },
  },
  async ({ type, data }) => {
    const resp = await fetch(`${API_BASE}/api/optimize/schema/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!resp.ok) throw new Error(`Schema generation failed: ${resp.status}`);
    const result = await resp.json();
    return {
      content: [
        {
          type: "text",
          text: `Schema ${type} JSON-LD generated:\n\n\`\`\`json\n${result.code}\n\`\`\`\n\nAdd this <script> tag in your page <head>.`,
        },
      ],
    };
  },
);

// ─── Tool: Generate robots.txt AI Rules ───────────────────────────────
server.tool(
  "generate-robots-ai",
  "Generate robots.txt AI bot rules. Specify which AI bots to allow or block.",
  {
    allowedBots: {
      type: "array",
      items: { type: "string" },
      description: "AI bots to explicitly allow (e.g., ['GPTBot', 'PerplexityBot'])",
    },
    blockedBots: {
      type: "array",
      items: { type: "string" },
      description: "AI bots to block (e.g., ['CCBot', 'Bytespider'])",
    },
    sitemapUrl: { type: "string", description: "Sitemap URL to include" },
  },
  async (args) => {
    const resp = await fetch(`${API_BASE}/api/optimize/robots-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!resp.ok) throw new Error(`robots.txt generation failed: ${resp.status}`);
    const data = await resp.json();
    return {
      content: [
        {
          type: "text",
          text: `AI bot rules for robots.txt:\n\n\`\`\`\n${data.content}\n\`\`\`\n\nAdd these rules to your existing robots.txt file.`,
        },
      ],
    };
  },
);

// ─── Start server ─────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SEO Guardian MCP Server running on stdio");
}

main().catch((err) => {
  console.error("MCP Server crashed:", err);
  process.exit(1);
});
