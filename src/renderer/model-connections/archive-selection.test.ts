import { describe, expect, it } from 'vitest'
import type { ArchiveEntry } from './archive-selection'
import { entryState, selectAll, selectedCount, setEntryModels, toggleEntry, toggleModel } from './archive-selection'

const entries: ArchiveEntry[] = [
  { key: 'a', name: 'DeepSeek', meta: 'DeepSeek · 2 个模型', models: [{ id: 'chat', label: 'Chat' }, { id: 'coder', label: 'Coder' }] },
  { key: 'b', name: '空连接', meta: '自定义 · 0 个模型', models: [] }
]

describe('archive selection', () => {
  it('默认全选包含每条连接的全部模型', () => {
    const selection = selectAll(entries)
    expect(selection).toEqual({ a: ['chat', 'coder'], b: [] })
    expect(entryState(selection, entries[0])).toBe('all')
    expect(entryState(selection, entries[1])).toBe('all')
    expect(selectedCount(selection)).toEqual({ entries: 2, models: 2 })
  })

  it('连接级勾选整选整不选', () => {
    const cleared = toggleEntry(selectAll(entries), entries[0])
    expect(cleared.a).toBeUndefined()
    expect(entryState(cleared, entries[0])).toBe('none')
    expect(toggleEntry(cleared, entries[0]).a).toEqual(['chat', 'coder'])
  })

  it('模型级勾选产生部分状态，且保持原始顺序', () => {
    const partial = toggleModel(selectAll(entries), entries[0], 'chat')
    expect(partial.a).toEqual(['coder'])
    expect(entryState(partial, entries[0])).toBe('partial')
    expect(toggleModel(partial, entries[0], 'chat').a).toEqual(['chat', 'coder'])
  })

  it('取消最后一个模型等于取消整条连接', () => {
    const none = toggleModel({ a: ['chat'] }, entries[0], 'chat')
    expect(none.a).toBeUndefined()
    expect(selectedCount(none)).toEqual({ entries: 0, models: 0 })
  })

  it('setEntryModels 清空即取消连接', () => {
    expect(setEntryModels({}, entries[0], ['chat'])).toEqual({ a: ['chat'] })
    expect(setEntryModels({ a: ['chat'] }, entries[0], [])).toEqual({})
  })
})
