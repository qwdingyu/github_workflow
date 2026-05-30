---
name: organize-project-documentation
description: Reorganize a large corpus of project documents into a numbered category system with archive, index, and no numbering conflicts
source: auto-skill
extracted_at: '2026-05-29T15:00:52.979Z'
---

# Organize Project Documentation

When a project accumulates 30+ documentation files with ad-hoc naming, numbering conflicts, and mixed categories, reorganize them into a structured, numbered, categorized system.

## When to Use

- `docs/` directory has 30+ files with inconsistent naming
- Numbering conflicts exist (e.g., two files both numbered `001_`)
- Project-specific docs are mixed with cross-cutting docs
- No index or navigation structure
- Users can't find documents quickly

## Step 1: Audit Current State

Read ALL files in the docs directory and classify each one:

```bash
# List all doc files
ls docs/*.md docs/*.txt 2>/dev/null | wc -l

# For each file, read first 5 lines to determine topic
for f in docs/*.md; do head -5 "$f"; echo "---"; done
```

Classify each file into categories:

| Category | Code | Typical content |
|----------|------|----------------|
| Deployment & Operations | 100-199 | CI/CD, platform config, security |
| Architecture & Design | 200-299 | System design, shared library, technical decisions |
| Audit & Review | 300-399 | Code audits, architecture reviews |
| Pitfall Records | 400-499 | Deployment bugs, lessons learned |
| Planning & Proposals | 500-599 | Technology selection, project proposals |
| Standards & Templates | 600-699 | Coding standards, templates, iron rules |
| Business & Strategy | 700-799 | SEO/GEO analysis, monetization, market research |

## Step 2: Identify and Archive Project-Specific Docs

Documents that belong to a specific sub-project (not cross-cutting) should be archived, not deleted. They already exist in the sub-project's own `docs/` directory.

```bash
mkdir -p docs/_archive

# Move project-specific docs (e.g., AcctBox-specific docs that duplicate eshop/docs/)
mv docs/029_AcctBox*.md docs/_archive/
mv docs/030_AcctBox*.md docs/_archive/
# ... etc
```

**Decision criteria for archiving:**
- Document is specific to ONE sub-project AND that sub-project has its own `docs/` directory
- Document duplicates content already in a sub-project
- Document is a historical implementation record, not a cross-cutting reference

## Step 3: Resolve Numbering Conflicts

Find all conflicts where two files share the same number prefix:

```bash
ls docs/*.md | sed 's/^docs\///' | grep -oP '^\d+' | sort | uniq -d
```

For each conflict, reassign one file to a different number in its category range.

## Step 4: Rename Files to Category Numbering

```bash
# Deployment & Operations → 100-199
mv "001_CloudflarePages部署能力分析_2026-05-24.md" "100_Cloudflare_Pages部署能力分析.md"

# Architecture → 200-299
mv "028_CFFormKit微型框架落地方案_2026-05-25.md" "200_CFFormKit微型框架落地方案.md"

# Pitfalls → 400-499
mv "049_xshop端到端部署踩坑记录_2026-05-29.md" "402_xshop端到端部署踩坑记录.md"

# Standards → 600-699
mv "000-铁律.txt" "600_铁律.txt"
mv "046_批量产品标准化架构方案_三项目横向对比_2026-05-29.md" "602_批量产品标准化架构方案_三项目横向对比.md"
```

**Naming convention:**
- `{number}_{Title}.md` — underscore separator, no date suffix in filename
- Date goes inside the document header, not the filename
- Numbers are stable — don't renumber after initial assignment

## Step 5: Create README Index

Create `docs/README.md` as the navigation hub:

```markdown
# Project Documentation Index

## Numbering System

| Range | Category | Count |
|-------|----------|-------|
| 100-199 | Deployment & Operations | 19 |
| 200-299 | Architecture & Design | 2 |
| 400-499 | Pitfall Records | 3 |
| 500-599 | Planning & Proposals | 4 |
| 600-699 | Standards & Templates | 4 |
| 700-799 | Business & Strategy | 1 |

## Quick Navigation

**New user?** Start with:
1. `600_铁律.txt` → project rules
2. `603_产品模板使用指南.md` → how to create new projects
3. `402_xshop端到端部署踩坑记录.md` → what can go wrong

**Creating a new project?**
1. `602_批量产品标准化架构方案.md` → architecture overview
2. `603_产品模板使用指南.md` → template usage
3. `.deploy/one-click.sh` → one-click deploy
```

Include a section for each category listing all documents with one-line descriptions.

## Step 6: Verify Integrity

After reorganization, verify:

```bash
# 1. No numbering conflicts remain
ls docs/*.md docs/*.txt | sed 's/^docs\///' | grep -oP '^\d+' | sort | uniq -d
# Should output nothing

# 2. Count active vs archived docs
echo "Active: $(ls docs/*.md docs/*.txt 2>/dev/null | wc -l)"
echo "Archived: $(ls docs/_archive/ 2>/dev/null | wc -l)"

# 3. All cross-references still valid
grep -rh "docs/[0-9]" docs/ packages/*/docs/ | grep -oP 'docs/\d+[^ )"]*' | sort -u
```

## Step 7: Commit as Single Atomic Change

```bash
git add docs/
git commit -m "docs: reorganize into numbered category system

- Establish 3-digit numbering (100-799 by category)
- Archive 18 project-specific docs to _archive/
- Rename 32 active docs with new numbers
- Create README.md index with quick navigation
- Resolve 5 numbering conflicts (001/034/037/038/039)"
```

## Key Lessons Learned

1. **Archive, don't delete** — project-specific docs may be needed for historical reference; `_archive/` keeps them accessible but out of the main index
2. **Date in content, not filename** — `602_批量产品标准化架构方案.md` is better than `046_批量产品标准化架构方案_三项目横向对比_2026-05-29.md`; the date goes in the document header
3. **Three-digit numbers scale** — 100-199 gives you 100 slots per category; two-digit (01-99) runs out fast
4. **README is the UX** — without a good index, organized docs are still hard to navigate; the "Quick Navigation" section is the most important part
5. **Sub-project docs stay in sub-projects** — `eshop/docs/`, `xtools/docs/`, `vcode/docs/` keep their own docs; the root `docs/` only has cross-cutting documents
6. **Naming conflicts are inevitable** at scale — always check `uniq -d` after initial numbering
7. **Atomic commit** — reorganize everything in one commit; partial reorganizations cause confusion

## Anti-Patterns

- **Don't nest docs in subdirectories by category** — flat structure with numbered prefixes is easier to browse and grep
- **Don't use dates in filenames** — they make files harder to reference and sort
- **Don't mix project-specific and cross-cutting docs** — archive project-specific ones
- **Don't create a separate index file per category** — one README with sections is enough for <100 docs
- **Don't renumber after initial assignment** — stable numbers enable reliable cross-references

## References

- Example implementation: `docs/` (33 active + 18 archived, 7 categories)
- Sub-project docs: `eshop/docs/` (62), `xtools/docs/` (24), `vcode/docs/` (26), `packages/cf-core/docs/` (13)
- Related skill: `audit-cross-project-consistency` (Audit 5: documentation accuracy)
