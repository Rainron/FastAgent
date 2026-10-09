import { describe, expect, it, vi } from 'vitest'
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, readSidebarWidth, SIDEBAR_WIDTH_KEY, writeSidebarWidth } from './sidebar-width'

describe('侧栏宽度', () => {
  it('超出范围的宽度夹回上下限', () => {
    expect(clampSidebarWidth(120)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(9999)).toBe(MAX_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(300.4)).toBe(300)
  })

  it('没存过或存了脏值时用默认宽度', () => {
    expect(clampSidebarWidth(undefined)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(readSidebarWidth({ getItem: () => null })).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(readSidebarWidth({ getItem: () => 'abc' })).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('读回存过的宽度', () => {
    expect(readSidebarWidth({ getItem: (key) => key === SIDEBAR_WIDTH_KEY ? '320' : null })).toBe(320)
  })

  it('存储不可用时不抛，读回默认值', () => {
    expect(readSidebarWidth({ getItem: () => { throw new Error('denied') } })).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(() => writeSidebarWidth({ setItem: () => { throw new Error('denied') } }, 300)).not.toThrow()
  })

  it('写入前同样夹一次，存进去的永远是合法值', () => {
    const setItem = vi.fn()
    writeSidebarWidth({ setItem }, 9999)
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_WIDTH_KEY, String(MAX_SIDEBAR_WIDTH))
  })
})
