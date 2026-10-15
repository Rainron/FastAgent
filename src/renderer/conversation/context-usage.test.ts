import { describe, expect, it } from 'vitest'
import { cacheHitLabel, mergeLiveUsage, usageAggregateForRecord } from './context-usage'
import type { ModelUsageRecord, ModelUsageSummary } from '../../shared/types'

const record: ModelUsageRecord = {
  requestId: 'r', conversationId: 'c', turnId: 't', runId: 'run', modelId: 1, provider: 'openai', modelName: 'm', createdAt: '',
  inputTokens: 100, outputTokens: 50, cacheReadTokens: 600, cacheWriteTokens: 300,
  readAvailability: 'reported', writeAvailability: 'reported', status: 'completed'
}

describe('缓存展示', () => {
  it('缓存写入进入输入分母，输出不进入，命中率按 token 加权', () => {
    expect(cacheHitLabel(usageAggregateForRecord(record))).toBe('60%')
  })
  it('缺少报告、无请求与真实零分别显示', () => {
    expect(cacheHitLabel(usageAggregateForRecord(null))).toBe('—')
    expect(cacheHitLabel(usageAggregateForRecord({ ...record, readAvailability: 'unknown' }))).toBe('未确认')
    expect(cacheHitLabel(usageAggregateForRecord({ ...record, cacheReadTokens: 0 }))).toBe('0%')
    expect(cacheHitLabel(usageAggregateForRecord({ ...record, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }))).toBe('—')
  })

  it('同一流式请求用最新值替换，不重复累加', () => {
    const first = mergeLiveUsage(undefined, { ...record, inputTokens: 10, cacheReadTokens: 20, outputTokens: 1 })
    const next = mergeLiveUsage(first, { ...record, inputTokens: 15, cacheReadTokens: 30, outputTokens: 4 })
    expect(next.latest?.outputTokens).toBe(4)
    expect(next.turn).toMatchObject({ requestCount: 1, inputTokens: 345, outputTokens: 4, cacheReadTokens: 30 })
  })

  it('新的流式请求在已有会话用量上累加', () => {
    const empty = usageAggregateForRecord(null)
    const base: ModelUsageSummary = { latest: null, turn: { ...empty }, session: { ...empty } }
    const first = mergeLiveUsage(base, record)
    const second = mergeLiveUsage(first, { ...record, requestId: 'r2', inputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(second.turn).toMatchObject({ requestCount: 2, inputTokens: 1025, outputTokens: 100, cacheReadTokens: 600 })
  })
})
