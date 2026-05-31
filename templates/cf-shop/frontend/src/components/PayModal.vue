<template>
  <Teleport to="body">
    <transition name="pay-fade">
      <div v-if="isVisible" class="pay-overlay" @click.self="handleOverlayClick">
        <transition name="pay-slide">
          <div class="pay-box" :class="boxClass">
            <!-- Close button (H5 only; Telegram uses BackButton) -->
            <button v-if="!isTelegram" class="pay-close" type="button" @click="handleClose">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>

            <!-- Step indicator -->
            <div class="step-indicator">
              <span
                v-for="s in steps"
                :key="s.id"
                class="step-dot"
                :class="{ active: step === s.id, done: doneSteps.has(s.id) }"
              />
            </div>

            <!-- ═══ Step 1: Order Form ═══ -->
            <div v-show="step === 'form'" class="pay-step-content">
              <div class="step-header">
                <div class="step-label">下单</div>
                <h2 class="step-title">确认订单</h2>
              </div>

              <!-- Product summary -->
              <div class="order-summary">
                <div class="summary-cover">
                  <img v-if="product.coverUrl" :src="product.coverUrl" :alt="product.title" />
                  <span v-else class="summary-icon">&#x1F4E6;</span>
                </div>
                <div class="summary-info">
                  <div class="summary-title">{{ product.title }}</div>
                  <div class="summary-price">
                    {{ formatPrice(product.priceCents, product.currency) }}
                  </div>
                </div>
              </div>

              <!-- Coupon -->
              <div class="coupon-row">
                <input
                  v-model="couponCode"
                  type="text"
                  placeholder="折扣码（选填）"
                  autocomplete="off"
                />
                <button
                  class="btn btn-secondary btn-sm"
                  type="button"
                  :disabled="verifyingCoupon || !couponCode.trim()"
                  @click="verifyCoupon"
                >
                  {{ verifyingCoupon ? '验证中' : '验证' }}
                </button>
              </div>
              <div v-if="couponMsg" class="coupon-msg" :class="couponValid ? 'valid' : 'invalid'">
                {{ couponMsg }}
              </div>

              <!-- Email -->
              <div class="form-field">
                <input
                  v-model="email"
                  type="email"
                  placeholder="邮箱（必填，用于接收卡密）"
                />
              </div>

              <!-- Turnstile -->
              <Turnstile container-id="pay-turnstile" />

              <!-- Submit -->
              <button
                class="btn btn-primary btn-full"
                type="button"
                :disabled="submitting"
                @click="handleSubmit"
              >
                {{ submitting ? '提交中…' : '去支付' }}
              </button>
              <div v-if="formError" class="form-error">{{ formError }}</div>
            </div>

            <!-- ═══ Step 2: Online Payment ═══ -->
            <div v-show="step === 'online'" class="pay-step-content">
              <div class="step-header">
                <div class="step-label">在线支付</div>
                <h2 class="step-title">{{ providerDisplayName }}扫码支付</h2>
              </div>

              <div class="pay-amount">
                <span>应付金额</span>
                <strong>{{ formatPrice(unifiedAmountCents, product.currency) }}</strong>
              </div>

              <div class="qr-wrapper">
                <img
                  v-if="qrUrl"
                  :src="qrUrl"
                  alt="支付二维码"
                  class="qr-image"
                />
                <div v-else class="qr-placeholder skeleton">加载中…</div>
              </div>

              <p class="pay-hint">{{ onlineStatus }}</p>
              <p v-if="onlineTimer" class="pay-timer">{{ onlineTimer }}</p>

              <div class="step-actions">
                <button class="btn btn-ghost" type="button" @click="goBack">返回</button>
              </div>
            </div>

            <!-- ═══ Step 3: Offline Payment ═══ -->
            <div v-show="step === 'offline'" class="pay-step-content">
              <div class="step-header">
                <div class="step-label">线下付款</div>
                <h2 class="step-title">扫码付款</h2>
              </div>

              <div class="pay-amount">
                <span>应付金额</span>
                <strong>{{ formatPrice(unifiedAmountCents, product.currency) }}</strong>
              </div>

              <!-- QR codes -->
              <div class="offline-qr-row">
                <div class="qr-item">
                  <img v-if="wechatQr" :src="wechatQr" alt="微信收款码" />
                  <span class="qr-label">微信</span>
                </div>
                <div class="qr-item">
                  <img v-if="alipayQr" :src="alipayQr" alt="支付宝收款码" />
                  <span class="qr-label">支付宝</span>
                </div>
              </div>

              <!-- Note code -->
              <div v-if="offlineNoteCode" class="note-section">
                <div class="note-row">
                  <span>付款备注</span>
                  <code class="note-code">{{ offlineNoteCode }}</code>
                </div>
                <p class="note-hint">转账时请在「备注/附言」中完整输入上方号码</p>
              </div>

              <p class="pay-hint">请扫码付款，完成后点击下方按钮</p>

              <!-- Confirm section -->
              <div class="confirm-section">
                <div class="confirm-divider" />
                <p class="confirm-title">确认付款</p>
                <p class="confirm-desc">请输入付款流水号/转账单号的后 4 位数字</p>
                <div class="confirm-input-row">
                  <input
                    v-model="refLast4"
                    type="text"
                    inputmode="numeric"
                    maxlength="4"
                    pattern="[0-9]{4}"
                    placeholder="例：1234"
                    autocomplete="one-time-code"
                  />
                  <button
                    class="btn btn-primary btn-sm"
                    type="button"
                    :disabled="confirming || refLast4.length !== 4"
                    @click="handleConfirmOffline"
                  >
                    {{ confirming ? '核对中' : '确认' }}
                  </button>
                </div>
                <p v-if="confirmError" class="confirm-error">{{ confirmError }}</p>
                <p v-if="offlineConfirmStatus" class="pay-hint" style="margin-top:8px">{{ offlineConfirmStatus }}</p>
              </div>

              <div class="step-actions">
                <button class="btn btn-ghost" type="button" @click="goBack">返回</button>
              </div>
            </div>

            <!-- ═══ Step 4: Result ═══ -->
            <div v-show="step === 'result'" class="pay-step-content">
              <div class="step-header">
                <div class="step-label">支付结果</div>
                <h2 class="step-title">支付结果</h2>
              </div>

              <div class="result-content">
                <div class="result-status" :class="`result-${resultStatus}`">
                  <span class="result-icon">{{ resultIcon }}</span>
                  <span class="result-title">{{ resultTitle }}</span>
                </div>

                <!-- Delivery info -->
                <div v-if="resultDelivery" class="delivery-box">
                  <div v-if="resultDelivery.cardNo" class="delivery-row">
                    <span class="delivery-label">卡号</span>
                    <span class="delivery-value">{{ resultDelivery.cardNo }}</span>
                    <button class="btn-copy" @click="copyText(resultDelivery.cardNo!, $event)" type="button" title="复制卡号">📋</button>
                  </div>
                  <div v-if="resultDelivery.password" class="delivery-row">
                    <span class="delivery-label">密码</span>
                    <span class="delivery-value">{{ resultDelivery.password }}</span>
                    <button class="btn-copy" @click="copyText(resultDelivery.password!, $event)" type="button" title="复制密码">📋</button>
                  </div>
                  <div v-if="resultDelivery.note" class="delivery-row">
                    <span class="delivery-label">备注</span>
                    <span class="delivery-value">{{ resultDelivery.note }}</span>
                    <button class="btn-copy" @click="copyText(resultDelivery.note!, $event)" type="button" title="复制备注">📋</button>
                  </div>
                </div>

                <p v-if="resultDesc" class="result-desc">{{ resultDesc }}</p>
                <div v-if="resultStatus === 'success' && unifiedPayData" class="order-link-row">
                  <RouterLink
                    :to="{ name: 'order', query: { orderId: unifiedPayData.orderId, token: unifiedPayData.orderToken } }"
                    class="btn btn-ghost"
                    target="_blank"
                  >
                    查看订单详情 →
                  </RouterLink>
                </div>
              </div>

              <div class="step-actions">
                <button class="btn btn-primary btn-full" type="button" @click="handleClose">
                  完成
                </button>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import Turnstile from '@/components/Turnstile.vue'
