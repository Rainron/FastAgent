import type { ModelUsageAggregate, ModelUsageRecord, ModelUsageSummary } from '../../shared/types'

export function usageAggregateForRecord(record: ModelUsageRecord | null): ModelUsageAggregate {
  const totalInput = record ? record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens : 0
  const read = record?.readAvailability === 'reported'
  const write = record?.writeAvailability === 'reported'
  return {
    requestCount: record ? 1 : 0, reportedReadRequests: read ? 1 : 0, reportedWriteRequests: write ? 1 : 0,
    inputTokens: totalInput, outputTokens: record?.outputTokens ?? 0,
    readInputTokens: read ? totalInput : 0, cacheReadTokens: read ? record!.cacheReadTokens : 0,
    cacheWriteTokens: write ? record!.cacheWriteTokens : 0
  }
}

export function cacheHitLabel(usage: ModelUsageAggregate): string {
  if (!usage.requestCount) return '—'
  if (!usage.reportedReadRequests) return '未确认'
  if (!usage.readInputTokens) return '—'
  return `${Math.round(Math.min(1, usage.cacheReadTokens / usage.readInputTokens) * 1000) / 10}%`
}

const AGGREGATE_KEYS: Array<keyof ModelUsageAggregate> = [
  'requestCount', 'reportedReadRequests', 'reportedWriteRequests', 'inputTokens',
  'outputTokens', 'readInputTokens', 'cacheReadTokens', 'cacheWriteTokens'
]

function adjustAggregate(base: ModelUsageAggregate, record: ModelUsageRecord | null, direction: 1 | -1): ModelUsageAggregate {
  const delta = usageAggregateForRecord(record)
  const next = { ...base }
  for (const key of AGGREGATE_KEYS) next[key] = Math.max(0, next[key] + delta[key] * direction)
  return next
}

/** 把未落库的 partial usage 覆盖到已有汇总；同一 requestId 更新时先扣掉旧快照。 */
export function mergeLiveUsage(base: ModelUsageSummary | undefined, live: ModelUsageRecord): ModelUsageSummary {
  const empty = usageAggregateForRecord(null)
  const previous = base?.latest?.requestId === live.requestId ? base.latest : null
  const turn = adjustAggregate(adjustAggregate(base?.turn ?? empty, previous, -1), live, 1)
  const session = adjustAggregate(adjustAggregate(base?.session ?? empty, previous, -1), live, 1)
  return { latest: live, turn, session }
}
