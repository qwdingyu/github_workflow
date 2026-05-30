#!/bin/bash
# 权限验证脚本 — 验证常用命令不再弹授权，重点验证 rtk 命令
# 规范副本：0-X/0-AI工具/best_practices/verify_permissions.sh
# 用法：重启 Qwen Code 后，让 AI 运行 "bash scripts/verify_permissions.sh"
# 所有命令都应该无弹框直接执行，最后输出汇总

PASS=0
FAIL=0
RESULTS=""

run_test() {
  local label="$1"
  local cmd="$2"
  echo -n "  [$label] $cmd ... "
  OUTPUT=$(eval "$cmd" 2>&1)
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ PASS"
    RESULTS="$RESULTS\n  ✅ [$label] $cmd"
    PASS=$((PASS + 1))
  else
    echo "❌ FAIL (exit=$EXIT_CODE)"
    RESULTS="$RESULTS\n  ❌ [$label] $cmd (exit=$EXIT_CODE)"
    FAIL=$((FAIL + 1))
  fi
}

echo "═══════════════════════════════════════════════"
echo "  权限验证脚本 — $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════"

echo ""
echo "━━ 第一组：之前反复弹授权的命令 ━━"
run_test "head" "head -3 AGENTS.md"
run_test "tail" "tail -3 AGENTS.md"
run_test "wc" "wc -l AGENTS.md"
run_test "for循环" "for i in 1 2 3; do echo \$i; done"
run_test "if判断" "if [ -f AGENTS.md ]; then echo yes; fi"
run_test "while循环" "echo ok | while read line; do echo \$line; done"
run_test "case语句" "case test in test) echo match;; esac"
run_test "echo" "echo 'permission test'"
run_test "printf" "printf 'ok\n'"
run_test "sort" "echo -e 'b\na\nc' | sort"
run_test "uniq" "echo -e 'a\na\nb' | uniq"
run_test "awk" "echo 'hello' | awk '{print \$1}'"
run_test "xargs" "echo 'test' | xargs echo"
run_test "diff" "diff AGENTS.md AGENTS.md"

echo ""
echo "━━ 第二组：文件操作命令 ━━"
run_test "ls" "ls -la .qwen/"
run_test "cat" "cat .qwen/settings.json | head -3"
run_test "find" "find .qwen -name '*.json' -maxdepth 2"
run_test "grep" "grep 'rtk' AGENTS.md | head -1"
run_test "which" "which bash"
run_test "pwd" "pwd"
run_test "whoami" "whoami"
run_test "date" "date"

echo ""
echo "━━ 第三组：Git 命令（重点） ━━"
run_test "git status" "git status --short"
run_test "git log" "git log -1 --oneline"
run_test "git diff" "git diff --stat HEAD"
run_test "git branch" "git branch --show-current"

echo ""
echo "━━ 第四组：RTK 命令（最高优先级） ━━"
run_test "rtk git status" "rtk git status --short"
run_test "rtk git log" "rtk git log -1 --oneline"
run_test "rtk node" "rtk node -e 'console.log(\"rtk node ok\")'"
run_test "rtk npm ls" "rtk npm ls --depth=0 2>/dev/null | head -5"
run_test "rtk curl" "rtk curl -sS -o /dev/null -w '%{http_code}' https://www.baidu.com"
run_test "rtk curl|rg管道" "rtk curl -sS https://www.baidu.com 2>/dev/null | head -1 | cat"

echo ""
echo "━━ 第五组：Node/Python 构建工具 ━━"
run_test "node" "node -e 'console.log(\"node ok\")'"
run_test "npx" "npx -y cowsay moo 2>/dev/null | head -1"
run_test "python3" "python3 -c 'print(\"python3 ok\")'"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  汇总：✅ $PASS 通过  ❌ $FAIL 失败"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAIL -eq 0 ]; then
  echo ""
  echo "  🎉 全部通过！权限配置生效，无弹框。"
else
  echo ""
  echo "  ⚠️  有 $FAIL 个命令失败，请检查 .qwen/settings.json"
fi

echo ""
echo "  RTK 规则验证："
if grep -q "rtk" AGENTS.md 2>/dev/null; then
  echo "  ✅ AGENTS.md 包含 rtk 规则"
else
  echo "  ❌ AGENTS.md 缺少 rtk 规则"
fi

if grep -q "rtk" ../AGENTS.md 2>/dev/null; then
  echo "  ✅ 父级 AGENTS.md 包含 rtk 规则"
else
  echo "  ❌ 父级 AGENTS.md 缺少 rtk 规则"
fi
echo ""
