import { describe, expect, it } from 'vitest'
import { formatInspectorTimestamp } from './inspector-data'

describe('会话详情里的时间展示', () => {
  it('把 ISO 串转成本地时间', () => {
    const formatted = formatInspectorTimestamp('2026-09-18T06:30:00.000Z')
    expect(formatted).not.toBe('—')
    expect(formatted).toBe(new Date('2026-09-18T06:30:00.000Z').toLocaleString('zh-CN', { hour12: false }))
  })

  it('空值与脏值都显示占位符，不出 Invalid Date', () => {
    expect(formatInspectorTimestamp(null)).toBe('—')
    expect(formatInspectorTimestamp(undefined)).toBe('—')
    expect(formatInspectorTimestamp('')).toBe('—')
    expect(formatInspectorTimestamp('not-a-date')).toBe('—')
  })
})
