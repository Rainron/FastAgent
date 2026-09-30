import type { ModelUsageDayRow, ModelUsageOverview } from '../../shared/types'

/** 中文环境统一用「万」做单位；千位以内直接给原值，便于精确核对。 */
export function formatTokenCount(value: number): string {
  if (value < 10_000) return String(value)
  const wan = value / 10_000
  return `${wan >= 100 ? Math.round(wan) : Math.round(wan * 10) / 10} 万`
}

export type UsageBarSegment = { key: 'input' | 'output'; tokens: number }

export type UsageBar = {
  day: string
  /** 图内展示的两个分段：输入（含缓存）与输出。 */
  segments: UsageBarSegment[]
  total: number
  /** 相对窗口内最大值的高度百分比；有数据但总量为 0 时给最小可见高度。 */
  percents: Array<{ key: UsageBarSegment['key']; percent: number }>
  requestCount: number
}

/**
 * 把逐日数据换算成条形图需要的比例。空天数不补零：窗口内没用量的日子留白
 * 比拉平一排零高柱更易读，天数信息由横轴标签承担。
 */
export function buildUsageBars(days: ModelUsageDayRow[]): UsageBar[] {
  const max = Math.max(0, ...days.map((item) => item.inputTokens + item.outputTokens))
  return days.map((item) => {
    const total = item.inputTokens + item.outputTokens
    const scale = max > 0 ? total / max : 0
    // 总量为 0 但有请求记录的日子保留 2% 高度，表明「当天用过但没消耗」。
    const totalPercent = total > 0 ? scale * 100 : item.requestCount > 0 ? 2 : 0
    const inputPercent = total > 0 ? (item.inputTokens / total) * totalPercent : 0
    return {
      day: item.day,
      segments: [{ key: 'input', tokens: item.inputTokens }, { key: 'output', tokens: item.outputTokens }],
      total,
      percents: [
        { key: 'input', percent: inputPercent },
        { key: 'output', percent: totalPercent - inputPercent },
      ],
      requestCount: item.requestCount,
    }
  })
}

/** 表格与卡片共用的口径说明：缓存命中率只统计已报告读缓存的请求。 */
export function cacheHitRate(overview: ModelUsageOverview): number | null {
  const reported = overview.totals.cacheReadTokens + overview.totals.inputTokens
  if (reported <= 0) return null
  return overview.totals.cacheReadTokens / reported
}

/** x 轴标签抽稀：窗口越长间隔越大，否则 90 天的标签会叠成一条黑线。 */
export function axisLabelEvery(dayCount: number): number {
  if (dayCount <= 8) return 1
  if (dayCount <= 32) return 5
  if (dayCount <= 95) return 15
  return 30
}

/** 模型行按总 token 降序：SQL 返回顺序不承诺，主力模型应稳定排在最上。 */
export function sortByTotalTokens<T extends { inputTokens: number; outputTokens: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
}

/**
 * 窗口日期范围标签：窗口内数据可能完全相同（用量都在最近几天），
 * 标签是唯一随窗口切换必变的反馈，用本地时区切天。
 */
export function windowLabel(days: number, now: Date = new Date()): string {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end.getTime() - (days - 1) * 86_400_000)
  const fmt = (date: Date) => `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${fmt(start)} ~ ${fmt(end)}`
}
