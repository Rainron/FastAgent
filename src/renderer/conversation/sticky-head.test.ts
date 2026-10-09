import { describe, expect, it } from 'vitest'
import { headScrolledPast } from './sticky-head'

describe('headScrolledPast', () => {
  it('过程头底边越过可见区顶部才算滚走', () => {
    expect(headScrolledPast(100, 134)).toBe(true)
    expect(headScrolledPast(134, 134)).toBe(true)
  })

  it('还在可见区或在下方时不算', () => {
    expect(headScrolledPast(160, 134)).toBe(false)
    expect(headScrolledPast(900, 134)).toBe(false)
  })
})
