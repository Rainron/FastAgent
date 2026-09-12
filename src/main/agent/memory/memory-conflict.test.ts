import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../../../shared/types'
import type { MemoryCandidate } from './memory-extractor'
import { planMemoryWrites, trigramSimilarity } from './memory-conflict'

function memory(patch: Partial<MemoryRecord> & { id: string; content: string }): MemoryRecord {
  return {
    scope: 'workspace', scopeId: 'p1', type: 'decision', importance: 3, confidence: 0.8,
    sourceConversationId: null, sourceTurnId: null, sourceRunId: null, status: 'active',
    supersededBy: null, createdAt: 0, updatedAt: 0, lastAccessedAt: null, expiresAt: null,
    ...patch
  }
}

function candidate(patch: Partial<MemoryCandidate> & { content: string }): MemoryCandidate {
  return { type: 'decision', scope: 'workspace', importance: 3, replaces: [], ...patch }
}

describe('trigramSimilarity', () => {
  it('完全相同为 1，无关文本接近 0', () => {
    expect(trigramSimilarity('数据库使用 PostgreSQL', '数据库使用 PostgreSQL')).toBe(1)
    expect(trigramSimilarity('数据库使用 PostgreSQL', '前端框架用 React')).toBeLessThan(0.2)
  })

  it('忽略空白与标点差异', () => {
    expect(trigramSimilarity('统一使用 uv。', '统一使用uv')).toBe(1)
  })
})

describe('planMemoryWrites', () => {
  const existing = [memory({ id: 'm1', content: '当前项目数据库统一使用 MySQL' })]

  it('模型声明替代时，旧记忆进 supersedes', () => {
    const plan = planMemoryWrites([candidate({ content: '当前项目数据库统一使用 PostgreSQL', replaces: [1] })], existing)
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0].supersedes).toEqual(['m1'])
  })

  it('重复内容只刷新既有条目，不新增', () => {
    const plan = planMemoryWrites([candidate({ content: '当前项目数据库统一使用 MySQL', importance: 5 })], existing)
    expect(plan.creates).toEqual([])
    expect(plan.refreshes).toEqual([{ id: 'm1', importance: 5 }])
  })

  it('相似但未声明替代的记忆照常新建，不做自动替代', () => {
    const plan = planMemoryWrites([candidate({ content: '当前项目读库使用 MySQL，写库使用 PostgreSQL' })], existing)
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0].supersedes).toEqual([])
  })

  it('作用域或类型不同的记忆不参与判重', () => {
    const plan = planMemoryWrites([candidate({ content: '当前项目数据库统一使用 MySQL', scope: 'global' })], existing)
    expect(plan.creates).toHaveLength(1)
  })

  it('替代序号越界或指向非 active 记忆时被忽略', () => {
    const stale = [memory({ id: 'm2', content: '旧决定', status: 'superseded' })]
    const plan = planMemoryWrites([candidate({ content: '新的技术决定内容', replaces: [1, 9] })], stale)
    expect(plan.creates[0].supersedes).toEqual([])
  })

  it('同一批里两条都命中同一既有记忆时只刷新一次', () => {
    const plan = planMemoryWrites([
      candidate({ content: '当前项目数据库统一使用 MySQL' }),
      candidate({ content: '当前项目数据库统一使用 MySQL' })
    ], existing)
    expect(plan.refreshes).toHaveLength(1)
  })
})
