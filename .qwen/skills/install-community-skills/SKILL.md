---
name: install-community-skills
description: Discover, evaluate, and install community agent skills from skills.sh ecosystem for any project tech stack
source: auto-skill
extracted_at: '2026-05-29T13:04:06.976Z'
---

# Install Community Skills

Systematic workflow for discovering, evaluating quality, and installing community agent skills from the [skills.sh](https://skills.sh/) ecosystem to extend AI coding tools (Qwen Code, Codex, Hermes, Claude Code, etc.).

## When to Use

- Setting up a new project and want AI tools to have domain-specific knowledge
- Adding new tech stack components (frameworks, ORMs, testing tools) that need AI expertise
- User asks "what skills are available for X?" or "install skills for our stack"
- Improving AI output quality for a specific technology (Vue, Hono, Drizzle, etc.)

## Workflow

### Step 1: Identify the Project Tech Stack

Before searching, determine the exact technologies in use:

```bash
# Check package.json for dependencies
cat package.json | grep -E '"(dependencies|devDependencies)"' -A 50

# Check for framework config files
ls wrangler.toml vite.config.* tsconfig.json drizzle.config.*
```

Build a checklist like:
- Runtime: Cloudflare Workers / Node.js / Bun
- Framework: Hono / Express / Fastify
- Frontend: Vue 3 / React / Svelte
- ORM: Drizzle / Prisma
- Testing: Vitest / Jest / Playwright
- Language: TypeScript / Python / Go

### Step 2: Search for Skills

```bash
# Search by keyword
npx -y skills@latest find <keyword> 2>&1 | head -30

# Examples:
npx -y skills@latest find vue
npx -y skills@latest find hono
npx -y skills@latest find drizzle
npx -y skills@latest find vitest
npx -y skills@latest find typescript
npx -y skills@latest find "frontend design"
npx -y skills@latest find "code review testing"
```

**Note**: First run downloads the CLI (~5s). Use `head -30` to truncate output.

### Step 3: Evaluate Quality (CRITICAL)

**Never install a skill based on search results alone.** Apply these filters:

| Criterion | Threshold | Why |
|-----------|-----------|-----|
| Install count | **1K+ preferred**, 100+ acceptable, <100 risky | Low installs = untested/poor quality |
| Source reputation | Prefer official authors | `antfu/skills` (Vue core team), `yusukebe/hono-skill` (Hono author), `mattpocock/skills` (TS expert) |
| Skill freshness | Check if repo still active | Some repos restructure and skill names change |

### Step 4: Install Skills

```bash
# Global install (available to all projects)
npx -y skills@latest add <owner/repo@skill-name> -g -y 2>&1 | tail -10

# Project-level install (only this project)
npx -y skills@latest add <owner/repo@skill-name> -y 2>&1 | tail -10
```

**Global install (`-g`) is recommended** for tech stack skills you use across projects.

### Step 5: Verify Installation

Skills install to `~/.agents/skills/<name>/` and auto-sync to `~/.qwen/skills/<name>/`:

```bash
ls ~/.agents/skills/
ls ~/.qwen/skills/
```

Both directories should show the new skill.

## Recommended Skills by Tech Stack

### TypeScript / Node.js Backend

| Skill | Command | Installs | Purpose |
|-------|---------|----------|---------|
| `mattpocock/skills@diagnose` | `add mattpocock/skills@diagnose -g -y` | 152K | Systematic debugging |
| `mattpocock/skills@improve-codebase-architecture` | `add mattpocock/skills@improve-codebase-architecture -g -y` | 186K | Architecture refactoring |

**Note on TDD**: `mattpocock/skills@tdd` (177K installs) was evaluated and removed — TDD is too heavy for personal/small projects. Use `diagnose` + regular unit tests (Vitest) instead. Only install TDD if the user explicitly requests it.

### Vue 3 Frontend

| Skill | Command | Installs | Purpose |
|-------|---------|----------|---------|
| `antfu/skills@vue` | `add antfu/skills@vue -g -y` | 24K | Vue 3 Composition API best practices (by Vue core team member) |

### Hono Framework

| Skill | Command | Installs | Purpose |
|-------|---------|----------|---------|
| `yusukebe/hono-skill@hono` | `add yusukebe/hono-skill@hono -g -y` | 7K | Hono routing, middleware, testing (by Hono author) |

### Drizzle ORM

| Skill | Command | Installs | Purpose |
|-------|---------|----------|---------|
| `secondsky/claude-skills@drizzle-orm-d1` | `add secondsky/claude-skills@drizzle-orm-d1 -g -y` | 232 | Drizzle ORM + D1/libSQL patterns |

### Go (Golang)

| Skill | Command | Installs | Purpose |
|-------|---------|----------|---------|
| `samber/cc-skills-golang@golang-code-style` | `add samber/cc-skills-golang@golang-code-style -g -y` | 3.9K | Go idiomatic code style |
| `samber/cc-skills-golang@golang-design-patterns` | `add samber/cc-skills-golang@golang-design-patterns -g -y` | 3.6K | Go design patterns |
| `samber/cc-skills-golang@golang-performance` | `add samber/cc-skills-golang@golang-performance -g -y` | 3.8K | Go performance optimization |

### .NET / C#

| Skill | Command | Installs | Purpose |
|-------|---------|----------|---------|
| `sickn33/antigravity-awesome-skills@dotnet-architect` | `add sickn33/antigravity-awesome-skills@dotnet-architect -g -y` | 317 | .NET architecture patterns |
| `novotnyllc/dotnet-artisan@dotnet-csharp` | `add novotnyllc/dotnet-artisan@dotnet-csharp -g -y` | 164 | C# language conventions |

### Python

| Skill | Command | Installs | Purpose |
|-------|---------|----------|---------|
| `dagster-io/skills@dignified-python` | `add dagster-io/skills@dignified-python -g -y` | 1.5K | Python engineering practices (by Dagster team) |

### Frontend Design

| Skill | Command | Installs | Purpose |
|-------|---------|----------|---------|
| `anthropics/skills@frontend-design` | browse skills.sh (very large) | 476K | UI/UX design guidelines |
| `leonxlnx/taste-skill@design-taste-frontend` | already installed locally | 87K | Design taste & aesthetics |

## Pitfalls

1. **Repo restructuring breaks skill names**: `bobmatnyc/claude-mpm-skills@drizzle-orm` was renamed/moved — search result showed 4.3K installs but install failed with "No matching skills found". Always use the latest search results.

2. **Timeout on first run**: `npx skills` downloads the CLI on first use. If it times out, retry with `npx -y skills@latest`.

3. **Global vs project install**: Use `-g` for skills you use everywhere (TypeScript, testing). Skip `-g` for project-specific skills.

4. **Skills auto-activate**: Once installed, skills activate automatically when the AI detects relevant imports (e.g., `import { Hono } from 'hono'` triggers the Hono skill). No manual invocation needed, but you can also call them explicitly: `/hono`, `/vue`, `/tdd`.

5. **Review before trusting**: Skills run with full agent permissions. Always read the SKILL.md after installation to verify it's safe and useful.

## Quick Reference: Full Setup for a New Project

```bash
# 1. Analyze tech stack
cat package.json

# 2. Install core skills (adjust based on stack)

# --- Core (always useful) ---
npx -y skills@latest add mattpocock/skills@diagnose -g -y
npx -y skills@latest add mattpocock/skills@improve-codebase-architecture -g -y

# --- Vue 3 Frontend ---
npx -y skills@latest add antfu/skills@vue -g -y

# --- Hono Backend ---
npx -y skills@latest add yusukebe/hono-skill@hono -g -y

# --- Drizzle ORM ---
npx -y skills@latest add secondsky/claude-skills@drizzle-orm-d1 -g -y

# --- Go ---
npx -y skills@latest add samber/cc-skills-golang@golang-code-style -g -y
npx -y skills@latest add samber/cc-skills-golang@golang-design-patterns -g -y
npx -y skills@latest add samber/cc-skills-golang@golang-performance -g -y

# --- .NET / C# ---
npx -y skills@latest add sickn33/antigravity-awesome-skills@dotnet-architect -g -y
npx -y skills@latest add novotnyllc/dotnet-artisan@dotnet-csharp -g -y

# --- Python ---
npx -y skills@latest add dagster-io/skills@dignified-python -g -y

# 3. Verify
ls ~/.agents/skills/
```
