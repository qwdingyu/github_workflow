import { ref } from 'vue'
import type { PayStep, PayProduct, PayOrder, Delivery } from '@/types'

const isVisible = ref(false)
const _step = ref<PayStep>('form')
const product = ref<PayProduct>({ id: '', title: '', priceCents: 0, currency: 'CNY', coverUrl: '' })
const email = ref('')
const couponCode = ref('')
const couponValid = ref(false)
const couponDiscount = ref(0)
const currentOrder = ref<PayOrder | null>(null)
const delivery = ref<Delivery | null>(null)
const orderStatus = ref('')
const orderError = ref('')

function open(p: PayProduct) {
  product.value = p
  email.value = ''
  couponCode.value = ''
  couponValid.value = false
  couponDiscount.value = 0
  currentOrder.value = null
  delivery.value = null
  orderStatus.value = ''
  orderError.value = ''
  _step.value = 'form'
  isVisible.value = true
}

function close() {
  isVisible.value = false
  _step.value = 'form'
  currentOrder.value = null
}

function setStep(s: PayStep) {
  _step.value = s
}

export function usePayment() {
  return {
    isVisible,
    /** 只读 step — 通过 setStep 修改 */
    step: _step,
    setStep,
    product,
    email,
    couponCode,
    couponValid,
    couponDiscount,
    currentOrder,
    delivery,
    orderStatus,
    orderError,
    open,
    close,
  }
}
