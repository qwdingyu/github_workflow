#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# test-one-click-modes.sh — one-click.sh 部署模式逻辑测试
#
# 测试三种模式下哪些步骤应该执行/跳过
# 不实际执行部署，只验证 should_run_check 逻辑
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHARED_SH="$(cd "$SCRIPT_DIR/.." && pwd)/shared.sh"
PASS=0
FAIL=0
TOTAL=0

assert_mode_steps() {
  local desc="$1" mode="$2"
  shift 2
  local expected_active="$*"

  TOTAL=$((TOTAL + 1))

  # 模拟 one-click.sh 的 should_run_check 逻辑
  local active_steps=""
  for step in 00 01 02 03 04 05 06; do
    local should_run=false
    case "$step" in
      00|03) should_run=true ;;
      01|02) [ "$mode" != "pages" ] && should_run=true ;;
      04) should_run=true ;;  # SKIP_DOMAIN not set in test
      05) [ "$mode" != "pages" ] && should_run=true ;;
      06) should_run=true ;;  # SKIP_GITHUB not set in test
    esac
    if $should_run; then
      active_steps="$active_steps $step"
    fi
  done
  active_steps=$(echo "$active_steps" | xargs)  # trim

  if [ "$active_steps" = "$expected_active" ]; then
    echo "  ✅ $desc → [$active_steps]"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"
    echo "     期望: [$expected_active]"
    echo "     实际: [$active_steps]"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  one-click.sh 部署模式逻辑测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "━━━ workers 模式（默认）━━━"
assert_mode_steps "workers: 全部步骤激活" "workers" "00 01 02 03 04 05 06"

echo ""
echo "━━━ pages 模式 ━━━"
assert_mode_steps "pages: 跳过 01/02/05" "pages" "00 03 04 06"

echo ""
echo "━━━ hybrid 模式 ━━━"
assert_mode_steps "hybrid: 全部步骤激活" "hybrid" "00 01 02 03 04 05 06"

# ── 验证 .deploy-mode 文件检测 ──
echo ""
echo "━━━ .deploy-mode 文件检测 ━━━"

TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT
cd "$TEST_DIR"
source "$SHARED_SH"

# workers 模板（无 .deploy-mode 文件）
TOTAL=$((TOTAL + 1))
result=$(detect_deploy_mode)
if [ "$result" = "workers" ]; then
  echo "  ✅ 无 .deploy-mode → workers"
  PASS=$((PASS + 1))
else
  echo "  ❌ 无 .deploy-mode → 期望 workers, 实际 $result"
  FAIL=$((FAIL + 1))
fi

# cf-static 模板（.deploy-mode = pages）
echo "pages" > .deploy-mode
TOTAL=$((TOTAL + 1))
result=$(detect_deploy_mode)
if [ "$result" = "pages" ]; then
  echo "  ✅ .deploy-mode=pages → pages"
  PASS=$((PASS + 1))
else
  echo "  ❌ .deploy-mode=pages → 期望 pages, 实际 $result"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  测试结果: $PASS/$TOTAL 通过, $FAIL 失败"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ "$FAIL" -gt 0 ] && exit 1 || echo "✅ 全部通过！"
