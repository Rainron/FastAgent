import { describe, expect, it } from 'vitest'
import { dropShellEntriesFrom, groupShellEntries, type ShellCommandEntry } from './shell-entries'

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

describe('dropShellEntriesFrom', () => {
  const done = (id: string, anchor: string | null): ShellCommandEntry => ({ ...entry(id, anchor), status: 'completed' as ShellCommandEntry['status'] })

  it('清掉锚在重跑轮及之后的命令，保留更早的与会话开头的', () => {
    const entries = [done('lead', null), done('a', 't1'), done('b', 't2'), done('c', 't3')]
    expect(dropShellEntriesFrom(entries, ['t1', 't2', 't3'], 't2').map((item) => item.id)).toEqual(['lead', 'a'])
  })

  it('锚点已不存在的按末尾处理一并清掉，还在跑的保留', () => {
    const entries = [done('gone', 'deleted'), entry('live', 't3')]
    expect(dropShellEntriesFrom(entries, ['t1', 't2', 't3'], 't2').map((item) => item.id)).toEqual(['live'])
  })

  it('重跑轮不在列表里时原样返回', () => {
    const entries = [done('a', 't1')]
    expect(dropShellEntriesFrom(entries, ['t1'], 'nope')).toEqual(entries)
  })
})
