import { describe, expect, it } from 'vitest'
import { formatMessageTime, formatMessageTimeFull } from './message-time'

// 用本地时间构造，避免测试机时区影响「是不是同一天」的判断。
const local = (y: number, m: number, d: number, h: number, min: number, s = 0) => new Date(y, m - 1, d, h, min, s).toISOString()
const now = new Date(2026, 9, 1, 21, 30)

describe('formatMessageTime', () => {
  it('今天只显示时:分', () => {
    expect(formatMessageTime(local(2026, 10, 1, 9, 5), now)).toBe('09:05')
  })

  it('昨天加「昨天」前缀', () => {
    expect(formatMessageTime(local(2026, 9, 30, 23, 59), now)).toBe('昨天 23:59')
  })

  it('跨月的昨天同样识别', () => {
    expect(formatMessageTime(local(2026, 10, 31, 8, 0), new Date(2026, 10, 1, 10, 0))).toBe('昨天 08:00')
  })

  it('今年更早的日期给 月-日', () => {
    expect(formatMessageTime(local(2026, 9, 28, 21, 16), now)).toBe('09-28 21:16')
  })

  it('跨年补上年份', () => {
    expect(formatMessageTime(local(2025, 12, 31, 21, 16), now)).toBe('2025-12-31 21:16')
  })

  it('非法时间返回空串', () => {
    expect(formatMessageTime('not-a-date', now)).toBe('')
  })
})

describe('formatMessageTimeFull', () => {
  it('精确到秒', () => {
    expect(formatMessageTimeFull(local(2026, 10, 1, 21, 16, 7))).toBe('2026-10-01 21:16:07')
  })
})
