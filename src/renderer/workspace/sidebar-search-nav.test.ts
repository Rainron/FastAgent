import { describe, expect, it } from 'vitest'
import { clampSearchIndex, nextSearchIndex } from './sidebar-search-nav'

describe('侧栏搜索结果的键盘选取', () => {
  it('没有结果时停在 -1', () => {
    expect(nextSearchIndex(-1, 0, 1)).toBe(-1)
    expect(nextSearchIndex(2, 0, -1)).toBe(-1)
    expect(clampSearchIndex(3, 0)).toBe(-1)
  })

  it('还没选中时向下从第一条开始，向上从最后一条开始', () => {
    expect(nextSearchIndex(-1, 3, 1)).toBe(0)
    expect(nextSearchIndex(-1, 3, -1)).toBe(2)
  })

  it('到头回绕，方便一路按下去', () => {
    expect(nextSearchIndex(2, 3, 1)).toBe(0)
    expect(nextSearchIndex(0, 3, -1)).toBe(2)
    expect(nextSearchIndex(0, 3, 1)).toBe(1)
  })

  it('结果集变化后越界的下标夹回第一条', () => {
    expect(clampSearchIndex(5, 3)).toBe(0)
    expect(clampSearchIndex(-1, 3)).toBe(0)
    expect(clampSearchIndex(1, 3)).toBe(1)
  })
})
