import { describe, expect, it } from 'vitest'
import { coverageLabel, triggerLabel } from './CompactionHistory'

describe('coverageLabel', () => {
  it('按 1 基序号给出回合范围', () => {
    expect(coverageLabel({ coveredTurnStart: 2, coveredTurnEnd: 4 })).toBe('回合 2-4 · 3 轮')
  })

  it('Pi 会话内压缩按消息切，没有回合范围', () => {
    expect(coverageLabel({ coveredTurnStart: null, coveredTurnEnd: null })).toBeNull()
    expect(coverageLabel({ coveredTurnStart: 1, coveredTurnEnd: null })).toBeNull()
  })
})

describe('triggerLabel', () => {
  it('把内部触发标识翻成人话，未知值原样透出', () => {
    expect(triggerLabel('pi-threshold')).toBe('自动（达到阈值）')
    expect(triggerLabel('pi-overflow')).toBe('自动（上下文溢出）')
    expect(triggerLabel('manual')).toBe('手动')
    expect(triggerLabel('model-switch')).toBe('换模型')
    expect(triggerLabel('something-else')).toBe('something-else')
  })
})