import { usePlatform } from '@/composables/usePlatform'
import { useTelegram } from '@/composables/useTelegram'
import { useTurnstile } from '@/composables/useTurnstile'
import { usePayment } from '@/composables/usePayment'
import { unifiedPay, getPayStatus, confirmOfflinePay, verifyCoupon as apiVerifyCoupon } from '@/api'
import { copyText } from '@/composables/useClipboard'
import { formatPrice } from '@/composables/useFormat'

const { isTelegram, isMobile } = usePlatform()
const { showBackButton, hideBackButton } = useTelegram()
const { getResponse, resetModalTurnstile } = useTurnstile()

const {
  isVisible, step, setStep, product, email, couponCode, couponValid, couponDiscount,
  close,
} = usePayment()

// ── Derived state ──

const steps = [{ id: 'form' }, { id: 'online' }, { id: 'offline' }, { id: 'result' }]
const stepIndex = computed(() => steps.findIndex(s => s.id === step.value))
const doneSteps = computed(() => {
  const done = new Set<string>()
  for (let i = 0; i < stepIndex.value; i++) done.add(steps[i].id)
  return done
})

const boxClass = computed(() => ({
  'box-sheet': isTelegram.value || isMobile.value,
  'box-dialog': !(isTelegram.value || isMobile.value),
}))

