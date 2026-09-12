import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { conversationSessionDir, legacyConversationSessionDir, sanitizeSegment, sessionDateSegment, sessionUserSegment, userIdFromNamespace } from './session-paths'

describe('session-paths', () => {
  it('折叠非法字符并在结果为空时回落', () => {
    expect(sanitizeSegment('张三 / admin', 'fallback')).toBe('admin')
    expect(sanitizeSegment('a b/c', 'fallback')).toBe('a-b-c')
    expect(sanitizeSegment('...', 'fallback')).toBe('fallback')
    expect(sanitizeSegment('admin', 'fallback')).toBe('admin')
  })

  it('从 namespace 取 userId', () => {
    expect(userIdFromNamespace('https://api.example.com::42')).toBe('42')
    expect(userIdFromNamespace('no-separator')).toBe('no-separator')
  })

  it('username 缺失时回落 userId', () => {
    expect(sessionUserSegment('https://api.example.com::42', 'admin')).toBe('admin')
    expect(sessionUserSegment('https://api.example.com::42', '  ')).toBe('42')
    expect(sessionUserSegment('https://api.example.com::42', null)).toBe('42')
  })

  it('日期段按本地时区取，非法输入回落', () => {
    const createdAt = new Date(2026, 8, 4, 10, 15).toISOString()
    expect(sessionDateSegment(createdAt)).toBe('2026-09-04')
    expect(sessionDateSegment('not-a-date')).toBe('unknown-date')
    expect(sessionDateSegment(null)).toBe('unknown-date')
  })

  it('会话目录按 用户/日期/会话 三层拼', () => {
    const createdAt = new Date(2026, 8, 4, 10, 15).toISOString()
    expect(conversationSessionDir('/root/sessions', { userSegment: 'admin', createdAt, conversationId: 'conversation-abc' }))
      .toBe(join('/root/sessions', 'admin', '2026-09-04', 'conversation-abc'))
  })

  it('legacy 目录仍是 namespace + 会话 id 的 sha256', () => {
    const expected = createHash('sha256').update('ns\tconversation-abc').digest('hex')
    expect(legacyConversationSessionDir('/root/sessions', 'ns', 'conversation-abc')).toBe(join('/root/sessions', expected))
  })
})
