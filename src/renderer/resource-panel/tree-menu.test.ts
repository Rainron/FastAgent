import { describe, expect, it } from 'vitest'
import { menuHeight, menuPosition } from './tree-menu'

const size = { width: 180, height: 160 }
const viewport = { width: 1200, height: 800 }

describe('menuPosition', () => {
  it('远离边缘时就落在鼠标位置', () => {
    expect(menuPosition({ x: 300, y: 200 }, size, viewport)).toEqual({ x: 300, y: 200 })
  })

  it('贴右 / 下边缘时向内收，菜单不被窗口裁掉', () => {
    expect(menuPosition({ x: 1190, y: 780 }, size, viewport)).toEqual({ x: 1020, y: 640 })
  })

  it('窗口比菜单还小时收敛到 0，不给负坐标', () => {
    expect(menuPosition({ x: 50, y: 50 }, size, { width: 120, height: 100 })).toEqual({ x: 0, y: 0 })
  })
})

describe('menuHeight', () => {
  it('按项数估高，供落点计算避开下边缘', () => {
    expect(menuHeight(4)).toBe(122)
    expect(menuHeight(6)).toBe(178)
  })
})
