import { describe, expect, it } from 'vitest'
import type { ConversationTurn } from '../shared/types'
import { buildRewindSeed, planSessionRewind, summaryCoversTurn } from './session-rewind'

const turn = (id: string, user: string, assistant: string | null): ConversationTurn => ({
  id,
  conversationId: 'c1',
  userMessage: { text: user, createdAt: '2026-10-01T00:00:00.000Z' },
  attachments: [],
  activity: null,
  assistantMessage: assistant === null ? null : { text: assistant, createdAt: '2026-10-01T00:00:01.000Z' },
  citations: [],
  artifacts: [],
  runtimeConfig: { modelId: null, thinkingLevel: 'auto', mode: 'agent', permission: null, project: null },
  status: 'completed',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:01.000Z'
})

describe('planSessionRewind', () => {
  const base = { currentSessionFile: 's1.jsonl', anchorFileExists: true, summaryCoversTarget: false }

  it('锚点属于当前 session 时从锚点切分支', () => {
    expect(planSessionRewind({ ...base, anchor: { sessionFile: 's1.jsonl', leafId: 'e9' } })).toEqual({ kind: 'branch', sessionFile: 's1.jsonl', leafId: 'e9' })
  })

  it('本轮是 session 第一轮时直接重开', () => {
    expect(planSessionRewind({ ...base, anchor: { sessionFile: 's1.jsonl', leafId: null } })).toEqual({ kind: 'reset' })
  })

  it('session 换过或文件不在了，锚点作废，改用原文种子', () => {
    expect(planSessionRewind({ ...base, anchor: { sessionFile: 'old.jsonl', leafId: 'e1' } }).kind).toBe('reseed')
    expect(planSessionRewind({ ...base, anchorFileExists: false, anchor: { sessionFile: 's1.jsonl', leafId: 'e1' } }).kind).toBe('reseed')
  })

  it('旧回合没有锚点但有 session 时同样重做种子', () => {
    expect(planSessionRewind({ ...base, anchor: null }).kind).toBe('reseed')
  })

  it('没有 session 时只看摘要是否涉及目标轮', () => {
    expect(planSessionRewind({ anchor: null, currentSessionFile: null, anchorFileExists: false, summaryCoversTarget: false }).kind).toBe('none')
    expect(planSessionRewind({ anchor: null, currentSessionFile: null, anchorFileExists: false, summaryCoversTarget: true }).kind).toBe('reseed')
  })
})

describe('summaryCoversTurn', () => {
  const turns = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('覆盖终点在目标之前不算', () => {
    expect(summaryCoversTurn('a', turns, 1)).toBe(false)
  })

  it('覆盖终点在目标或之后算覆盖', () => {
    expect(summaryCoversTurn('b', turns, 1)).toBe(true)
    expect(summaryCoversTurn('c', turns, 1)).toBe(true)
  })

  it('终点回合已不存在时按覆盖处理，没有终点不算', () => {
    expect(summaryCoversTurn('gone', turns, 1)).toBe(true)
    expect(summaryCoversTurn(null, turns, 1)).toBe(false)
  })
})

describe('buildRewindSeed', () => {
  it('按顺序带上问答原文', () => {
    const seed = buildRewindSeed([turn('a', '你好', '在'), turn('b', '统计行数', null)], null)
    expect(seed).toContain('User: 你好\nAssistant: 在')
    expect(seed.indexOf('你好')).toBeLessThan(seed.indexOf('统计行数'))
  })

  it('带上更早的摘要', () => {
    expect(buildRewindSeed([turn('a', 'q', 'a')], '早先讨论过部署')).toMatch(/^# 更早的会话摘要\n早先讨论过部署/)
  })

  it('超预算时保留最近的回合', () => {
    const turns = Array.from({ length: 40 }, (_, index) => turn(`t${index}`, `问题${index} ${'x'.repeat(1100)}`, 'y'.repeat(1100)))
    const seed = buildRewindSeed(turns, null)
    expect(seed.length).toBeLessThan(25_000)
    expect(seed).toContain('问题39')
    expect(seed).not.toContain('问题0 ')
  })

  it('没有任何内容时返回空串', () => {
    expect(buildRewindSeed([], null)).toBe('')
    expect(buildRewindSeed([turn('a', '  ', null)], '  ')).toBe('')
  })
})