/** 线上支付方式显示名称 */
const PROVIDER_LABELS: Record<string, string> = {
  alipay: '支付宝',
  payjs: 'PayJS',
  stripe: 'Stripe',
}
const providerName = ref('')
const providerDisplayName = computed(() => PROVIDER_LABELS[providerName.value] || '')

/** 统一支付返回的应付金额 */
const unifiedAmountCents = computed(() => unifiedPayData.value?.amountCents ?? product.value.priceCents)

// ── 统一下单后本地订单状态 ──

interface LocalOrderState {
  orderId: string
  orderToken: string
  amountCents: number
  currency: string
}

const unifiedPayData = ref<LocalOrderState | null>(null)

// ── Step 1: Form ──

const verifyingCoupon = ref(false)
const couponMsg = ref('')
const submitting = ref(false)
const formError = ref('')

async function verifyCoupon() {
  if (!couponCode.value.trim()) return
  verifyingCoupon.value = true
  couponMsg.value = ''
  try {
    const res = await apiVerifyCoupon(couponCode.value.trim(), product.value.id)
    if (res.valid) {
      couponValid.value = true
      couponDiscount.value = res.discountCents || 0
      couponMsg.value = `折扣码有效，优惠 ¥${((res.discountCents || 0) / 100).toFixed(2)}`
    } else {
      couponValid.value = false
      couponDiscount.value = 0
      couponMsg.value = res.message || '折扣码无效'
    }
  } catch (err: any) {
    couponValid.value = false
    couponDiscount.value = 0
    couponMsg.value = err.message || '验证失败'
  } finally {
    verifyingCoupon.value = false
  }
}

