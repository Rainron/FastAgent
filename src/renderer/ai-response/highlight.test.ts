import { describe, expect, it } from 'vitest'
import { MAX_HIGHLIGHT_CODE_LENGTH, shouldHighlightCode } from './highlight'

describe('shouldHighlightCode', () => {
  it('允许高亮达到长度上限的受支持语言内容', () => {
    expect(shouldHighlightCode('x'.repeat(MAX_HIGHLIGHT_CODE_LENGTH), 'ts')).toBe(true)
  })

  it('拒绝高亮超过长度上限的内容', () => {
    expect(shouldHighlightCode('x'.repeat(MAX_HIGHLIGHT_CODE_LENGTH + 1), 'ts')).toBe(false)
  })

  it('拒绝高亮不受支持的语言', () => {
    expect(shouldHighlightCode('const value = 1', 'not-a-language')).toBe(false)
  })
})
