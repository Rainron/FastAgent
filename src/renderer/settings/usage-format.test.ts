import { describe, expect, it } from 'vitest'
import type { ModelUsageOverview } from '../../shared/types'
import { axisLabelEvery, buildUsageBars, cacheHitRate, formatTokenCount, sortByTotalTokens, windowLabel } from './usage-format'

describe('formatTokenCount', () => {
  it('万以下原样输出', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(9_999)).toBe('9999')
  })

  it('万以上保留一位小数并去尾零', () => {
    expect(formatTokenCount(10_000)).toBe('1 万')
    expect(formatTokenCount(15_400)).toBe('1.5 万')
    expect(formatTokenCount(1_540_000)).toBe('154 万')
  })
})

describe('buildUsageBars', () => {
  it('按窗口内最大值换算百分比，输入输出分段', () => {
    const bars = buildUsageBars([
      { day: '2026-09-01', requestCount: 4, inputTokens: 750, outputTokens: 250 },
      { day: '2026-09-02', requestCount: 2, inputTokens: 100, outputTokens: 100 },
    ])
    expect(bars[0].percents).toEqual([
      { key: 'input', percent: 75 },
      { key: 'output', percent: 25 },
    ])
    expect(bars[1].percents).toEqual([
      { key: 'input', percent: 10 },
      { key: 'output', percent: 10 },
    ])
  })

  it('有请求但零 token 的日子保留最小可见高度', () => {
    const bars = buildUsageBars([
      { day: '2026-09-01', requestCount: 3, inputTokens: 1000, outputTokens: 0 },
      { day: '2026-09-02', requestCount: 1, inputTokens: 0, outputTokens: 0 },
    ])
    expect(bars[1].percents).toEqual([
      { key: 'input', percent: 0 },
      { key: 'output', percent: 2 },
    ])
  })

  it('全零数据不会除零', () => {
    const bars = buildUsageBars([{ day: '2026-09-01', requestCount: 0, inputTokens: 0, outputTokens: 0 }])
    expect(bars[0].percents).toEqual([
      { key: 'input', percent: 0 },
      { key: 'output', percent: 0 },
    ])
  })
})

describe('cacheHitRate', () => {
  const base: ModelUsageOverview = {
    totals: { requestCount: 10, failedCount: 1, cancelledCount: 0, inputTokens: 300, outputTokens: 100, cacheReadTokens: 700, cacheWriteTokens: 0 },
    byModel: [],
    byDay: [],
  }

  it('读缓存 / （输入 + 读缓存）', () => {
    expect(cacheHitRate(base)).toBeCloseTo(0.7)
  })

  it('没有数据时返回 null', () => {
    expect(cacheHitRate({ ...base, totals: { ...base.totals, inputTokens: 0, cacheReadTokens: 0 } })).toBeNull()
  })
})

describe('axisLabelEvery', () => {
  it('窗口越长间隔越大', () => {
    expect(axisLabelEvery(7)).toBe(1)
    expect(axisLabelEvery(30)).toBe(5)
    expect(axisLabelEvery(90)).toBe(15)
    expect(axisLabelEvery(365)).toBe(30)
  })
})

describe('sortByTotalTokens', () => {
  it('按输入输出总量降序，不改原数组', () => {
    const rows = [
      { inputTokens: 100, outputTokens: 0 },
      { inputTokens: 300, outputTokens: 300 },
      { inputTokens: 200, outputTokens: 0 },
    ]
    const sorted = sortByTotalTokens(rows)
    expect(sorted.map((row) => row.inputTokens)).toEqual([300, 200, 100])
    expect(rows[0].inputTokens).toBe(100)
  })
})

describe('windowLabel', () => {
  it('窗口含当天，本地时区，跨月跨年正确', () => {
    expect(windowLabel(7, new Date(2026, 1, 23, 18, 30))).toBe('02-17 ~ 02-23')
    expect(windowLabel(1, new Date(2026, 2, 1, 0, 1))).toBe('03-01 ~ 03-01')
    expect(windowLabel(90, new Date(2026, 0, 1, 23, 59))).toBe('10-04 ~ 01-01')
  })
})
