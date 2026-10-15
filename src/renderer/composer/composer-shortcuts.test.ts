import { describe, expect, it } from 'vitest'
import { clearComposerDraft, isStopConversationShortcut, lineBoundary } from './composer-shortcuts'

describe('lineBoundary', () => {
  it('returns the start of the current line for Ctrl+Q', () => {
    expect(lineBoundary('one\ntwo\nthree', 7, 'start')).toBe(4)
  })

  it('returns the end of the current line for Ctrl+E', () => {
    expect(lineBoundary('one\ntwo\nthree', 5, 'end')).toBe(7)
  })

  it('handles line boundaries and a reversed caret safely', () => {
    expect(lineBoundary('one\ntwo', 0, 'start')).toBe(0)
    expect(lineBoundary('one\ntwo', 8, 'end')).toBe(7)
    expect(lineBoundary('one\ntwo', -1, 'start')).toBe(0)
  })
})

describe('Composer 草稿', () => {
  it('只清空本地文本和附件，不改动其它内容', () => {
    const attachment = { id: 'a', name: 'note.txt', type: 'text/plain', size: 4 }
    expect(clearComposerDraft('draft', [attachment])).toEqual({ text: '', attachments: [] })
  })
})

describe('Composer 固定快捷键', () => {
  it('只把非输入法组合的 Escape 交给停止流程', () => {
    expect(isStopConversationShortcut({ key: 'Escape' })).toBe(true)
    expect(isStopConversationShortcut({ key: 'Escape', isComposing: true })).toBe(false)
    expect(isStopConversationShortcut({ key: 'Enter' })).toBe(false)
    expect(isStopConversationShortcut({ key: 'Escape', ctrlKey: true })).toBe(false)
  })
})
