import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE_DISPLAY, MAX_TRACE_EXCERPT_LINES, MIN_TRACE_EXCERPT_LINES, formatTokenCount, normalizeTraceDisplay } from './trace-display'

describe('normalizeTraceDisplay', () => {
  it('缺省时回落到默认值', () => {
    expect(normalizeTraceDisplay(undefined)).toEqual(DEFAULT_TRACE_DISPLAY)
    expect(normalizeTraceDisplay({})).toEqual(DEFAULT_TRACE_DISPLAY)
  })

  it('默认对齐参考稿：底部用时 + 中文文案 + 展开即见内容', () => {
    expect(DEFAULT_TRACE_DISPLAY.timerPlacement).toBe('bottom')
    expect(DEFAULT_TRACE_DISPLAY.labelStyle).toBe('zh')
    expect(DEFAULT_TRACE_DISPLAY.flatToolArgs).toBe(true)
    expect(DEFAULT_TRACE_DISPLAY.inlineImagePreview).toBe(true)
    expect(DEFAULT_TRACE_DISPLAY.textExcerpt).toBe(true)
    // 点开会顶掉右侧正在看的东西，默认不开
    expect(DEFAULT_TRACE_DISPLAY.openFileFromTrace).toBe(false)
  })

  it('非法枚举值按默认处理，不把脏值写回界面', () => {
    const result = normalizeTraceDisplay({ timerPlacement: 'left' as never, labelStyle: 'klingon' as never })
    expect(result.timerPlacement).toBe('bottom')
    expect(result.labelStyle).toBe('zh')
  })

  it('保留用户显式选择', () => {
    const result = normalizeTraceDisplay({ timerPlacement: 'both', labelStyle: 'compact', showTokens: false, openFileFromTrace: true })
    expect(result.timerPlacement).toBe('both')
    expect(result.labelStyle).toBe('compact')
    expect(result.showTokens).toBe(false)
    expect(result.openFileFromTrace).toBe(true)
  })

  it('节选行数裁进区间，非数字回落默认', () => {
    expect(normalizeTraceDisplay({ textExcerptLines: 1 }).textExcerptLines).toBe(MIN_TRACE_EXCERPT_LINES)
    expect(normalizeTraceDisplay({ textExcerptLines: 9999 }).textExcerptLines).toBe(MAX_TRACE_EXCERPT_LINES)
    expect(normalizeTraceDisplay({ textExcerptLines: 33.4 }).textExcerptLines).toBe(33)
    expect(normalizeTraceDisplay({ textExcerptLines: Number.NaN }).textExcerptLines).toBe(DEFAULT_TRACE_DISPLAY.textExcerptLines)
  })
})

describe('formatTokenCount', () => {
  it('千位以下给原值，千位以上收敛成 k', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(940)).toBe('940')
    expect(formatTokenCount(4243)).toBe('4.2k')
    expect(formatTokenCount(128000)).toBe('128k')
  })

  it('破百万进位成 M，不出现 32755k 这种读不出量级的数字', () => {
    expect(formatTokenCount(32_755_000)).toBe('32.8M')
    expect(formatTokenCount(1_240_000)).toBe('1.2M')
    expect(formatTokenCount(999_400)).toBe('999k')
  })

  it('负数与非数字不产出乱码', () => {
    expect(formatTokenCount(-5)).toBe('0')
    expect(formatTokenCount(Number.NaN)).toBe('0')
  })
})
