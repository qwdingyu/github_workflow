/** 格式化工具：价格、状态标签 */

/** 订单状态中文映射 */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  issued: '已发卡',
  expired: '已过期',
  failed: '失败',
}

/** 格式化价格（分 → 元） */
export function formatPrice(cents: number, currency: string): string {
  const yuan = (cents / 100).toFixed(2)
  return `${currency === 'CNY' ? '¥' : currency} ${yuan}`
}

/** 获取订单状态中文标签 */
export function statusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] || status
}