async function handleSubmit() {
  formError.value = ''
  if (!email.value.trim()) {
    formError.value = '请输入邮箱'
    return
  }

  submitting.value = true
  try {
    const token = getResponse()
    const res = await unifiedPay({
      productId: product.value.id,
      buyerEmail: email.value.trim(),
      couponCode: couponCode.value.trim() || undefined,
      turnstileToken: token || undefined,
    })

    // 保存统一支付返回的核心数据
    unifiedPayData.value = {
      orderId: res.orderId,
      orderToken: res.orderToken,
      amountCents: res.amountCents,
      currency: res.currency,
    }

    if (res.mode === 'online') {
      // 线上支付：保存 provider 名称，保存 QR，进入 online 步骤
      providerName.value = res.provider || ''
      qrUrl.value = res.qrcode || ''
      setStep('online')
      startPolling()
    } else {
      // 线下支付：保存收款码和备注码
      wechatQr.value = res.wechatQr || ''
      alipayQr.value = res.alipayQr || ''
      offlineNoteCode.value = res.offlineNoteCode || ''
      setStep('offline')
      // 启动线下倒计时
      offlinePollStartTime = Date.now()
      offlineTickTimer = setInterval(() => {
        if (!offlinePollStartTime) return
        const remaining = OFFLINE_TIMEOUT_MS - (Date.now() - offlinePollStartTime)
        if (remaining <= 0) {
          stopPolling()
          showResult('error', '支付超时', '订单已过期，请重新下单')
        } else {
          offlineTimer.value = `剩余 ${formatCountdown(remaining)}`
        }
      }, 1000)
    }
  } catch (err: any) {
    formError.value = err.message || '下单失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

// ── Step 2: Online Payment ──

const qrUrl = ref('')
const onlineStatus = ref('请扫码支付，支付完成后自动跳转')
const onlineTimer = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null
let timerTick: ReturnType<typeof setInterval> | null = null
let pollStartTime: number | null = null

/** 线上支付超时：5 分钟 */
const ONLINE_TIMEOUT_MS = 5 * 60 * 1000
/** 线下支付超时：30 分钟（与后端订单过期一致） */
const OFFLINE_TIMEOUT_MS = 30 * 60 * 1000

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function startPolling() {
  if (!unifiedPayData.value) return
  pollStartTime = Date.now()
  // 状态轮询：每 3 秒
  pollTimer = setInterval(async () => {
    try {
      const res = await getPayStatus(unifiedPayData.value!.orderId, unifiedPayData.value!.orderToken)
      if (res.status === 'issued' && res.delivery) {
        stopPolling()
        showResult('success', '支付成功', '卡密已发放', res.delivery)
      } else if (res.status === 'paid') {
        onlineStatus.value = '支付已确认，正在发卡…'
      } else if (res.status === 'expired' || res.status === 'failed') {
        stopPolling()
        showResult('error', '支付失败', res.status === 'expired' ? '订单已过期' : '支付处理失败')
      }
    } catch {
      // keep polling
    }
  }, 3000)
  // 倒计时显示：每 1 秒更新
  timerTick = setInterval(() => {
    if (!pollStartTime) return
    const remaining = ONLINE_TIMEOUT_MS - (Date.now() - pollStartTime)
    if (remaining <= 0) {
      stopPolling()
      showResult('error', '支付超时', '订单已过期，请重新下单')
    } else {
      onlineTimer.value = `剩余 ${formatCountdown(remaining)}`
    }
  }, 1000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (timerTick) {
    clearInterval(timerTick)
    timerTick = null
  }
  if (offlineTickTimer) {
    clearInterval(offlineTickTimer)
    offlineTickTimer = null
  }
  onlineTimer.value = ''
  offlineTimer.value = ''
}

// ── Step 3: Offline Payment ──

const wechatQr = ref('')
const alipayQr = ref('')
const offlineNoteCode = ref('')
const confirming = ref(false)
const refLast4 = ref('')
const confirmError = ref('')
const offlineConfirmStatus = ref('')
const offlineTimer = ref('')
let offlinePollStartTime: number | null = null
let offlineTickTimer: ReturnType<typeof setInterval> | null = null

async function handleConfirmOffline() {
  if (!unifiedPayData.value || refLast4.value.length !== 4) return
  confirming.value = true
  confirmError.value = ''
  try {
    await confirmOfflinePay({
      orderId: unifiedPayData.value.orderId,
      orderToken: unifiedPayData.value.orderToken,
      payRefLast4: refLast4.value,
    })
    offlineConfirmStatus.value = '已提交确认，等待管理员核对…'
    startPolling()
  } catch (err: any) {
    confirmError.value = err.message || '确认失败'
  } finally {
    confirming.value = false
  }
}

// ── Step 4: Result ──

const resultStatus = ref('')
const resultTitle = ref('')
const resultDesc = ref('')
const resultDelivery = ref<{ cardNo?: string; password?: string; note?: string } | null>(null)

function showResult(type: string, title: string, desc: string, deliveryData?: { accountLabel?: string; deliverySecret?: string; deliveryNote?: string }) {
  resultStatus.value = type
  resultTitle.value = title
  resultDesc.value = desc
  if (deliveryData) {
    resultDelivery.value = {
      cardNo: deliveryData.accountLabel,
      password: deliveryData.deliverySecret,
      note: deliveryData.deliveryNote,
    }
  }
  setStep('result')
}

const resultIcon = computed(() => {
  const icons: Record<string, string> = {
    success: '✓',
    error: '✕',
    pending: '⟳',
    warning: '⚠',
  }
  return icons[resultStatus.value] || '⟳'
})

// ── Navigation ──

function goBack() {
  stopPolling()
  setStep('form')
  qrUrl.value = ''
  onlineTimer.value = ''
  onlineStatus.value = '请扫码支付，支付完成后自动跳转'
  offlineConfirmStatus.value = ''
  unifiedPayData.value = null
  wechatQr.value = ''
  alipayQr.value = ''
  offlineNoteCode.value = ''
  refLast4.value = ''
  confirmError.value = ''
  formError.value = ''
}

function handleOverlayClick() {
  if (step.value === 'online' || step.value === 'offline') {
    // Telegram 中 confirm 不可用，直接关闭
    if (isTelegram.value) {
      handleClose()
    } else if (confirm('支付尚未完成，确定要关闭吗？')) {
      handleClose()
    }
  }
}

function handleClose() {
  stopPolling()
  if (isTelegram.value) {
    hideBackButton()
  }
  close()
  qrUrl.value = ''
  onlineStatus.value = '请扫码支付，支付完成后自动跳转'
  onlineTimer.value = ''
  formError.value = ''
  couponMsg.value = ''
  offlineConfirmStatus.value = ''
  unifiedPayData.value = null
  resetModalTurnstile()
}

// Show/hide Telegram BackButton
watch([isVisible, step], ([vis, s]) => {
  if (isTelegram.value && vis && s !== 'result') {
    showBackButton(() => {
      if (s === 'form') {
        handleClose()
      } else {
        goBack()
      }
    })
  }
  if (!vis) {
    hideBackButton()
  }
})

onUnmounted(() => {
  stopPolling()
})


</script>

<style scoped>
/* ── Overlay ── */
.pay-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.box-dialog {
  align-self: center;
  width: 460px;
  max-height: 85vh;
  border-radius: var(--r-xl);
}

.box-sheet {
  width: 100%;
  max-height: 85vh;
  border-radius: var(--r-xl) var(--r-xl) 0 0;
}

.pay-box {
  background: var(--tg-bg);
  padding: 20px 16px;
  padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  position: relative;
  box-shadow: var(--shadow-lg);
}

/* ── Close button ── */
.pay-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--r-full);
  background: var(--surface);
  color: var(--tg-hint);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast);
}

