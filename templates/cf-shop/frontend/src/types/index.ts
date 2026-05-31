export type Platform = 'telegram-mobile' | 'telegram-desktop' | 'h5-mobile' | 'h5-desktop'

// ─── Product ───

export interface Product {
  id: string
  title: string
  priceCents: number
  currency: string
  coverUrl?: string
  stock: number
  category?: string
}

// ─── Order ───

export interface Order {
  id: string
  orderNo: string
  productId: string
  productTitle: string
  priceCents: number
  amountCents: number
  currency: string
  status: 'pending' | 'paid' | 'issued' | 'expired' | 'failed'
  delivery?: Delivery
  createdAt: string
}

export interface Delivery {
  type?: 'card' | 'email' | 'direct'
  /** 卡号（前端展示用） */
  cardNo?: string
  /** 密码（前端展示用） */
  password?: string
  email?: string
  content?: string
  /** 后端 pay/status 返回的字段 */
  accountLabel?: string
  deliverySecret?: string
  deliveryNote?: string
}

// ─── Payment ───

export interface PayProduct {
  id: string
  title: string
  priceCents: number
  currency: string
  coverUrl?: string
}

export type PayStep = 'form' | 'online' | 'offline' | 'result'

export interface PayOrder {
  orderId: string
  product: PayProduct
  couponCode?: string
  couponDiscount?: number
  finalPriceCents: number
  currency: string
  email: string
  method: 'online' | 'offline'
}

// ─── API Responses ───

export interface ApiResponse<T> {
  ok?: boolean
  error?: string
  data?: T
}

export interface SystemConfig {
  config?: {
    offline_pay_qr_wechat?: string
    offline_pay_qr_alipay?: string
    offline_pay_hint?: string
    turnstile_site_key?: string
    [key: string]: any
  }
}

// ─── Unified Pay Response ───

export interface UnifiedPayData {
  orderId: string
  method: 'online' | 'offline'
  payUrl?: string
  qrCodeUrl?: string
  offlineWechatQr?: string
  offlineAlipayQr?: string
  offlineNoteCode?: string
  refLast4?: string
  payRefNo?: string
  timeoutAt?: string
}
