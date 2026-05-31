import type { Product, SystemConfig, Order, Delivery } from '@/types'

const BASE = ''

/** 自定义 API 错误，携带 HTTP 状态码和错误类型，便于调用方按场景处理 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 统一请求封装：自动拼接 params，解包后端 { ok, error } 响应 */
async function request<T>(path: string, options?: RequestInit & { params?: Record<string, string> }): Promise<T> {
  const { params, ...fetchOptions } = options || {}
  if (params) {
    const sep = path.includes('?') ? '&' : '?'
    path += sep + new URLSearchParams(params).toString()
  }
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...fetchOptions,
  })
  const data = await res.json()
  if (!res.ok) {
    const message = data.error || `Request failed: ${res.status}`
    const code = data.code as string | undefined
    switch (res.status) {
      case 401:
        throw new ApiError('登录已过期，请重新登录', 401, 'UNAUTHORIZED')
      case 403:
        throw new ApiError('没有权限执行此操作', 403, 'FORBIDDEN')
      case 404:
        throw new ApiError('请求的资源不存在', 404, 'NOT_FOUND')
      case 429:
        throw new ApiError('请求过于频繁，请稍后再试', 429, 'RATE_LIMITED')
      case 503:
        throw new ApiError('服务暂时不可用，请稍后重试', 503, 'SERVICE_UNAVAILABLE')
      default:
        throw new ApiError(message, res.status, code || 'UNKNOWN_ERROR')
    }
  }
  return data as T
}

// ─── Products ───

/** 获取商品列表 — 后端返回 { ok: true, products: [...] } */
export function fetchProducts(): Promise<Product[]> {
  return request<{ products: Product[] }>('/api/products').then(d => d.products)
}

// ─── Unified Payment ───

/** 统一下单支付：后端自动判断线上/线下，返回 mode + 支付信息 */
export function unifiedPay(payload: {
  productId: string
  buyerEmail: string
  couponCode?: string
  campaignCode?: string
  referralCode?: string
  turnstileToken?: string
}): Promise<{
  mode: 'online' | 'offline'
  provider?: string
  orderId: string
  orderNo: string
  orderToken: string
  amountCents: number
  currency: string
  qrcode?: string
  redirectUrl?: string
  offlineNoteCode?: string
  wechatQr?: string
  alipayQr?: string
}> {
  return request('/api/pay/unified', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** 轮询支付状态（需 orderToken） */
export function getPayStatus(orderId: string, orderToken: string): Promise<{
  orderId: string
  orderNo: string
  status: string
  delivery?: { accountLabel: string; deliverySecret: string; deliveryNote: string }
}> {
  return request(`/api/pay/status/${encodeURIComponent(orderId)}?token=${encodeURIComponent(orderToken)}`)
}

/** 线下支付确认：提交付款流水号后四位 */
export function confirmOfflinePay(payload: {
  orderId: string
  orderToken: string
  payRefLast4: string
}): Promise<{ confirmed: boolean }> {
  return request('/api/pay/offline/confirm', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ─── Orders ───

/** 订单查询 — 后端返回 { ok: true, orders: [...], total, hasMore } */
export function lookupOrders(token: string): Promise<Order[]> {
  return request<{ orders: Order[] }>('/api/orders/lookup', {
    params: { token },
  }).then(d => d.orders)
}

// ─── Coupon ───

/** 折扣码验证 — 后端 /coupons/quote（POST）返回 { valid, discountCents, payableCents, message? } */
export function verifyCoupon(code: string, productId?: string): Promise<{
  valid: boolean
  discountCents?: number
  payableCents?: number
  message?: string
}> {
  return request('/api/coupons/quote', {
    method: 'POST',
    body: JSON.stringify({
      productId: productId || '',
      couponCode: code,
    }),
  })
}

// ─── Redeem ───

export function redeemCoupon(payload: {
  couponCode: string
  buyerEmail: string
  turnstileToken?: string
}): Promise<{ ok: boolean; delivery?: Delivery }> {
  return request('/api/redeem', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ─── System ───

export function fetchConfig(): Promise<SystemConfig> {
  return request('/api/system-config')
}

// ─── Health ───

export function checkHealth(): Promise<{ status: string }> {
  return request('/api/health')
}