.pay-close:hover {
  background: var(--surface-hover);
  color: var(--tg-text);
}

/* ── Step indicator ── */
.step-indicator {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 20px;
}

.step-dot {
  width: 20px;
  height: 3px;
  border-radius: 2px;
  background: var(--surface-hover);
  transition: all var(--duration-normal) var(--ease-out);
}

.step-dot.active {
  background: var(--tg-btn);
  width: 28px;
}

.step-dot.done {
  background: #22c55e;
}

/* ── Step content ── */
.pay-step-content {
  animation: fadeInUp var(--duration-normal) var(--ease-out);
}

.step-header {
  margin-bottom: 20px;
}

.step-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--tg-hint);
  margin-bottom: 2px;
}

.step-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

/* ── Order summary ── */
.order-summary {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--surface);
  border-radius: var(--r-md);
  margin-bottom: 16px;
}

.summary-cover {
  width: 56px;
  height: 56px;
  border-radius: var(--r-sm);
  overflow: hidden;
  flex-shrink: 0;
  background: var(--surface-hover);
  display: flex;
  align-items: center;
  justify-content: center;
}

.summary-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.summary-icon {
  font-size: 24px;
}

.summary-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.summary-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.summary-price {
  font-size: 16px;
  font-weight: 700;
  color: var(--tg-btn);
}

/* ── Coupon ── */
.coupon-row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.coupon-row input {
  flex: 1;
}

