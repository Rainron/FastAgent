import { describe, expect, it } from 'vitest'
import type { AgentFileChange, AgentRunChanges } from '../../shared/types'
import { canRevertTurn, fileTag, revertConfirmLines, revertNotice, sortForList, splitPath, turnChangesTitle } from './turn-changes'

function file(patch: Partial<AgentFileChange>): AgentFileChange {
  return { path: 'src/a.ts', operation: 'update', additions: 0, deletions: 0, tools: ['edit'], hasDiff: true, reverted: false, updatedAt: 1, ...patch }
}

function changes(files: AgentFileChange[]): AgentRunChanges {
  return { turnId: 't1', changedFiles: files.length, addedFiles: 0, modifiedFiles: 0, deletedFiles: 0, renamedFiles: 0, additions: 0, deletions: 0, files }
}

describe('splitPath', () => {
  it('拆出目录（带尾斜杠）与文件名', () => {
    expect(splitPath('src/main/ipc/harness.ts')).toEqual({ dir: 'src/main/ipc/', name: 'harness.ts' })
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
  })
})

describe('sortForList', () => {
  it('按新增、修改、重命名、删除分组，组内按路径', () => {
    const sorted = sortForList([
      file({ path: 'z.ts', operation: 'delete' }),
      file({ path: 'b.ts' }),
      file({ path: 'a.ts' }),
      file({ path: 'n.ts', operation: 'create' })
    ])
    expect(sorted.map((item) => item.path)).toEqual(['n.ts', 'a.ts', 'b.ts', 'z.ts'])
  })
})

describe('fileTag', () => {
  it('修改不标，其余标状态，已撤销优先', () => {
    expect(fileTag(file({}))).toBe('')
    expect(fileTag(file({ operation: 'create' }))).toBe('新建')
    expect(fileTag(file({ operation: 'delete' }))).toBe('删除')
    expect(fileTag(file({ operation: 'create', reverted: true }))).toBe('已撤销')
  })
})

describe('标题与撤销入口', () => {
  it('还有未撤销的文件时显示已编辑并允许撤销', () => {
    const value = changes([file({}), file({ path: 'b.ts', reverted: true })])
    expect(turnChangesTitle(value)).toBe('已编辑 2 个文件')
    expect(canRevertTurn(value)).toBe(true)
  })

  it('全部撤销后改为已撤销，撤销入口消失', () => {
    const value = changes([file({ reverted: true }), file({ path: 'b.ts', reverted: true })])
    expect(turnChangesTitle(value)).toBe('已撤销 2 个文件的修改')
    expect(canRevertTurn(value)).toBe(false)
  })
})

describe('revertConfirmLines', () => {
  it('只统计未撤销的文件，并说明新建的会被删除', () => {
    const lines = revertConfirmLines(changes([
      file({}),
      file({ path: 'n.ts', operation: 'create' }),
      file({ path: 'd.ts', operation: 'delete' }),
      file({ path: 'r.ts', reverted: true })
    ]))
    expect(lines[0]).toBe('把这一轮对 3 个文件的改动退回去：1 个修改的文件写回改动前的内容，1 个新建的文件会被删除，1 个被删的文件会恢复。')
    expect(lines[1]).toContain('跳过')
  })
})

describe('revertNotice', () => {
  it('全部成功只报数量', () => {
    expect(revertNotice({ reverted: ['a.ts', 'b.ts'], skipped: [] })).toBe('已撤销 2 个文件')
    expect(revertNotice({ reverted: [], skipped: [] })).toBe('没有需要撤销的文件')
  })

  it('有跳过时列出前两个原因，超出的只报总数', () => {
    expect(revertNotice({ reverted: ['a.ts'], skipped: [{ path: 'src/b.ts', reason: '这一轮之后文件又被改过' }] }))
      .toBe('已撤销 1 个文件，b.ts（这一轮之后文件又被改过）未撤销')
    const many = revertNotice({ reverted: [], skipped: ['x', 'y', 'z'].map((name) => ({ path: `${name}.ts`, reason: '原因' })) })
    expect(many).toBe('已撤销 0 个文件，x.ts（原因）、y.ts（原因） 等 3 个未撤销')
  })
})
