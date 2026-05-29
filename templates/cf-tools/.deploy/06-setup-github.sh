#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# 06-setup-github.sh — GitHub Actions + Secrets + Variables 全自动配置
#
# 功能：
#   1. 安装 CI/CD workflows（deploy + cleanup + backup）
#   2. 推送所有 Secrets 到 GitHub
#   3. 设置 Variables
#   4. 触发首次部署
#
# 输入：gh CLI 已登录 + .credentials/ 下的所有凭证
# ═══════════════════════════════════════════════════════════════════════════════
source "$(dirname "$0")/shared.sh"

PROJECT_NAME=$(cred_load "PROJECT_NAME" 2>/dev/null || basename "$(pwd)")
GITHUB_REPO=$(cred_load "GITHUB_REPO" 2>/dev/null || echo "")

if [ -z "$GITHUB_REPO" ]; then
  GH_USER=$(gh api user -q '.login' 2>/dev/null)
  GITHUB_REPO="${GH_USER}/${PROJECT_NAME}"
fi

WORKER_NAME=$(cred_load "WORKER_NAME" 2>/dev/null || echo "$PROJECT_NAME")
DOMAIN=$(cred_load "DOMAIN" 2>/dev/null || echo "")

banner "GitHub Actions: $GITHUB_REPO"

if step_check "06-setup-github"; then
  log_ok "已完成，跳过"
  exit 0
fi

gh_check || exit 1

# ── Step 1: 安装 CI/CD Workflows ─────────────────────────────────────────────
log_step "Step 1/4: 安装 CI/CD Workflows"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_DIR=".github/workflows"
mkdir -p "$WORKFLOW_DIR"

# 复制标准化 workflows
for wf in deploy.yml cleanup-schedule.yml backup-daily.yml; do
  src="${SCRIPT_DIR}/workflows/${wf}"
  dst="${WORKFLOW_DIR}/${wf}"
  if [ -f "$src" ]; then
    # 替换模板变量
    sed -e "s/{{WORKER_NAME}}/${WORKER_NAME}/g" \
        -e "s/{{PROJECT_NAME}}/${PROJECT_NAME}/g" \
        -e "s/{{DOMAIN}}/${DOMAIN:-${WORKER_NAME}.workers.dev}/g" \
        "$src" > "$dst"
    log_ok "Workflow: $wf"
  else
    log_warn "Workflow 模板不存在: $src"
  fi
done

# ── Step 2: 推送 Secrets ─────────────────────────────────────────────────────
log_step "Step 2/4: 推送 Secrets 到 GitHub"

# Cloudflare API Token
gh_set_secret "$GITHUB_REPO" "CLOUDFLARE_API_TOKEN" "$CLOUDFLARE_API_TOKEN"

# Turso
TURSO_URL=$(cred_load "TURSO_URL" 2>/dev/null || echo "")
TURSO_TOKEN=$(cred_load "TURSO_TOKEN" 2>/dev/null || echo "")
[ -n "$TURSO_URL" ] && gh_set_secret "$GITHUB_REPO" "TURSO_URL" "$TURSO_URL"
[ -n "$TURSO_TOKEN" ] && gh_set_secret "$GITHUB_REPO" "TURSO_TOKEN" "$TURSO_TOKEN"

# 项目 Secrets
for secret_name in ADMIN_TOKEN RATE_LIMIT_SALT JWT_SECRET CREDENTIALS_ENCRYPTION_KEY TURNSTILE_SECRET_KEY; do
  value=$(cred_load "$secret_name" 2>/dev/null || echo "")
  [ -n "$value" ] && gh_set_secret "$GITHUB_REPO" "$secret_name" "$value"
done

# 加载项目特有的 secrets
for f in .credentials/[A-Z]*; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  case "$name" in
    TURSO_URL|TURSO_TOKEN|ADMIN_TOKEN|RATE_LIMIT_SALT|JWT_SECRET|CREDENTIALS_ENCRYPTION_KEY|TURNSTILE_SECRET_KEY) continue ;;
    GITHUB_REPO|PROJECT_NAME|DB_NAME|WORKER_NAME|BASE_URL|DOMAIN|TURNSTILE_SITE_KEY) continue ;;
    .deploy-progress) continue ;;
  esac
  value=$(cat "$f")
  [ -n "$value" ] && gh_set_secret "$GITHUB_REPO" "$name" "$value"
done

# ── Step 3: 设置 Variables ───────────────────────────────────────────────────
log_step "Step 3/4: 设置 Variables"

gh_set_variable "$GITHUB_REPO" "WORKER_NAME" "$WORKER_NAME"
[ -n "$DOMAIN" ] && gh_set_variable "$GITHUB_REPO" "APP_DOMAIN" "$DOMAIN"
[ -n "$DOMAIN" ] && gh_set_variable "$GITHUB_REPO" "BIND_DOMAIN" "true"
gh_set_variable "$GITHUB_REPO" "APP_ORIGIN" "https://${DOMAIN:-${WORKER_NAME}.workers.dev}"

# ── Step 4: 提交并触发部署 ────────────────────────────────────────────────────
log_step "Step 4/4: 提交 Workflows 并触发首次部署"

git add "$WORKFLOW_DIR/"
if git diff --cached --quiet 2>/dev/null; then
  log_ok "Workflows 无变更"
else
  git commit -m "ci: 添加 GitHub Actions 部署流水线"
  git push
  log_ok "Workflows 已推送，GitHub Actions 将自动触发部署"
fi

step_done "06-setup-github"

echo ""
log_ok "✅ GitHub Actions 配置完成"
echo "  仓库: https://github.com/$GITHUB_REPO"
echo "  Actions: https://github.com/$GITHUB_REPO/actions"
echo ""
log_info "查看部署状态: gh run watch --repo $GITHUB_REPO"
