import { describe, expect, it } from 'vitest'
import { archiveWorkspaceItem, filterConversations, findActiveProjectConversation, removeWorkspaceItem, renameWorkspaceItem, toggleBatchPageSelection, toggleBatchSelection, upsertRecentWorkspaceItem } from './workspace-data'

describe('findActiveProjectConversation', () => {
  const items = [
    { id: 'a', projectId: 'p1', archived: false },
    { id: 'b', projectId: 'p1', archived: false },
    { id: 'c', projectId: 'p1', archived: true },
    { id: 'd', projectId: 'p2', archived: false }
  ]

  it('多条在跑时取最近有动静的那条', () => {
    const states = {
      a: { status: 'running', updatedAt: 10 },
      b: { status: 'waiting_user', updatedAt: 20 }
    }
    expect(findActiveProjectConversation(items, states, 'p1')?.id).toBe('b')
  })

  it('已归档与别的项目不参与', () => {
    const states = {
      c: { status: 'running', updatedAt: 99 },
      d: { status: 'running', updatedAt: 99 }
    }
    expect(findActiveProjectConversation(items, states, 'p1')).toBeNull()
  })

  it('只有收尾状态时不算进行中', () => {
    const states = { a: { status: 'completed', updatedAt: 30 }, b: { status: 'idle', updatedAt: 40 } }
    expect(findActiveProjectConversation(items, states, 'p1')).toBeNull()
  })

  it('paused 也算进行中', () => {
    expect(findActiveProjectConversation(items, { a: { status: 'paused', updatedAt: 1 } }, 'p1')?.id).toBe('a')
  })
})

describe('workspace data actions', () => {
  const items = [
    { id: 'one', name: 'One', archived: false },
    { id: 'two', name: 'Two', archived: false }
  ]

  it('archives only the selected item', () => {
    expect(archiveWorkspaceItem(items, 'two')).toEqual([
      { id: 'one', name: 'One', archived: false },
      { id: 'two', name: 'Two', archived: true }
    ])
  })

  it('removes only the selected item', () => {
    expect(removeWorkspaceItem(items, 'one')).toEqual([{ id: 'two', name: 'Two', archived: false }])
  })

  it('toggles an item in a batch selection set', () => {
    expect(toggleBatchSelection(new Set(['one']), 'two')).toEqual(new Set(['one', 'two']))
    expect(toggleBatchSelection(new Set(['one', 'two']), 'one')).toEqual(new Set(['two']))
  })

  it('selects and clears only the current batch page', () => {
    expect(toggleBatchPageSelection(new Set(['other-page']), ['one', 'two'])).toEqual(new Set(['other-page', 'one', 'two']))
    expect(toggleBatchPageSelection(new Set(['other-page', 'one', 'two']), ['one', 'two'])).toEqual(new Set(['other-page']))
  })

  it('places a sent conversation first and removes its stale duplicate', () => {
    expect(upsertRecentWorkspaceItem(items, { id: 'two', name: 'Updated', archived: false })).toEqual([
      { id: 'two', name: 'Updated', archived: false },
      { id: 'one', name: 'One', archived: false }
    ])
  })
})

describe('conversation scope filter', () => {
  const conversations = [
    { id: 'c1', title: '重构登录流', projectId: 'p1', archived: false },
    { id: 'c2', title: '发票 OCR 调研', projectId: 'p2', archived: false },
    { id: 'c3', title: '随手问个问题', projectId: null, archived: false },
    { id: 'c4', title: '归档的登录问题', projectId: 'p1', archived: true }
  ]

  it('按作用域切分未归属与具体项目', () => {
    expect(filterConversations(conversations, { scope: 'all' }).map((item) => item.id)).toEqual(['c1', 'c2', 'c3'])
    expect(filterConversations(conversations, { scope: 'unassigned' }).map((item) => item.id)).toEqual(['c3'])
    expect(filterConversations(conversations, { scope: 'p1' }).map((item) => item.id)).toEqual(['c1'])
  })

  it('关键词忽略大小写与首尾空白，空串不过滤', () => {
    expect(filterConversations(conversations, { scope: 'all', query: '  ocr ' }).map((item) => item.id)).toEqual(['c2'])
    expect(filterConversations(conversations, { scope: 'all', query: '   ' }).map((item) => item.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('默认排除归档会话，显式要求时才带上', () => {
    expect(filterConversations(conversations, { scope: 'p1' }).map((item) => item.id)).toEqual(['c1'])
    expect(filterConversations(conversations, { scope: 'p1', includeArchived: true }).map((item) => item.id)).toEqual(['c1', 'c4'])
  })
})

describe('renameWorkspaceItem', () => {
  const items = [
    { id: 'a', title: '第一条' },
    { id: 'b', title: '第二条' }
  ]

  it('只改中标的那条标题', () => {
    expect(renameWorkspaceItem(items, 'b', '改过了')).toEqual([
      { id: 'a', title: '第一条' },
      { id: 'b', title: '改过了' }
    ])
  })

  it('保持原有顺序，不把改名的顶到最前', () => {
    expect(renameWorkspaceItem(items, 'b', '改过了').map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('id 不存在时原样返回', () => {
    expect(renameWorkspaceItem(items, 'missing', '改过了')).toEqual(items)
  })

  it('不改动原数组', () => {
    renameWorkspaceItem(items, 'a', '改过了')
    expect(items[0].title).toBe('第一条')
  })
})
