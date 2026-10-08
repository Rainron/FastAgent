import { describe, expect, it } from 'vitest'
import { groupShellEntries, type ShellCommandEntry } from './shell-entries'

function entry(id: string, anchorTurnId: string | null): ShellCommandEntry {
  return {
    id,
    command: 'ls',
    anchorTurnId,
    output: '',
    status: 'running',
    exitCode: null,
    error: null,
    truncated: false,
    cwd: 'K:/repo',
    startedAt: 0,
    finishedAt: null
  }
}

describe('groupShellEntries', () => {
  it('没有命令时返回空分组', () => {
    expect(groupShellEntries([], ['t1'])).toEqual({ leading: [], byTurnId: {} })
  })

  it('按锚点回合归位，同一锚点保持先后顺序', () => {
    const grouped = groupShellEntries([entry('a', 't1'), entry('b', 't2'), entry('c', 't1')], ['t1', 't2'])
    expect(grouped.byTurnId.t1.map((item) => item.id)).toEqual(['a', 'c'])
    expect(grouped.byTurnId.t2.map((item) => item.id)).toEqual(['b'])
    expect(grouped.leading).toEqual([])
  })

  it('会话还没有回合时全部排在最前', () => {
    const grouped = groupShellEntries([entry('a', null)], [])
    expect(grouped.leading.map((item) => item.id)).toEqual(['a'])
    expect(grouped.byTurnId).toEqual({})
  })

  it('空会话执行的命令在新增问答后仍然排在最前', () => {
    const grouped = groupShellEntries([entry('a', null)], ['t1', 't2'])
    expect(grouped.leading.map((item) => item.id)).toEqual(['a'])
    expect(grouped.byTurnId).toEqual({})
  })

  it('锚点回合被删掉时退回最后一轮，不丢卡片', () => {
    const grouped = groupShellEntries([entry('a', 'gone')], ['t1', 't2'])
    expect(grouped.byTurnId.t2.map((item) => item.id)).toEqual(['a'])
  })
})
