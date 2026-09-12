import { describe, expect, it } from 'vitest'
import type { ConversationRecord, ConversationTurn } from '../../shared/types'
import { mergeStreamedText, normalizeRenameInput, titleFromPrompt, toWorkspaceConversation } from './conversation-meta'

function turn(patch: Partial<ConversationTurn> & { id: string }): ConversationTurn {
  return {
    conversationId: 'c1',
    userMessage: { text: '', createdAt: '2026-01-01T00:00:00.000Z' },
    attachments: [],
    activity: null,
    assistantMessage: null,
    citations: [],
    artifacts: [],
    runtimeConfig: { modelId: null, thinkingLevel: 'auto', mode: 'chat', permission: null, project: null },
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch
  }
}

describe('titleFromPrompt', () => {
  it('折叠空白并保留原文', () => {
    expect(titleFromPrompt('  帮我  重构\n这个模块 ')).toBe('帮我 重构 这个模块')
  })

  it('超过 36 字截断并加省略号', () => {
    expect(titleFromPrompt('字'.repeat(40))).toBe(`${'字'.repeat(36)}…`)
  })

  it('全空白回落到默认标题', () => {
    expect(titleFromPrompt('   \n  ')).toBe('新对话')
  })
})

describe('toWorkspaceConversation', () => {
  it('保留归属与模型绑定', () => {
    const record: ConversationRecord = { id: 'c1', title: '标题', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', archived: true, projectId: 'p1', modelId: -3 }
    const item = toWorkspaceConversation(record)
    expect(item).toMatchObject({ id: 'c1', title: '标题', archived: true, projectId: 'p1', modelId: -3 })
    expect(item.meta).not.toBe('')
  })
})

describe('mergeStreamedText', () => {
  it('缓存为空时原样返回同一个数组', () => {
    const turns = [turn({ id: 't1' })]
    expect(mergeStreamedText(turns, new Map())).toBe(turns)
  })

  it('库里没有正文时贴回内存中的流式文本', () => {
    const merged = mergeStreamedText([turn({ id: 't1' })], new Map([['t1', '流式片段']]))
    expect(merged[0].assistantMessage?.text).toBe('流式片段')
  })

  it('库里的正文更长时以库为准', () => {
    const turns = [turn({ id: 't1', assistantMessage: { text: '完整的落库回答', createdAt: '2026-01-01T00:00:01.000Z' } })]
    const merged = mergeStreamedText(turns, new Map([['t1', '短']]))
    expect(merged[0].assistantMessage?.text).toBe('完整的落库回答')
  })

  it('缓存里没有的回合保持原引用', () => {
    const kept = turn({ id: 't2' })
    const merged = mergeStreamedText([turn({ id: 't1' }), kept], new Map([['t1', 'x']]))
    expect(merged[1]).toBe(kept)
  })
})

describe('normalizeRenameInput', () => {
  it('折叠空白并去掉首尾空格', () => {
    expect(normalizeRenameInput('  重构  登录\n流程 ', '旧标题')).toBe('重构 登录 流程')
  })

  it('全空白视为不改名', () => {
    expect(normalizeRenameInput('   \n ', '旧标题')).toBeNull()
  })

  it('与原标题相同时不改名', () => {
    expect(normalizeRenameInput('旧标题', '旧标题')).toBeNull()
    // 归一化之后才相同的也算没改
    expect(normalizeRenameInput('  旧标题  ', '旧标题')).toBeNull()
  })

  it('超长按上限截断，不加省略号', () => {
    expect(normalizeRenameInput('字'.repeat(50), '旧标题')).toBe('字'.repeat(36))
  })

  it('截断后与原标题相同也算没改', () => {
    expect(normalizeRenameInput('字'.repeat(50), '字'.repeat(36))).toBeNull()
  })
})
