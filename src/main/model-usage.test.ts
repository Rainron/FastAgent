import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createModelUsageCollector, normalizeModelUsage } from './model-usage'
import { MODEL_USAGE_SCHEMA_SQL, ModelUsageStore } from './model-usage-store'
import type { ModelUsageRecord } from '../shared/types'

const context = { conversationId: 'c', turnId: 't', runId: 'r', modelId: 1, provider: 'openai', modelName: 'gpt-test', baseUrl: 'https://api.openai.com/v1' }
const message = (usage: object, patch: object = {}) => ({ role: 'assistant', timestamp: 1000, stopReason: 'stop', usage, ...patch })
const record = (requestId: string, patch: Partial<ModelUsageRecord> = {}): ModelUsageRecord => ({
  requestId, conversationId: 'c', turnId: 't', runId: 'r', modelId: 1, provider: 'openai', modelName: 'gpt-test',
  createdAt: '2026-09-05T00:00:00.000Z', inputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0,
  readAvailability: 'reported', writeAvailability: 'unknown', status: 'completed', ...patch
})

describe('模型缓存用量归一化', () => {
  it('保留 Pi 的互斥输入分类，不再从未缓存输入扣除缓存', () => {
    expect(normalizeModelUsage(message({ input: 200, output: 50, cacheRead: 800, cacheWrite: 0 }), context, 'id')).toMatchObject({ inputTokens: 200, cacheReadTokens: 800, readAvailability: 'reported', writeAvailability: 'unknown' })
  })

  it('官方端点的真实零与自定义网关的归零未知区分展示', () => {
    const data = message({ input: 100, output: 10, cacheRead: 0, cacheWrite: 0 })
    expect(normalizeModelUsage(data, context, 'id')?.readAvailability).toBe('reported')
    expect(normalizeModelUsage(data, { ...context, baseUrl: 'https://proxy.example/v1' }, 'id')?.readAvailability).toBe('unknown')
    expect(normalizeModelUsage(data, { ...context, baseUrl: 'https://api.openai.com/custom' }, 'id')?.readAvailability).toBe('unknown')
    expect(normalizeModelUsage(message({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), context, 'id')?.readAvailability).toBe('unknown')
  })

  it('读取和写入分别标记，1h 写入不重复累加，错误请求仍保留实际用量', () => {
    const data = message({ input: 100, output: 20, cacheRead: 600, cacheWrite: 300, cacheWrite1h: 200 }, { stopReason: 'aborted' })
    expect(normalizeModelUsage(data, context, 'id')).toMatchObject({ cacheWriteTokens: 300, status: 'cancelled', writeAvailability: 'reported' })
    expect(normalizeModelUsage(message({ input: 12 }, { stopReason: 'error' }), context, 'id')?.status).toBe('failed')
    expect(normalizeModelUsage({ role: 'user' }, context, 'id')).toBeNull()
  })

  it('逐请求收集工具循环和续写，重复终结不重复计数', () => {
    const records: ModelUsageRecord[] = []
    const collect = createModelUsageCollector(context, (item) => records.push(item))
    const first = message({ input: 10, output: 5, cacheRead: 30 }, { responseId: 'one', stopReason: 'toolUse' })
    collect(first)
    collect(first)
    collect({ ...first })
    collect(message({ input: 20, output: 5 }, { responseId: 'two', stopReason: 'error' }))
    expect(records).toHaveLength(2)
    expect(records[1].status).toBe('failed')
    const child = createModelUsageCollector({ ...context, subAgent: true }, (item) => records.push(item))
    child(message({ input: 100 }))
    expect(records).toHaveLength(2)
  })
})

describe('ModelUsageStore', () => {
  function fixture() {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE conversations(namespace TEXT, conversation_id TEXT, PRIMARY KEY(namespace, conversation_id)); INSERT INTO conversations VALUES (\'ns\',\'c\'),(\'other\',\'c\');')
    db.exec(MODEL_USAGE_SCHEMA_SQL)
    return { db, store: new ModelUsageStore(db) }
  }

  it('请求幂等落库，跨轮和跨模型累计使用加权分母，重建实例后保留', () => {
    const { db, store } = fixture()
    try {
      expect(store.record('ns', record('a'))).toBe(true)
      expect(store.record('ns', record('a'))).toBe(false)
      store.record('ns', record('b', { inputTokens: 900, cacheReadTokens: 0, turnId: 't2', modelId: 2, createdAt: '2026-09-05T00:01:00.000Z' }))
      const result = new ModelUsageStore(db).get('ns', 'c')
      expect(result.session).toMatchObject({ requestCount: 2, reportedReadRequests: 2, inputTokens: 1000, readInputTokens: 1000, cacheReadTokens: 90 })
      expect(result.turn.requestCount).toBe(1)
      expect(result.latest?.requestId).toBe('b')
      expect(store.get('other', 'c').session.requestCount).toBe(0)
    } finally { db.close() }
  })

  it('未知请求只计入总请求数和总输入，明确已报告覆盖；当前空轮不复用上一轮累计', () => {
    const { db, store } = fixture()
    try {
      store.record('ns', record('a'))
      store.record('ns', record('b', { inputTokens: 900, cacheReadTokens: 0, readAvailability: 'unknown' }))
      expect(store.get('ns', 'c', 'next').turn.requestCount).toBe(0)
      expect(store.get('ns', 'c').session).toMatchObject({ requestCount: 2, reportedReadRequests: 1, inputTokens: 1000, readInputTokens: 100, cacheReadTokens: 90 })
      store.deleteConversation('ns', 'c')
      expect(store.get('ns', 'c').latest).toBeNull()
    } finally { db.close() }
  })
})
