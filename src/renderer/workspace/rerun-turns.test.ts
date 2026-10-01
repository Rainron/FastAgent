import { describe, expect, it } from 'vitest'
import type { ConversationTurn } from '../../shared/types'
import { truncateTurnsForRerun } from './rerun-turns'

const turn = (id: string, text = id) => ({ id, userMessage: { text, createdAt: '' } }) as ConversationTurn

describe('truncateTurnsForRerun', () => {
  it('替换目标轮并去掉之后的回合', () => {
    const result = truncateTurnsForRerun([turn('a'), turn('b'), turn('c')], turn('b', '改过的问题'))
    expect(result.map((item) => item.id)).toEqual(['a', 'b'])
    expect(result[1].userMessage.text).toBe('改过的问题')
  })

  it('重跑最后一轮时只替换', () => {
    expect(truncateTurnsForRerun([turn('a'), turn('b')], turn('b', 'x')).map((item) => item.userMessage.text)).toEqual(['a', 'x'])
  })

  it('找不到目标轮时原样返回', () => {
    const turns = [turn('a')]
    expect(truncateTurnsForRerun(turns, turn('z'))).toBe(turns)
  })
})
