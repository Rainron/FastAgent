import type { ModelUsageAggregate, ModelUsageRecord } from '../../shared/types'

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
