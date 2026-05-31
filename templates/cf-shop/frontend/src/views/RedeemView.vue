<template>
  <div class="redeem-view">
    <div class="page-section">
      <div class="section-label">折扣码</div>
      <h1 class="section-title">兑换折扣码</h1>
    </div>

    <div class="form-card">
      <form @submit.prevent="handleSubmit">
        <div class="form-field">
          <label class="form-label" for="redeem-code">折扣码</label>
          <input
            id="redeem-code"
            v-model="code"
            type="text"
            placeholder="输入折扣码"
            autocomplete="one-time-code"
            required
          />
        </div>

        <div class="form-field">
          <label class="form-label" for="redeem-email">邮箱</label>
          <input
            id="redeem-email"
            v-model="email"
            type="email"
            placeholder="输入邮箱（用于接收卡密）"
            required
          />
        </div>

        <!-- Turnstile -->
        <Turnstile container-id="turnstile-container" />

        <button class="btn btn-primary btn-full" type="submit" :disabled="submitting">
          {{ submitting ? '兑换中…' : '使用折扣码' }}
        </button>
      </form>

      <div v-if="result" class="result-box" :class="resultType">
        {{ result }}
      </div>

      <!-- Delivery info after successful redeem -->
      <div v-if="delivery" class="delivery-info">
        <h3 class="delivery-title">卡密信息</h3>
        <div v-if="delivery.accountLabel" class="delivery-row">
          <span class="delivery-label">卡号</span>
          <span class="delivery-value">{{ delivery.accountLabel }}</span>
          <button class="btn-copy" @click="copyText(delivery.accountLabel!, $event)" type="button" title="复制卡号">📋</button>
        </div>
        <div v-if="delivery.deliverySecret" class="delivery-row">
          <span class="delivery-label">密码</span>
          <span class="delivery-value">{{ delivery.deliverySecret }}</span>
          <button class="btn-copy" @click="copyText(delivery.deliverySecret!, $event)" type="button" title="复制密码">📋</button>
        </div>
        <div v-if="delivery.deliveryNote" class="delivery-row">
          <span class="delivery-label">备注</span>
          <span class="delivery-value">{{ delivery.deliveryNote }}</span>
          <button class="btn-copy" @click="copyText(delivery.deliveryNote!, $event)" type="button" title="复制备注">📋</button>
        </div>
      </div>

      <div v-if="resultType === 'status-success'" class="redeem-guide">
        <p>兑换完成后，可以在订单查询中查看交付状态。</p>
        <RouterLink to="/lookup" class="btn btn-ghost">去查询订单 →</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Turnstile from '@/components/Turnstile.vue'
import { redeemCoupon } from '@/api'
import { useTurnstile } from '@/composables/useTurnstile'
import { copyText } from '@/composables/useClipboard'

const code = ref('')
const email = ref('')
const submitting = ref(false)
const result = ref('')
const resultType = ref('')
const delivery = ref<{ accountLabel?: string; deliverySecret?: string; deliveryNote?: string } | null>(null)
const { getResponse, reset } = useTurnstile()

async function handleSubmit() {
  submitting.value = true
  result.value = ''
  resultType.value = ''
  try {
    const token = getResponse()
    const res = await redeemCoupon({
      couponCode: code.value.trim(),
      buyerEmail: email.value.trim(),
      turnstileToken: token || undefined,
    })
    if (res.delivery) {
      delivery.value = res.delivery
      resultType.value = 'status-success'
      result.value = `兑换成功！卡密已发送到 ${email.value}`
    } else {
      delivery.value = null
      resultType.value = 'status-success'
      result.value = '兑换成功！'
    }
    code.value = ''
    email.value = ''
    reset()
  } catch (err: any) {
    reset()
    resultType.value = 'status-error'
    result.value = err.message || '兑换失败，请检查折扣码和邮箱'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.redeem-view {
  max-width: 480px;
  margin: 0 auto;
}

.btn-full {
  width: 100%;
  margin-top: 4px;
}

/* Delivery info */
.delivery-info {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 0.5px solid var(--border);
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

.redeem-guide {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 0.5px solid var(--border);
  text-align: center;
}

.redeem-guide p {
  font-size: 14px;
  color: var(--tg-hint);
  margin-bottom: 8px;
}
</style>
