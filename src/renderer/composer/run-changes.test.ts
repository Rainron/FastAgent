import { describe, expect, it } from 'vitest'
import type { AgentFileChange, AgentRunChanges } from '../../shared/types'
import { compositionLabel, currentFileLabel, EMPTY_RUN_CHANGES, runBarLabel, shouldShowRunBar, sortForList } from './run-changes'

function file(patch: Partial<AgentFileChange>): AgentFileChange {
  return { path: 'src/a.ts', operation: 'update', additions: 0, deletions: 0, tools: ['edit'], hasDiff: true, updatedAt: 1, ...patch }
}

function changes(patch: Partial<AgentRunChanges>): AgentRunChanges {
  return { ...EMPTY_RUN_CHANGES, turnId: 't1', ...patch }
}

describe('runBarLabel', () => {
  it('报文件数，单复数区分', () => {
    expect(runBarLabel(changes({ changedFiles: 6 }), false)).toBe('6 files')
    expect(runBarLabel(changes({ changedFiles: 1 }), false)).toBe('1 file')
  })

  it('没有变更时结束态说 No changes，执行中说 Working', () => {
    expect(runBarLabel(changes({}), false)).toBe('No changes')
    expect(runBarLabel(changes({}), true)).toBe('Working')
  })
})

describe('shouldShowRunBar', () => {
  it('执行中一律不显示，哪怕已经改了文件', () => {
    expect(shouldShowRunBar({ turnId: 't1', running: true, changedFiles: 0 })).toBe(false)
    expect(shouldShowRunBar({ turnId: 't1', running: true, changedFiles: 3 })).toBe(false)
  })

  it('终态且有改动才显示', () => {
    expect(shouldShowRunBar({ turnId: 't1', running: false, changedFiles: 3 })).toBe(true)
    expect(shouldShowRunBar({ turnId: 't1', running: false, changedFiles: 0 })).toBe(false)
  })

  it('没有回合时不显示', () => {
    expect(shouldShowRunBar({ turnId: null, running: false, changedFiles: 3 })).toBe(false)
  })
})

describe('currentFileLabel', () => {
  it('执行中提示最近改动的文件', () => {
    const state = changes({ changedFiles: 2, files: [file({ path: 'src/store/session.ts' }), file({})] })
    expect(currentFileLabel(state)).toBe('Editing session.ts')
  })

  it('还没碰文件时为空，界面据此不渲染这一段', () => {
    expect(currentFileLabel(changes({}))).toBe('')
  })
})

describe('compositionLabel', () => {
  it('只列非零项', () => {
    expect(compositionLabel(changes({ addedFiles: 1, modifiedFiles: 3 }))).toBe('1 added · 3 modified')
    expect(compositionLabel(changes({ addedFiles: 2, modifiedFiles: 3, deletedFiles: 1 }))).toBe('2 added · 3 modified · 1 deleted')
  })

  it('全零返回空串，界面据此不渲染这一段', () => {
    expect(compositionLabel(changes({}))).toBe('')
  })
})

describe('sortForList', () => {
  it('按新增 → 修改 → 重命名 → 删除分组，组内按路径', () => {
    const sorted = sortForList([
      file({ path: 'z.ts', operation: 'delete' }),
      file({ path: 'b.ts', operation: 'update' }),
      file({ path: 'a.ts', operation: 'update' }),
      file({ path: 'n.ts', operation: 'create' })
    ])
    expect(sorted.map((item) => item.path)).toEqual(['n.ts', 'a.ts', 'b.ts', 'z.ts'])
  })

  it('不改原数组', () => {
    const input = [file({ path: 'b.ts' }), file({ path: 'a.ts' })]
    sortForList(input)
    expect(input.map((item) => item.path)).toEqual(['b.ts', 'a.ts'])
  })
})
