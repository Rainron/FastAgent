import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../../../shared/types'
import { clampRecallLimit, DEFAULT_RECALL, MAX_RECALL, MIN_RECALL, rankMemories, type RankableMemory } from './memory-rank'

const now = Date.UTC(2026, 0, 31)

function memory(patch: Partial<MemoryRecord> & { id: string }): MemoryRecord {
  return {
    scope: 'workspace',
    scopeId: 'project-a',
    type: 'fact',
    content: patch.id,
    importance: 3,
    confidence: 0.8,
    sourceConversationId: null,
    sourceTurnId: null,
    sourceRunId: null,
    status: 'active',
    supersededBy: null,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: null,
    expiresAt: null,
    ...patch
  }
}

function item(record: MemoryRecord, matchPosition: number | null = 0): RankableMemory {
  return { memory: record, matchPosition }
}

describe('clampRecallLimit', () => {
  it('超出范围收敛到 3~8，非法值取默认', () => {
    expect(clampRecallLimit(1)).toBe(MIN_RECALL)
    expect(clampRecallLimit(99)).toBe(MAX_RECALL)
    expect(clampRecallLimit(undefined)).toBe(DEFAULT_RECALL)
    expect(clampRecallLimit(Number.NaN)).toBe(DEFAULT_RECALL)
  })
})

describe('rankMemories', () => {
  it('FTS 名次相同时重要性更高的排在前面', () => {
    const ranked = rankMemories([
      item(memory({ id: 'low', importance: 1 }), 0),
      item(memory({ id: 'high', importance: 5 }), 0)
    ], { now, limit: 5 })
    expect(ranked[0].memory.id).toBe('high')
  })

  it('同等条件下更新更近的排在前面', () => {
    const ranked = rankMemories([
      item(memory({ id: 'old', updatedAt: now - 200 * 86_400_000 })),
      item(memory({ id: 'fresh', updatedAt: now }))
    ], { now, limit: 5 })
    expect(ranked[0].memory.id).toBe('fresh')
  })

  it('内容相同的多作用域记录只保留分数最高的一条', () => {
    const ranked = rankMemories([
      item(memory({ id: 'global-copy', scope: 'global', scopeId: null, content: '统一使用 uv', importance: 1 })),
      item(memory({ id: 'workspace-copy', content: '统一使用  uv', importance: 5 }))
    ], { now, limit: 5 })
    expect(ranked).toHaveLength(1)
    expect(ranked[0].memory.id).toBe('workspace-copy')
  })

  it('结果条数不超过 limit', () => {
    const ranked = rankMemories(
      ['a', 'b', 'c', 'd'].map((id, index) => item(memory({ id, content: id }), index)),
      { now, limit: 2 }
    )
    expect(ranked).toHaveLength(2)
  })

  it('分数并列时按 id 定序，结果稳定', () => {
    const first = rankMemories([item(memory({ id: 'b', content: 'b' }), 0), item(memory({ id: 'a', content: 'a' }), 0)], { now, limit: 5 })
    const second = rankMemories([item(memory({ id: 'a', content: 'a' }), 0), item(memory({ id: 'b', content: 'b' }), 0)], { now, limit: 5 })
    expect(first.map((hit) => hit.memory.id)).toEqual(second.map((hit) => hit.memory.id))
  })
})
