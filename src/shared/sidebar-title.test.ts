import { describe, expect, it } from 'vitest'
import { clampSidebarTitleChars, sidebarTitleScrollOffset, SIDEBAR_TITLE_CHARS } from './sidebar-title'

describe('侧栏标题字数', () => {
  it('越界的值夹回上下限，缺省用默认值', () => {
    expect(clampSidebarTitleChars(2)).toBe(SIDEBAR_TITLE_CHARS.min)
    expect(clampSidebarTitleChars(999)).toBe(SIDEBAR_TITLE_CHARS.max)
    expect(clampSidebarTitleChars(undefined)).toBe(SIDEBAR_TITLE_CHARS.default)
    expect(clampSidebarTitleChars('20')).toBe(SIDEBAR_TITLE_CHARS.default)
    expect(clampSidebarTitleChars(22.6)).toBe(23)
  })
})

describe('悬停滚动位移', () => {
  const options = { speed: 100, holdMs: 500 }

  it('没有溢出就不滚', () => {
    expect(sidebarTitleScrollOffset(1000, 0, options)).toBe(0)
    expect(sidebarTitleScrollOffset(1000, -5, options)).toBe(0)
  })

  it('开头先停一下再匀速滚到尾部', () => {
    expect(sidebarTitleScrollOffset(0, 100, options)).toBe(0)
    expect(sidebarTitleScrollOffset(499, 100, options)).toBe(0)
    expect(sidebarTitleScrollOffset(1000, 100, options)).toBeCloseTo(50, 5)
    expect(sidebarTitleScrollOffset(1500, 100, options)).toBeCloseTo(100, 5)
  })

  it('尾部停住，之后回到开头再来一轮', () => {
    expect(sidebarTitleScrollOffset(1800, 100, options)).toBe(100)
    expect(sidebarTitleScrollOffset(2000, 100, options)).toBe(0)
    expect(sidebarTitleScrollOffset(2500, 100, options)).toBeCloseTo(0, 5)
  })
})
