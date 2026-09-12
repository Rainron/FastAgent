import { describe, expect, it } from 'vitest'
import { lineBoundary } from './composer-shortcuts'

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
