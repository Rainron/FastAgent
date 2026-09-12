import { describe, expect, it } from 'vitest'
import { createComposerHistory } from './composer-history'

const snap = (value: string, caret = value.length) => ({ value, caret })

describe('createComposerHistory', () => {
  it('连续打字在时间窗内合并为一个撤销点', () => {
    const history = createComposerHistory()
    history.record(snap(''), 0)
    history.record(snap('a'), 100)
    history.record(snap('ab'), 300)
    // 时间窗内：两次都并入第一个快照，一次 undo 回到空
    expect(history.undo(snap('abc', 3))).toEqual(snap(''))
  })

  it('超出时间窗的打字产生多个撤销点', () => {
    const history = createComposerHistory()
    history.record(snap(''), 0)
    history.record(snap('a'), 100)
    history.record(snap('ab'), 1000)
    const first = history.undo(snap('abc', 3))
    expect(first).toEqual(snap('ab'))
    const second = history.undo({ value: 'ab', caret: 2 })
    expect(second).toEqual(snap(''))
  })

  it('程序化改值强制独立成撤销点', () => {
    const history = createComposerHistory()
    history.record(snap(''), 0)
    history.record(snap('a'), 100)
    // 插入引用前记录变更前的状态 'a'，强制不合并
    history.record(snap('a'), 150, true)
    const target = history.undo(snap('a\n> 引用'))
    expect(target).toEqual(snap('a'))
  })

  it('撤销后可重做，重做后可再撤销', () => {
    const history = createComposerHistory()
    history.record(snap(''), 0)
    history.record(snap('a'), 1000)
    const undone = history.undo(snap('ab', 2))
    expect(undone).toEqual(snap('a'))
    const redone = history.redo(snap('a', 1))
    // redo 返回撤销前的当前态
    expect(redone).toEqual(snap('ab', 2))
    expect(history.redo(snap('ab', 2))).toBeNull()
  })

  it('撤销后输入新内容，重做分支被丢弃', () => {
    const history = createComposerHistory()
    history.record(snap(''), 0)
    history.record(snap('a'), 1000)
    history.undo(snap('ab', 2))
    history.record(snap('a', 1), 2000)
    expect(history.canRedo()).toBe(false)
    expect(history.canUndo()).toBe(true)
  })

  it('空历史时 undo/redo 返回 null', () => {
    const history = createComposerHistory()
    expect(history.undo(snap('x'))).toBeNull()
    expect(history.redo(snap('x'))).toBeNull()
  })

  it('超过容量上限时丢弃最旧快照', () => {
    const history = createComposerHistory({ limit: 2 })
    history.record(snap('1'), 0)
    history.record(snap('2'), 1000)
    history.record(snap('3'), 2000)
    history.record(snap('4'), 3000)
    const target = history.undo(snap('5'))
    expect(target).toEqual(snap('4'))
  })
})
