import { describe, expect, it } from 'vitest'
import { buildCompactionMarkers, compactionDeltaLabel, compactionTriggerLabel } from './compaction-marker'
import type { CompactionHistory } from '../../shared/types'

function record(id: string, createdAt: string, patch: Partial<CompactionHistory> = {}): CompactionHistory {
  return {
    id, conversationId: 'c1', strategy: 'auto', triggerReason: 'pi-threshold',
    beforeTokens: 100_000, afterTokens: 55_000, contextWindow: 128_000, coveredTurnStart: null, coveredTurnEnd: null,
    summaryId: null, summaryText: null, durationMs: 1200, createdAt, ...patch
  }
}

const turns = [
  { id: 't1', createdAt: '2026-01-01T10:00:00.000Z' },
  { id: 't2', createdAt: '2026-01-01T11:00:00.000Z' },
  { id: 't3', createdAt: '2026-01-01T12:00:00.000Z' }
]

describe('buildCompactionMarkers', () => {
  it('没有压缩记录时返回空结构', () => {
    expect(buildCompactionMarkers(turns, [])).toEqual({ beforeTurnId: {}, trailing: [] })
  })

  it('按时间挂到第一个晚于它的回合之前', () => {
    const markers = buildCompactionMarkers(turns, [record('k1', '2026-01-01T10:30:00.000Z')])
    expect(Object.keys(markers.beforeTurnId)).toEqual(['t2'])
    expect(markers.trailing).toEqual([])
  })

  it('晚于所有回合的记录挂在末尾', () => {
    const markers = buildCompactionMarkers(turns, [record('k1', '2026-01-01T13:00:00.000Z')])
    expect(markers.beforeTurnId).toEqual({})
    expect(markers.trailing.map((item) => item.id)).toEqual(['k1'])
  })

  it('同一位置的多条按时间正序排列，与库里的倒序无关', () => {
    const markers = buildCompactionMarkers(turns, [
      record('later', '2026-01-01T10:50:00.000Z'),
      record('earlier', '2026-01-01T10:10:00.000Z')
    ])
    expect(markers.beforeTurnId.t2.map((item) => item.id)).toEqual(['earlier', 'later'])
  })

  it('时间戳不可解析时不抛错，归到最早位置', () => {
    const markers = buildCompactionMarkers(turns, [record('bad', 'not-a-date')])
    expect(markers.beforeTurnId.t1.map((item) => item.id)).toEqual(['bad'])
  })

  it('没有回合时全部落到末尾', () => {
    expect(buildCompactionMarkers([], [record('k1', '2026-01-01T10:30:00.000Z')]).trailing).toHaveLength(1)
  })
})

describe('标签', () => {
  it('区分触发来源', () => {
    expect(compactionTriggerLabel('pi-overflow')).toBe('上下文溢出自动压缩')
    expect(compactionTriggerLabel('threshold-desktop')).toBe('达到阈值自动压缩')
    expect(compactionTriggerLabel('model-switch')).toBe('换模型前压缩')
    expect(compactionTriggerLabel('whatever')).toBe('压缩')
  })

  it('窗口已知时给百分比，未知时只报 token', () => {
    expect(compactionDeltaLabel({ beforeTokens: 100_000, afterTokens: 55_000, contextWindow: 0 }, 128_000)).toBe('78% → 43% · 100k → 55k tokens')
    expect(compactionDeltaLabel({ beforeTokens: 100_000, afterTokens: 55_000, contextWindow: 0 }, 0)).toBe('100k → 55k tokens')
  })

  it('百分比按压缩当时的窗口算，模型窗口改过也不会被重算', () => {
    // 当时 128k 窗口下压到 78%；今天这个会话的模型窗口已经是 100 万
    expect(compactionDeltaLabel({ beforeTokens: 100_000, afterTokens: 55_000, contextWindow: 128_000 }, 1_000_000))
      .toBe('78% → 43% · 100k → 55k tokens')
  })
})
