---
name: configure-ai-tool-rules
description: Configure command permissions and enforce coding rules across multiple AI coding tools (Qwen Code, Codex, AtomCode, Hermes) using AGENTS.md and settings.json
source: auto-skill
extracted_at: '2026-05-29T12:51:08.633Z'
---

# Configure AI Tool Rules

When working with multiple AI coding tools in the same project, you need a unified approach to (1) suppress repetitive permission prompts and (2) enforce coding rules (like mandatory command prefixes) across ALL tools.

## When to Use

- You're using 2+ AI coding tools (Qwen Code, Codex, AtomCode, Hermes, etc.) on the same project
- You're getting repetitive "Allow execution of: X?" permission prompts
- You want to enforce project-wide rules (e.g., `rtk` command prefix) across all AI tools
- Rules written in `docs/` are being ignored by AI tools

## Critical Insight: Where AI Tools Read Rules

**AI coding tools ONLY auto-load instruction files from project root and parent directories — they do NOT read `docs/` or other subdirectories.**

| AI Tool | Instruction File | Auto-loaded? |
|---------|-----------------|--------------|
| Qwen Code | `AGENTS.md` (root + parent dirs) | ✅ Yes |
| Codex (OpenAI) | `AGENTS.md` (root + parent dirs) | ✅ Yes |
| Hermes | `AGENTS.md` (root + parent dirs) | ✅ Yes |
| AtomCode | `AGENTS.md` (root + parent dirs) | ✅ Yes |
| Claude Code | `CLAUDE.md` (root + parent dirs) | ✅ Yes (different file) |
| Cursor | `.cursorrules` or `.cursor/rules/*.mdc` | ✅ Yes (different file) |

**Key takeaway**: If you write rules only in `docs/xxx.md`, NO AI tool will enforce them. Rules MUST live in `AGENTS.md` at root/parent level.

## Part 1: Command Permission Configuration (Qwen Code)

### Problem
Even after selecting "Always allow for this user", the permission prompt keeps appearing for the same commands.

### Root Cause
Qwen Code's user-level `~/.qwen/settings.json` may contain invalid/stale entries (e.g., shell output accidentally captured as permission rules like `Bash(检测器)` or `Bash(文件)`).

### Solution: Project-Level settings.json

Create `.qwen/settings.json` at the project root with explicit allow/deny lists:

```json
{
  "permissions": {
    "allow": [
      "Bash(cat *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Bash(wc *)",
      "Bash(ls *)",
      "Bash(find *)",
      "Bash(grep *)",
      "Bash(rg *)",
      "Bash(sed *)",
      "Bash(awk *)",
      "Bash(sort *)",
      "Bash(uniq *)",
      "Bash(diff *)",
      "Bash(xargs *)",
      "Bash(echo *)",
      "Bash(printf *)",
      "Bash(mkdir *)",
      "Bash(cp *)",
      "Bash(mv *)",
      "Bash(chmod *)",
      "Bash(touch *)",
      "Bash(which *)",
      "Bash(whoami)",
      "Bash(pwd)",
      "Bash(date *)",
      "Bash(env)",
      "Bash(for *)",
      "Bash(if *)",
      "Bash(while *)",
      "Bash(do *)",
      "Bash(then)",
      "Bash(else)",
      "Bash(elif *)",
      "Bash(fi)",
      "Bash(done)",
      "Bash(break)",
      "Bash(continue)",
      "Bash(case *)",
      "Bash(esac)",
      "Bash(git *)",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(node *)",
      "Bash(python *)",
      "Bash(python3 *)",
      "Bash(pip *)",
      "Bash(pip3 *)",
      "Bash(curl *)",
      "Bash(wget *)",
      "Bash(jq *)",
      "Bash(gh *)",
      "Bash(timeout *)",
      "Bash(source *)",
      "Bash(true)",
      "Bash(false)",
      "Bash(bash *)",
      "Bash(sh *)",
      "Agent(Explore)",
      "Agent(general-purpose)",
      "WebSearch",
      "WebFetch(*)"
    ],
    "deny": [
      "Bash(rm -rf /)",
      "Bash(rm -rf ~*)",
      "Bash(sudo *)",
      "Bash(chown *)",
      "Bash(killall -9 *)",
      "Bash(dd *)",
      "Bash(mkfs *)",
      "Bash(fdisk *)"
    ]
  }
}
```

