import { expect, it } from 'vitest'
import { cropSidebarList, mergeSidebarPage, resolveConversationRequest, type ConversationRequestScope } from './sidebar-list'

it('keeps required active items beyond the preview limit', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  expect(cropSidebarList(rows, 1, false, new Set(['c']))).toEqual([rows[0], rows[2]])
  expect(cropSidebarList(rows, 1, true)).toEqual(rows)
})
it('handles zero, exact limit, over limit and a limit of one', () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({ id: String(index) }))
  expect(cropSidebarList(rows, 2, false)).toEqual(rows.slice(0, 2))
  expect(cropSidebarList(rows.slice(0, 2), 2, false)).toEqual(rows.slice(0, 2))
  expect(cropSidebarList(rows, 1, false)).toEqual(rows.slice(0, 1))
  expect(cropSidebarList([], 1, false)).toEqual([])
  expect(cropSidebarList(rows, 1, true)).toEqual(rows)
})
it('merges overlapping pages without duplicates and refreshes matching records', () => {
  expect(mergeSidebarPage([{ id: 'a', title: 'old' }, { id: 'b', title: 'b' }], [{ id: 'a', title: 'new' }, { id: 'c', title: 'c' }])).toEqual([{ id: 'a', title: 'new' }, { id: 'b', title: 'b' }, { id: 'c', title: 'c' }])
})

const scope = (patch: Partial<ConversationRequestScope> = {}): ConversationRequestScope => ({ projectId: 'p1', refreshKey: 0, expanded: true, page: 1, limit: 5, ...patch })

it('does not request while collapsed, even on a later page', () => {
  expect(resolveConversationRequest(scope({ expanded: false, page: 3 }), scope({ expanded: false, page: 3 }))).toEqual({ kind: 'idle' })
  expect(resolveConversationRequest(null, scope({ expanded: false }))).toEqual({ kind: 'idle' })
})

it('requests the first page on first expand and replaces existing rows', () => {
  expect(resolveConversationRequest(scope({ expanded: false }), scope({ page: 1, limit: 5 }))).toEqual({ kind: 'fetch', page: 1, limit: 5, replace: true })
})

it('requests the loaded page when nothing about the scope changed', () => {
  expect(resolveConversationRequest(scope({ page: 2 }), scope({ page: 2 }))).toEqual({ kind: 'fetch', page: 2, limit: 5, replace: false })
})

it('resets to page one when the project or the refresh key changes', () => {
  expect(resolveConversationRequest(scope({ page: 3 }), scope({ projectId: 'p2', page: 3 }))).toEqual({ kind: 'reset' })
  expect(resolveConversationRequest(scope({ page: 3 }), scope({ refreshKey: 1, page: 3 }))).toEqual({ kind: 'reset' })
  // 已经是第一页时不用多跑一帧归位，直接发请求
  expect(resolveConversationRequest(scope({ page: 3 }), scope({ projectId: 'p2' }))).toEqual({ kind: 'fetch', page: 1, limit: 5, replace: true })
})

it('resets when the batch size changes so stale pages are not appended', () => {
  expect(resolveConversationRequest(scope({ page: 2, limit: 5 }), scope({ page: 2, limit: 100 }))).toEqual({ kind: 'reset' })
})

it('merges continuation pages instead of replacing them', () => {
  expect(resolveConversationRequest(scope({ page: 1 }), scope({ page: 2 }))).toEqual({ kind: 'fetch', page: 2, limit: 5, replace: false })
})
