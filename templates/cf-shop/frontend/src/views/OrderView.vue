<template>
  <div class="order-view">
    <div class="page-section">
      <div class="section-label">订单结果</div>
      <h1 class="section-title">订单详情</h1>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="skeleton-card">
      <div class="skeleton skeleton-line w-70" />
      <div class="skeleton skeleton-line w-40" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="result-box status-error">
      {{ error }}
    </div>

    <!-- Order result -->
    <div v-else-if="order" class="order-result">
      <div class="result-status" :class="`result-${order.status}`">
        <span class="result-icon">{{ statusIcon }}</span>
        <span class="result-title">{{ statusText }}</span>
      </div>

      <div class="order-meta-box">
        <div class="meta-row">
          <span class="meta-label">订单号</span>
          <span class="meta-value">{{ order.orderNo || order.id }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">商品</span>
          <span class="meta-value">{{ order.productTitle }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">金额</span>
          <span class="meta-value">{{ formatPrice(order.amountCents, order.currency) }}</span>
        </div>
      </div>

      <!-- Delivery info -->
      <div v-if="order.delivery && order.status === 'issued'" class="delivery-box">
        <h3 class="delivery-title">卡密信息</h3>
        <div v-if="order.delivery.accountLabel" class="delivery-row">
          <span class="delivery-label">卡号</span>
          <span class="delivery-value">{{ order.delivery.accountLabel }}</span>
          <button class="btn-copy" @click="copyText(order.delivery.accountLabel!, $event)" type="button" title="复制卡号">📋</button>
        </div>
        <div v-if="order.delivery.deliverySecret" class="delivery-row">
          <span class="delivery-label">密码</span>
          <span class="delivery-value">{{ order.delivery.deliverySecret }}</span>
          <button class="btn-copy" @click="copyText(order.delivery.deliverySecret!, $event)" type="button" title="复制密码">📋</button>
        </div>
        <div v-if="order.delivery.deliveryNote" class="delivery-row">
          <span class="delivery-label">备注</span>
          <span class="delivery-value">{{ order.delivery.deliveryNote }}</span>
          <button class="btn-copy" @click="copyText(order.delivery.deliveryNote!, $event)" type="button" title="复制备注">📋</button>
        </div>
      </div>

      <div class="step-actions">
        <RouterLink to="/shop" class="btn btn-primary">返回首页</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getPayStatus } from '@/api'
import { copyText } from '@/composables/useClipboard'
import { formatPrice } from '@/composables/useFormat'
import type { Order } from '@/types'

const route = useRoute()
const loading = ref(true)
const error = ref('')
const order = ref<Order | null>(null)

const statusText = computed(() => {
  if (!order.value) return ''
  const map: Record<string, string> = {
    pending: '待支付',
    paid: '已支付，正在发卡…',
    issued: '已交付',
    expired: '已过期',
    failed: '失败',
  }
  return map[order.value.status] || order.value.status
})

const statusIcon = computed(() => {
  if (!order.value) return '⟳'
  const icons: Record<string, string> = {
    pending: '⟳',
    paid: '⏳',
    issued: '✓',
    expired: '⏰',
    failed: '✕',
  }
  return icons[order.value.status] || '⟳'
})



async function loadOrder() {
  const orderId = route.query.orderId as string
  const token = route.query.token as string
  if (!orderId || !token) {
    error.value = '缺少订单信息'
    loading.value = false
    return
  }
  try {
    const res = await getPayStatus(orderId, token)
    order.value = {
      id: res.orderId,
      orderNo: res.orderNo || '',
      productId: '',
      productTitle: (res as any).productTitle || '',
      priceCents: (res as any).amountCents || 0,
      amountCents: (res as any).amountCents || 0,
      currency: (res as any).currency || 'CNY',
      status: res.status as Order['status'],
      delivery: res.delivery,
      createdAt: '',
    }
  } catch (err: any) {
    error.value = err.message || '查询订单失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadOrder)
</script>

<style scoped>
.order-view {
  max-width: 480px;
  margin: 0 auto;
}

.skeleton-card {
  padding: 16px;
  border-radius: var(--r-lg);
  background: var(--tg-secondary-bg);
}

.skeleton-line {
  height: 16px;
  margin-bottom: 12px;
}

.skeleton-line.w-70 { width: 70%; }
.skeleton-line.w-40 { width: 40%; }

.order-result {
  text-align: center;
}

.result-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  border-radius: var(--r-lg);
  margin-bottom: 20px;
  font-size: 18px;
  font-weight: 600;
}

.result-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--r-full);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.result-status.result-issued {
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
}

.result-status.result-paid {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}

.result-status.result-pending {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.result-status.result-expired,
.result-status.result-failed {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.order-meta-box {
  text-align: left;
  padding: 14px 16px;
  background: var(--surface);
  border-radius: var(--r-md);
  margin-bottom: 16px;
}

.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 14px;
}

.meta-label {
  color: var(--tg-hint);
}

.meta-value {
  font-weight: 500;
  font-family: var(--font-mono);
}

.delivery-box {
  text-align: left;
  padding: 14px 16px;
  background: var(--surface);
  border-radius: var(--r-md);
  margin-bottom: 16px;
}

.delivery-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
}

.delivery-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 0;
  font-size: 14px;
}

.delivery-label {
  color: var(--tg-hint);
  flex-shrink: 0;
  min-width: 32px;
}

.delivery-value {
  font-family: var(--font-mono);
  font-weight: 500;
  word-break: break-all;
}

/* Copy button */
.btn-copy {
  flex-shrink: 0;
  padding: 2px 6px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  transition: background var(--duration-fast) var(--ease-out);
}

.btn-copy:hover {
  background: var(--surface-hover);
}

.step-actions {
  margin-top: 20px;
}
</style>
