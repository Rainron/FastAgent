import { describe, expect, it } from 'vitest'
import type { ConversationRecord, ConversationTurn } from '../shared/types'
import { buildConversationHtml, buildConversationMarkdown, exportFormatFromPath, formatDateTime, sanitizeFilename } from './conversation-export'

const conversation: ConversationRecord = {
  id: 'conversation-1',
  title: '修复登录超时/崩溃问题',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
  archived: false,
  projectId: null,
  modelId: null,
}

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    id: 'turn-1',
    conversationId: conversation.id,
    userMessage: { text: '帮我看下这个问题', createdAt: '2026-09-01T10:00:00.000Z' },
    attachments: [],
    activity: null,
    assistantMessage: { text: '已经修复，原因是超时设置过短。', createdAt: '2026-09-01T10:01:00.000Z' },
    citations: [],
    artifacts: [],
    runtimeConfig: { modelId: null, thinkingLevel: 'off', mode: 'agent', permission: null, project: null },
    status: 'completed',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:01:00.000Z',
    ...overrides,
  }
}

describe('sanitizeFilename', () => {
  it('替换 Windows 非法字符', () => {
    expect(sanitizeFilename('a<b>:c?"d|e/f\\g')).toBe('a b c d e f g')
  })

  it('空标题回落默认名', () => {
    expect(sanitizeFilename('   ')).toBe('conversation')
  })
})

describe('formatDateTime', () => {
  it('固定格式输出', () => {
    expect(formatDateTime('2026-09-01T10:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('非法输入返回空串', () => {
    expect(formatDateTime('not-a-date')).toBe('')
  })
})

describe('buildConversationMarkdown', () => {
  const turns = [
    makeTurn({
      id: 'turn-1',
      attachments: [{ id: 'a1', name: '截图.png', type: 'image/png', size: 100 }],
      citations: [{ title: '相关文档', url: 'https://example.com/doc' }],
    }),
    makeTurn({
      id: 'turn-2',
      userMessage: { text: '再检查一遍', createdAt: '2026-09-01T11:00:00.000Z' },
      assistantMessage: null,
      status: 'failed',
    }),
  ]

  it('包含标题、轮次、用户与助手内容', () => {
    const markdown = buildConversationMarkdown(conversation, turns, '2026-09-02T12:00:00.000Z')
    expect(markdown).toContain('# 修复登录超时/崩溃问题')
    expect(markdown).toContain('## 1 · 用户')
    expect(markdown).toContain('帮我看下这个问题')
    expect(markdown).toContain('## 1 · 助手')
    expect(markdown).toContain('已经修复')
    expect(markdown).toContain('> 附件：截图.png')
    expect(markdown).toContain('[相关文档](https://example.com/doc)')
    expect(markdown).toContain('（本轮失败）')
    expect(markdown).toContain('对话轮数：2')
  })

  it('没有助手回复的轮次只输出用户段', () => {
    const markdown = buildConversationMarkdown(conversation, turns, '2026-09-02T12:00:00.000Z')
    expect(markdown).toContain('## 2 · 用户')
    expect(markdown).not.toContain('## 2 · 助手')
  })
})

describe('buildConversationHtml', () => {
  it('输出自包含页面并转义内容', () => {
    const turns = [makeTurn({ userMessage: { text: '<script>alert(1)</script>', createdAt: '2026-09-01T10:00:00.000Z' } })]
    const html = buildConversationHtml(conversation, turns, '2026-09-02T12:00:00.000Z')
    expect(html).toContain('<!doctype html>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('对话轮数：1')
  })
})

describe('exportFormatFromPath', () => {
  it('按扩展名判定格式', () => {
    expect(exportFormatFromPath('C:\\out\\会话.md')).toBe('markdown')
    expect(exportFormatFromPath('C:\\out\\会话.HTML')).toBe('html')
    expect(exportFormatFromPath('C:\\out\\会话.txt')).toBe('markdown')
  })
})
