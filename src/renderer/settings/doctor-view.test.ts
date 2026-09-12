import { describe, expect, it } from 'vitest'
import type { DoctorCheck } from '../../shared/types'
import { groupChecks, overallLabel } from './doctor-view'

function check(patch: Partial<DoctorCheck>): DoctorCheck {
  return { id: 'x', label: 'X', category: 'toolchain', status: 'ok', detail: '', ...patch }
}

describe('groupChecks', () => {
  it('按固定顺序分组，不受探测返回顺序影响', () => {
    const checks = [
      check({ id: 'a', category: 'abilities' }),
      check({ id: 'b', category: 'toolchain' }),
      check({ id: 'c', category: 'sandbox' })
    ]
    expect(groupChecks(checks).map(([category]) => category)).toEqual(['toolchain', 'sandbox', 'abilities'])
  })

  it('没有条目的分类不出现', () => {
    expect(groupChecks([check({ category: 'shell' })]).map(([category]) => category)).toEqual(['shell'])
  })

  it('同一分类的条目聚在一起并保持原顺序', () => {
    const checks = [check({ id: 'git' }), check({ id: 'node' }), check({ id: 'ws', category: 'workspace' })]
    const [[, toolchain]] = groupChecks(checks)
    expect(toolchain.map((item) => item.id)).toEqual(['git', 'node'])
  })

  it('空清单返回空数组', () => {
    expect(groupChecks([])).toEqual([])
  })
})

describe('overallLabel', () => {
  it('全部正常时只报条数', () => {
    expect(overallLabel({ overall: 'ok', summary: { ok: 8, warn: 0, missing: 0, error: 0 } })).toBe('全部正常（8 项）')
  })

  it('有问题时按严重度依次列出计数', () => {
    expect(overallLabel({ overall: 'error', summary: { ok: 3, warn: 2, missing: 1, error: 1 } }))
      .toBe('1 项异常 · 1 项缺失 · 2 项提示')
  })

  it('为 0 的档不出现', () => {
    expect(overallLabel({ overall: 'warn', summary: { ok: 5, warn: 2, missing: 0, error: 0 } })).toBe('2 项提示')
  })
})
