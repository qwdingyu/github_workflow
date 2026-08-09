import { describe, expect, it } from 'vitest'
import { formatDate } from './useFormat'

describe('formatDate（套件再导出）', () => {
  it('空值返回短横线', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate(undefined)).toBe('-')
    expect(formatDate('')).toBe('-')
  })

  it('稳定格式化 ISO 风格字符串', () => {
    const s = formatDate('2026-08-05T12:34:56.000Z')
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('接受 Date 对象', () => {
    const s = formatDate(new Date('2026-01-02T03:04:05.000Z'))
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})
