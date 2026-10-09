import { describe, expect, it } from 'vitest'
import { cancelledOutcome, traceMetaLine } from './turn-outcome'

describe('cancelledOutcome', () => {
  it('没出字就取消时给下一步；只有跑过工具的最后一轮能继续', () => {
    expect(cancelledOutcome({ kind: 'cancelled', answerText: '', hasWork: true, isLast: true })).toEqual({ hasWork: true, canContinue: true })
    expect(cancelledOutcome({ kind: 'cancelled', answerText: ' ', hasWork: true, isLast: false })).toEqual({ hasWork: true, canContinue: false })
    expect(cancelledOutcome({ kind: 'cancelled', answerText: '', hasWork: false, isLast: true })).toEqual({ hasWork: false, canContinue: false })
  })

  it('有半截回答或不是取消时不出', () => {
    expect(cancelledOutcome({ kind: 'cancelled', answerText: '半截', hasWork: true, isLast: true })).toBeNull()
    expect(cancelledOutcome({ kind: 'failed', answerText: '', hasWork: true, isLast: true })).toBeNull()
  })
})

describe('traceMetaLine', () => {
  const now = new Date(2026, 9, 1, 12, 0, 0)
  const createdAt = new Date(2026, 9, 1, 2, 6, 0).toISOString()

  it('没有回答时把模型与时间挪到收尾行', () => {
    expect(traceMetaLine({ kind: 'cancelled', answerText: '', modelName: 'gpt-5.6-sol', createdAt }, now)).toBe('gpt-5.6-sol · 02:06')
    expect(traceMetaLine({ kind: 'failed', answerText: '', createdAt }, now)).toBe('02:06')
  })

  it('执行中或有回答头时不给', () => {
    expect(traceMetaLine({ kind: 'working', answerText: '', modelName: 'm', createdAt }, now)).toBeUndefined()
    expect(traceMetaLine({ kind: 'done', answerText: '回答', modelName: 'm', createdAt }, now)).toBeUndefined()
  })
})
