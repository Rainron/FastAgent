import { describe, expect, it } from 'vitest'
import { cacheHitLabel, usageAggregateForRecord } from './context-usage'
import type { ModelUsageRecord } from '../../shared/types'

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
})