.coupon-row .btn-sm {
  flex-shrink: 0;
}

.coupon-msg {
  font-size: 13px;
  margin-bottom: 10px;
}

.coupon-msg.valid { color: #22c55e; }
.coupon-msg.invalid { color: #ef4444; }

/* ── Form error ── */
.form-error {
  margin-top: 8px;
  font-size: 13px;
  color: #ef4444;
}

.btn-full {
  width: 100%;
  margin-top: 8px;
}

/* ── Payment amount ── */
.pay-amount {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--surface);
  border-radius: var(--r-md);
  margin-bottom: 20px;
  font-size: 14px;
  color: var(--tg-hint);
}

.pay-amount strong {
  font-size: 20px;
  font-weight: 700;
  color: var(--tg-text);
}

/* ── QR code ── */
.qr-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  min-height: 200px;
}

.qr-image {
  max-width: 200px;
  border-radius: var(--r-md);
}

.qr-placeholder {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--tg-hint);
}

/* ── Offline QR ── */
.offline-qr-row {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-bottom: 16px;
}

.qr-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.qr-item img {
  width: 140px;
  height: 140px;
  border-radius: var(--r-md);
  object-fit: cover;
}

.qr-label {
  font-size: 13px;
  color: var(--tg-hint);
}

/* ── Note code ── */
.note-section {
  margin: 16px 0;
  padding: 12px 16px;
  background: var(--surface);
  border-radius: var(--r-md);
}

.note-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}

.note-code {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--tg-btn);
}

.note-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--tg-hint);
}

/* ── Confirm section ── */
.confirm-section {
  margin-top: 16px;
}

.confirm-divider {
  height: 0.5px;
  background: var(--border);
  margin: 16px 0;
}

.confirm-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}

.confirm-desc {
  font-size: 13px;
  color: var(--tg-hint);
  margin-bottom: 12px;
}

.confirm-input-row {
  display: flex;
  gap: 8px;
}

.confirm-input-row input {
  flex: 1;
  text-align: center;
  letter-spacing: 0.15em;
  font-size: 18px;
  font-family: var(--font-mono);
}

.confirm-input-row .btn-sm {
  flex-shrink: 0;
}

.confirm-error {
  margin-top: 8px;
  font-size: 13px;
  color: #ef4444;
}

/* ── Pay hint / timer ── */
.pay-hint {
  text-align: center;
  font-size: 14px;
  color: var(--tg-hint);
  margin-top: 12px;
}

.pay-timer {
  text-align: center;
  font-size: 13px;
  color: var(--tg-hint);
  margin-top: 4px;
  font-family: var(--font-mono);
}

/* ── Step actions ── */
.step-actions {
  margin-top: 20px;
  display: flex;
  gap: 8px;
  justify-content: center;
}

/* ── Result ── */
.result-content {
  text-align: center;
}

.result-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  border-radius: var(--r-lg);
  margin-bottom: 16px;
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

.result-status.result-success {
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
}

.result-status.result-error {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.result-status.result-pending {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.result-desc {
  font-size: 14px;
  color: var(--tg-hint);
  margin-top: 8px;
}

/* ── Delivery box ── */
.delivery-box {
  text-align: left;
  padding: 14px 16px;
  background: var(--surface);
  border-radius: var(--r-md);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.delivery-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
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

.order-link-row {
  text-align: center;
  margin-top: 12px;
}

/* ── Transitions ── */
.pay-fade-enter-active,
.pay-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}

.pay-fade-enter-from,
.pay-fade-leave-to {
  opacity: 0;
}

.pay-slide-enter-active {
  transition: transform var(--duration-normal) var(--ease-out);
}

.pay-slide-leave-active {
  transition: transform var(--duration-fast) var(--ease-out);
}

.pay-slide-enter-from,
.pay-slide-leave-to {
  transform: translateY(100%);
}

.box-dialog.pay-slide-enter-from {
  transform: translateY(20px);
  opacity: 0;
}

.box-dialog.pay-slide-enter-active {
  transition: transform var(--duration-normal) var(--ease-out),
              opacity var(--duration-normal) var(--ease-out);
}
</style>