### Best Practices for Permission Settings

1. **Bash keywords need explicit entries**: `for`, `if`, `while`, `do`, `then`, `fi`, `done`, `case`, `esac` — these are bash builtins that must be individually allowed
2. **Use wildcards**: `Bash(git *)` covers all git subcommands
3. **Deny list is explicit**: Only truly dangerous commands (`rm -rf /`, `sudo`, `dd`, `mkfs`)
4. **Allow `rm *` but deny `rm -rf /`**: Regular `rm` for file cleanup is safe; only mass deletion is blocked
5. **Project-level overrides user-level**: Project `.qwen/settings.json` takes precedence

### Cleaning Up Stale User-Level Settings

Check `~/.qwen/settings.json` for invalid entries like:
```json
"Bash(检测器)"          // ❌ Shell output, not a command
"Bash(文件)"            // ❌ Chinese text, not a command  
"Bash(壁厚不均检测)"     // ❌ Accidentally captured output
"Bash(104 *)"           // ❌ Line number, not a command
```

Remove all such entries. Only keep actual command patterns.

## Part 2: Cross-Tool Rule Enforcement via AGENTS.md

### Problem
Rules documented only in `docs/` directory are invisible to AI tools at startup.

### Solution: Hierarchical AGENTS.md

```
parent-dir/AGENTS.md           ← Universal rules (inherited by ALL sub-projects)
project-root/AGENTS.md         ← Project-specific rules
```

### Parent-Level AGENTS.md Template

Place at the workspace root (e.g., `/Users/user/projects/AGENTS.md`):

```markdown
# AGENTS.md - 核心工作规则

## -1. 命令前缀（强制 · 最高优先级）

所有涉及 git / npm / npx / node / curl / docker / wrangler / gh 等命令，必须添加 `rtk` 前缀。

### 正确示范
rtk git status --short
rtk npm install
rtk curl -sS -I https://example.com/

### 禁止示范
# ❌ 缺少 rtk
git push origin main
npm run dev

### 豁免命令（无需 rtk）
纯本地读取类：ls、pwd、cat、head、tail、wc、find、grep/rg（仅文件搜索时）
```

### Project-Level AGENTS.md Template

Place at the project root:

```markdown
# AGENTS.md - Project-Specific Rules

## 1. Command Prefix (Enforced)
All shell commands MUST use `rtk` prefix. See parent AGENTS.md for details.

## 2. Commit Convention
- commit message 必须使用中文
- 格式：`rtk git commit -m "<中文原因>"`

## 3. Project Iron Rules
(List project-specific rules here)
```

## Part 3: Handling Claude Code / Cursor (Non-AGENTS.md Tools)

If you also use Claude Code or Cursor, they read different files. Create reference files:

```bash
# For Claude Code — symlink or copy AGENTS.md content
ln -s AGENTS.md CLAUDE.md

# For Cursor — create .cursorrules referencing AGENTS.md
echo "# See AGENTS.md for project rules" > .cursorrules
```

## Debugging Checklist

When rules aren't being enforced:

1. **Is the file in the right place?** Must be at project root or parent dir, NOT in `docs/`
2. **Is the filename correct?** `AGENTS.md` (not `agents.md` or `Agents.md`)
3. **Is the rule clear and prominent?** Put critical rules at the TOP with a high-priority section number like `## -1.`
4. **Are there conflicting entries?** Check both parent and project-level files
5. **For permission prompts**: Check `~/.qwen/settings.json` for stale/invalid entries; create project-level `.qwen/settings.json`
6. **Does the tool actually read AGENTS.md?** Verify with: Qwen Code ✅, Codex ✅, Hermes ✅, AtomCode ✅, Claude Code ❌ (uses CLAUDE.md), Cursor ❌ (uses .cursorrules)

## Summary: The 3-Layer Approach

```
Layer 1: AGENTS.md (parent dir)
  → Universal rules inherited by ALL projects
  → Covers: rtk prefix, commit conventions, safety rules

Layer 2: AGENTS.md (project root)  
  → Project-specific rules
  → Covers: project iron rules, specific tooling, naming conventions

Layer 3: .qwen/settings.json (project root)
  → Command permission allow/deny lists
  → Covers: suppress permission prompts, block dangerous commands
```
