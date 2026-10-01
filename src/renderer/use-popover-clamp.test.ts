import { describe, expect, it } from 'vitest'
import { POPOVER_EDGE_MARGIN, popoverShift } from './use-popover-clamp'

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

describe('popoverShift 带容器左边界', () => {
  it('浮层在视口内但被容器左缘裁掉时，按容器边界右移', () => {
    // 主区从 x=60 开始、overflow 裁剪：浮层 left=20 在视口里，肉眼却缺了一块
    expect(popoverShift({ left: 20, right: 300 }, 760, POPOVER_EDGE_MARGIN, 60)).toBe(60 + POPOVER_EDGE_MARGIN - 20)
  })
})
