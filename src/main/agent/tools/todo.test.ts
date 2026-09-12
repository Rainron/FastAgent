import { describe, expect, it } from 'vitest'
import { assignPhasePositions } from './todo'

describe('assignPhasePositions', () => {
  it('按阶段名首次出现顺序编号，同名复用同一个序号', () => {
    expect(assignPhasePositions([
      { phase: '准备' },
      { phase: '实施' },
      { phase: '准备' },
      { phase: '验证' }
    ])).toEqual([1, 2, 1, 3])
  })

  it('未命名阶段固定为 0，排在所有命名阶段之前', () => {
    expect(assignPhasePositions([{ phase: '实施' }, {}, { phase: '实施' }])).toEqual([1, 0, 1])
  })

  it('全部未分组时全为 0', () => {
    expect(assignPhasePositions([{}, {}])).toEqual([0, 0])
  })

  it('不按字典序编号：中文阶段名的字典序与执行顺序无关', () => {
    // 「准备」拼音在「实施」之后，按字典序会颠倒，必须按出现顺序
    expect(assignPhasePositions([{ phase: '准备' }, { phase: '实施' }])).toEqual([1, 2])
  })

  it('空输入不产生结果', () => {
    expect(assignPhasePositions([])).toEqual([])
  })
})
