import { describe, expect, it } from 'vitest'
import type { ConversationTurn } from '../../shared/types'
import { detectRemovedTurns, mergeExitingTurns } from './exiting-turns'

const turn = (id: string, conversationId = 'c1') => ({ id, conversationId }) as ConversationTurn
const ids = (items: Array<{ turn: ConversationTurn; exiting: boolean }>) => items.map((item) => `${item.turn.id}${item.exiting ? '*' : ''}`)

describe('detectRemovedTurns', () => {
  it('找出同一会话里被删的回合', () => {
    const previous = [turn('a'), turn('b'), turn('c')]
    expect(detectRemovedTurns(previous, [turn('a')]).map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('切会话不算删除', () => {
    expect(detectRemovedTurns([turn('a', 'c1')], [turn('x', 'c2')])).toEqual([])
  })

  it('删光或列表没变时不播退场', () => {
    const list = [turn('a')]
    expect(detectRemovedTurns(list, [])).toEqual([])
    expect(detectRemovedTurns(list, list)).toEqual([])
  })
})

describe('mergeExitingTurns', () => {
  it('退场的回合留在原位', () => {
    const merged = mergeExitingTurns([turn('a'), turn('c')], [turn('b')], ['a', 'b', 'c'])
    expect(ids(merged)).toEqual(['a', 'b*', 'c'])
  })

  it('重跑截断：后面几轮都在原位退场，被重跑的那轮用新版本', () => {
    const rerun = { ...turn('a'), status: 'working' } as ConversationTurn
    const merged = mergeExitingTurns([rerun], [turn('b'), turn('c')], ['a', 'b', 'c'])
    expect(ids(merged)).toEqual(['a', 'b*', 'c*'])
    expect(merged[0].turn.status).toBe('working')
  })

  it('退场期间新增的回合排在最后', () => {
    expect(ids(mergeExitingTurns([turn('a'), turn('n')], [turn('b')], ['a', 'b']))).toEqual(['a', 'b*', 'n'])
  })

  it('没有退场时原样映射', () => {
    expect(ids(mergeExitingTurns([turn('a')], [], []))).toEqual(['a'])
  })
})
