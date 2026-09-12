import { describe, expect, it } from 'vitest'
import { modelChangeTurnIds } from './model-change-marker'

function turn(id: string, modelId: number | null) {
  return { id, runtimeConfig: { modelId, thinkingLevel: 'auto' as const, mode: 'chat' as const, permission: null, project: null } }
}

describe('modelChangeTurnIds', () => {
  it('首个回合不算切换', () => {
    expect([...modelChangeTurnIds([turn('t1', 1)])]).toEqual([])
  })

  it('标出模型发生变化的回合', () => {
    expect([...modelChangeTurnIds([turn('t1', 1), turn('t2', 1), turn('t3', 2), turn('t4', 2), turn('t5', 1)])]).toEqual(['t3', 't5'])
  })

  it('没记录模型的旧回合不产生切换', () => {
    expect([...modelChangeTurnIds([turn('t1', null), turn('t2', 1), turn('t3', null), turn('t4', 1)])]).toEqual([])
  })

  it('空会话返回空集合', () => {
    expect(modelChangeTurnIds([]).size).toBe(0)
  })
})
