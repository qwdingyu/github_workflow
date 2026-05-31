<template>
  <div class="lookup-view">
    <div class="page-section">
      <div class="section-label">订单查询</div>
      <h1 class="section-title">找回交付结果</h1>
      <p class="hint-text">输入订单号、订单凭证、折扣码或邮箱查询。</p>
    </div>

    <div class="form-card">
      <form @submit.prevent="handleSubmit">
        <div class="form-field">
          <label class="form-label" for="lookup-token">订单号 / 凭证 / 折扣码 / 邮箱</label>
          <input
            id="lookup-token"
            v-model="token"
            type="text"
            placeholder="输入查询关键词"
            required
          />
        </div>

        <button class="btn btn-primary btn-full" type="submit" :disabled="loading">
          {{ loading ? '查询中…' : '查询' }}
        </button>
      </form>

      <!-- Results -->
      <div v-if="orders.length > 0" class="order-list">
        <div
          v-for="order in orders"
          :key="order.id"
          class="order-item"
        >
          <div class="order-header">
            <span class="order-id">{{ order.orderNo || order.id }}</span>
            <span class="status-badge" :class="`status-${order.status}`">
              {{ statusLabel(order.status) }}
            </span>
          </div>
          <div class="order-meta">
            <span>{{ order.productTitle }}</span>
            <span>{{ formatPrice(order.priceCents, order.currency) }}</span>
          </div>
          <!-- Delivery info -->
          <div v-if="order.delivery?.accountLabel" class="delivery-info">
            <div class="delivery-row">
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
          <div class="order-detail-link">
            <button class="btn btn-ghost btn-sm" @click="goToOrder(order.id)" type="button">查看订单详情 →</button>
          </div>
        </div>
      </div>

      <div v-else-if="error" class="result-box" :class="errorType">
        {{ error }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { lookupOrders } from '@/api'
import { copyText } from '@/composables/useClipboard'
import { formatPrice, statusLabel } from '@/composables/useFormat'
import type { Order } from '@/types'

const router = useRouter()
const token = ref('')
const loading = ref(false)
const orders = ref<Order[]>([])
const error = ref('')
const errorType = ref<'status-error' | 'status-info'>('status-error')

async function handleSubmit() {
  loading.value = true
  error.value = ''
  errorType.value = 'status-error'
  orders.value = []
  try {
    orders.value = await lookupOrders(token.value.trim())
    if (orders.value.length === 0) {
      error.value = '未找到相关订单，请检查输入的关键词'
      errorType.value = 'status-info'
    }
  } catch (err: any) {
    error.value = err.message || '查询失败，请稍后重试'
    errorType.value = 'status-error'
  } finally {
    loading.value = false
  }
}

function goToOrder(orderId: string) {
  router.push({ name: 'order', params: { id: orderId } })
}

</script>

<style scoped>
.lookup-view {
  max-width: 480px;
  margin: 0 auto;
}

.hint-text {
  margin-top: 6px;
  font-size: 14px;
  color: var(--tg-hint);
}

.btn-full {
  width: 100%;
  margin-top: 4px;
}

/* Order list */
.order-list {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.order-item {
  padding: 14px 16px;
  border-radius: var(--r-md);
  background: var(--surface);
  border: 0.5px solid var(--border);
}

.order-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.order-id {
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--tg-text);
}

.status-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--r-full);
}

.status-badge.status-issued {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.status-badge.status-paid {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.status-badge.status-pending {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.status-badge.status-expired,
.status-badge.status-failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.order-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--tg-hint);
}

.order-meta span:last-child {
  font-weight: 600;
  color: var(--tg-text);
}

.delivery-info {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 0.5px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.delivery-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
}

.delivery-label {
  color: var(--tg-hint);
  flex-shrink: 0;
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

/* Order detail link */
.order-detail-link {
  text-align: center;
  padding-top: 4px;
}

/* Result box */
.result-box {
  margin-top: 12px;
  padding: 12px 16px;
  border-radius: var(--r-md);
  font-size: 14px;
}

.result-box.status-error {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.result-box.status-info {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}
</style>
