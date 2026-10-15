import { describe, expect, it } from 'vitest'
import { POPOVER_EDGE_MARGIN, popoverShift, popoverPlacement } from './use-popover-clamp'

describe('popoverShift', () => {
  it('完整落在视口内时不动', () => {
    expect(popoverShift({ left: 100, right: 380 }, 1280)).toBe(0)
  })

  it('左边越界时按超出量右移', () => {
    // 右对齐的浮层挂在靠左的触发器上：left 为负，要把整块推回来
    expect(popoverShift({ left: -22, right: 258 }, 1280)).toBe(POPOVER_EDGE_MARGIN + 22)
  })

  it('右边越界时按超出量左移', () => {
    expect(popoverShift({ left: 1040, right: 1320 }, 1280)).toBe(-(1320 - 1280 + POPOVER_EDGE_MARGIN))
  })

  it('比视口还宽时优先保住左边', () => {
    expect(popoverShift({ left: -40, right: 1400 }, 1280)).toBe(POPOVER_EDGE_MARGIN + 40)
  })

  it('边距可调，贴边判定跟着变', () => {
    expect(popoverShift({ left: 4, right: 284 }, 1280, 0)).toBe(0)
    expect(popoverShift({ left: 4, right: 284 }, 1280, 12)).toBe(8)
  })
})

describe('popoverPlacement', () => {
  const preferred = { width: 380, maxHeight: 620, upwards: true, rightAligned: true }
  it('窄窗口同时限制宽度和高度', () => {
    expect(popoverPlacement({ left: 200, right: 260, top: 180, bottom: 210 }, { width: 300, height: 260 }, preferred)).toEqual({ width: 284, maxHeight: 164, left: 8, up: true })
  })
  it('向上空间不足时翻转向下', () => {
    expect(popoverPlacement({ left: 200, right: 260, top: 30, bottom: 60 }, { width: 900, height: 700 }, preferred)).toMatchObject({ up: false, maxHeight: 620 })
  })
  it('Git 顶栏向下菜单贴底时翻转向上', () => {
    expect(popoverPlacement({ left: 800, right: 860, top: 580, bottom: 610 }, { width: 900, height: 650 }, { ...preferred, upwards: false, rightAligned: false })).toMatchObject({ up: true, left: 512, maxHeight: 564 })
  })
})
