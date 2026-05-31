#!/usr/bin/env bash
# ============================================================
# AcctBox EShop 冒烟测试 — 验证核心 API 端点的基本可用性
#
# 用法:
#   export ESHOP_ORIGIN="https://eshop.eforge.xyz"   # 目标环境
#   export TURNSTILE_TOKEN="..."                       # 可选：Turnstile token
#   bash scripts/smoke.sh
#
# 依赖: curl, jq (JSON 解析)
# ============================================================

set -euo pipefail

ORIGIN="${ESHOP_ORIGIN:-http://localhost:8787}"
PASS=0
FAIL=0
FAILURES=()

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

check() {
  local name="$1" status="$2"
  if [ "$status" = "PASS" ]; then
    echo -e "  ${GREEN}✓${NC} $name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $name"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name")
  fi
}

echo "============================================"
echo " AcctBox EShop 冒烟测试"
echo " Target: $ORIGIN"
echo "============================================"
echo ""

# ── Health ────────────────────────────────────────
echo "▶ 1. Health Check"
HEALTH=$(curl -sf "$ORIGIN/api/health" 2>&1 || true)
echo "$HEALTH" | jq -e '.ok == true' >/dev/null 2>&1 \
  && check "GET /api/health" PASS \
  || { check "GET /api/health" FAIL; echo "   resp: $HEALTH"; }

# ── Products ──────────────────────────────────────
echo "▶ 2. Products"
PRODUCTS=$(curl -sf "$ORIGIN/api/products" 2>&1 || true)
echo "$PRODUCTS" | jq -e '.ok == true and (.products | length) > 0' >/dev/null 2>&1 \
  && check "GET /api/products (has products)" PASS \
  || { check "GET /api/products (has products)" FAIL; echo "   resp: $PRODUCTS"; }

# 获取第一个商品的 ID
PROD_ID=$(echo "$PRODUCTS" | jq -r '.products[0].id' 2>/dev/null || echo "")

PROD=$(curl -sf "$ORIGIN/api/products/$PROD_ID" 2>&1 || true)
echo "$PROD" | jq -e '.ok == true and .product.id == "'"$PROD_ID"'"' >/dev/null 2>&1 \
  && check "GET /api/products/$PROD_ID (single product)" PASS \
  || { check "GET /api/products/$PROD_ID (single product)" FAIL; echo "   resp: $PROD"; }

# ── Coupon Quote ──────────────────────────────────
echo "▶ 3. Coupon Quote"
QUOTE=$(curl -sf -X POST "$ORIGIN/api/coupons/quote" \
  -H "Content-Type: application/json" \
  -d '{"productId":"'"$PROD_ID"'","couponCode":""}' 2>&1 || true)
echo "$QUOTE" | jq -e '.ok == true and (.priceCents | type == "number")' >/dev/null 2>&1 \
  && check "POST /api/coupons/quote (no coupon)" PASS \
  || { check "POST /api/coupons/quote (no coupon)" FAIL; echo "   resp: $QUOTE"; }

# ── Create Order (无 coupon, 有 productId) ────────
echo "▶ 4. Create Order (with productId only)"
ORDER_RESP=$(curl -sf -X POST "$ORIGIN/api/orders" \
  -H "Content-Type: application/json" \
  -d '{"productId":"'"$PROD_ID"'","buyerEmail":"smoke@test.com","couponCode":"","turnstileToken":""}' 2>&1 || true)
echo "$ORDER_RESP" | jq -e '.ok == true and .order.status == "pending"' >/dev/null 2>&1 \
  && check "POST /api/orders (productId only) → pending" PASS \
  || { check "POST /api/orders (productId only) → pending" FAIL; echo "   resp: $ORDER_RESP"; }

# 拿到 order token 用于后续查单
ORDER_TOKEN=$(echo "$ORDER_RESP" | jq -r '.order.orderToken // ""' 2>/dev/null || echo "")
ORDER_NO=$(echo "$ORDER_RESP" | jq -r '.order.orderNo // ""' 2>/dev/null || echo "")

# ── Create Order (coupon 不存在) ─────────────────
echo "▶ 5. Create Order with non-existent coupon"
BAD_COUPON=$(curl -sf -X POST "$ORIGIN/api/orders" \
  -H "Content-Type: application/json" \
  -d '{"buyerEmail":"smoke@test.com","couponCode":"DOESNOTEXIST","turnstileToken":""}' 2>&1 || true)
echo "$BAD_COUPON" | jq -e '.ok == false and .error == "折扣码不存在"' >/dev/null 2>&1 \
  && check "POST /api/orders (bad coupon) → 折扣码不存在" PASS \
  || { check "POST /api/orders (bad coupon) → 折扣码不存在" FAIL; echo "   resp: $BAD_COUPON"; }

# ── Create Order (无 productId, 无 coupon) ────────
echo "▶ 6. Create Order without productId and coupon"
NO_PROD=$(curl -sf -X POST "$ORIGIN/api/orders" \
  -H "Content-Type: application/json" \
  -d '{"buyerEmail":"smoke@test.com","couponCode":"","turnstileToken":""}' 2>&1 || true)
echo "$NO_PROD" | jq -e '.ok == false and .error == "请选择商品"' >/dev/null 2>&1 \
  && check "POST /api/orders (no product, no coupon) → 请选择商品" PASS \
  || { check "POST /api/orders (no product, no coupon) → 请选择商品" FAIL; echo "   resp: $NO_PROD"; }

# ── Lookup Order by token ─────────────────────────
if [ -n "$ORDER_TOKEN" ]; then
  echo "▶ 7. Lookup Order by token"
  LOOKUP=$(curl -sf "$ORIGIN/api/orders/lookup?token=$ORDER_TOKEN" 2>&1 || true)
  echo "$LOOKUP" | jq -e '.ok == true and .order.id != null' >/dev/null 2>&1 \
    && check "GET /api/orders/lookup?token=..." PASS \
    || { check "GET /api/orders/lookup?token=..." FAIL; echo "   resp: $LOOKUP"; }
fi

# ── Lookup Order by orderNo ───────────────────────
if [ -n "$ORDER_NO" ]; then
  echo "▶ 8. Lookup Order by orderNo"
  LOOKUP_NO=$(curl -sf "$ORIGIN/api/orders/lookup?orderNo=$ORDER_NO&turnstileToken=test" 2>&1 || true)
  echo "$LOOKUP_NO" | jq -e '.ok == true and .order.orderNo == "'"$ORDER_NO"'"' >/dev/null 2>&1 \
    && check "GET /api/orders/lookup?orderNo=..." PASS \
    || { check "GET /api/orders/lookup?orderNo=..." FAIL; echo "   resp: $LOOKUP_NO"; }
fi

# ── Summary ───────────────────────────────────────
echo ""
echo "============================================"
if [ "$FAIL" -eq 0 ]; then
  echo -e " ${GREEN}全部通过${NC}"
  echo -e " ${GREEN}${PASS}/${PASS} 项测试通过${NC}"
  echo "============================================"
  exit 0
else
  echo -e " ${RED}${FAIL} 项失败:${NC}"
  for f in "${FAILURES[@]}"; do
    echo -e " ${RED}  ✗ $f${NC}"
  done
  echo -e " ${GREEN}${PASS} 通过${NC} | ${RED}${FAIL} 失败${NC}"
  echo "============================================"
  exit 1
fi
