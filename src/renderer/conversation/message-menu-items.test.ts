import { describe, expect, it, vi } from 'vitest'
import type { ConversationTurn } from '../../shared/types'
import { buildMessageMenuItems, type MessageMenuHandlers } from './message-menu-items'

const turn = {
  id: 'turn-1',
  conversationId: 'c-1',
  userMessage: { text: '问题正文', createdAt: '' },
  assistantMessage: { text: '回答正文', createdAt: '' },
  attachments: [],
  activity: null,
  citations: [],
  artifacts: [],
  runtimeConfig: {},
  status: 'completed',
  createdAt: '',
  updatedAt: ''
} as unknown as ConversationTurn

const handlers = (): MessageMenuHandlers => ({
  copyText: vi.fn(),
  quote: vi.fn(),
  rerun: vi.fn(),
  saveKnowledge: vi.fn(),
  deleteTurn: vi.fn()
})

const ids = (items: ReturnType<typeof buildMessageMenuItems>) => items.map((item) => item.id)

describe('buildMessageMenuItems', () => {
  it('用户侧给「重新发送」，助手侧给「重新生成」', () => {
    expect(ids(buildMessageMenuItems({ turn, side: 'user', selected: '', projectId: null }, handlers())))
      .toEqual(['copy-message', 'quote', 'retry', 'delete'])
    expect(ids(buildMessageMenuItems({ turn, side: 'assistant', selected: '', projectId: null }, handlers())))
      .toEqual(['copy-message', 'quote', 'regenerate', 'delete'])
  })

  it('有划选时在最前面补一条「复制选中」', () => {
    const items = buildMessageMenuItems({ turn, side: 'user', selected: '片段', projectId: null }, handlers())
    expect(ids(items)[0]).toBe('copy-selection')
  })

  it('未归属项目时没有存为知识这一项', () => {
    expect(ids(buildMessageMenuItems({ turn, side: 'user', selected: '', projectId: null }, handlers())))
      .not.toContain('save-knowledge')
  })

  it('归属项目时存知识优先用划选内容，文案随之变化', () => {
    const h = handlers()
    const withSelection = buildMessageMenuItems({ turn, side: 'assistant', selected: '片段', projectId: 'p-1' }, h)
    const entry = withSelection.find((item) => item.id === 'save-knowledge')
    expect(entry?.label).toBe('把选中内容存为知识')
    entry?.onSelect()
    expect(h.saveKnowledge).toHaveBeenCalledWith('p-1', '片段')

    const h2 = handlers()
    const withoutSelection = buildMessageMenuItems({ turn, side: 'assistant', selected: '', projectId: 'p-1' }, h2)
    const entry2 = withoutSelection.find((item) => item.id === 'save-knowledge')
    expect(entry2?.label).toBe('存为项目知识')
    entry2?.onSelect()
    expect(h2.saveKnowledge).toHaveBeenCalledWith('p-1', '回答正文')
  })

  it('正文为空白时不给存知识入口', () => {
    const blank = { ...turn, assistantMessage: { text: '   ', createdAt: '' } } as ConversationTurn
    expect(ids(buildMessageMenuItems({ turn: blank, side: 'assistant', selected: '', projectId: 'p-1' }, handlers())))
      .not.toContain('save-knowledge')
  })

  it('删除项始终在最后且标记为危险操作', () => {
    const items = buildMessageMenuItems({ turn, side: 'user', selected: '片段', projectId: 'p-1' }, handlers())
    expect(items.at(-1)).toMatchObject({ id: 'delete', danger: true })
  })
})
