import { describe, expect, it } from 'vitest'
import { anchorMenuPosition } from './item-actions-position'

const viewport = { width: 1280, height: 800 }
const menu = { width: 176, height: 200 }

describe('侧栏管理菜单定位', () => {
  it('右对齐触发按钮并向下展开', () => {
    expect(anchorMenuPosition({ top: 100, bottom: 126, right: 230 }, menu, viewport)).toEqual({ left: 54, top: 124 })
  })

  it('下方放不下时翻到按钮上方', () => {
    expect(anchorMenuPosition({ top: 700, bottom: 726, right: 230 }, menu, viewport)).toEqual({ left: 54, top: 502 })
  })

  it('上下都放不下时保住顶部可见', () => {
    expect(anchorMenuPosition({ top: 20, bottom: 46, right: 230 }, menu, { width: 1280, height: 180 })).toEqual({ left: 54, top: 8 })
  })

  it('触发按钮靠左时不把菜单推出窗口左边', () => {
    expect(anchorMenuPosition({ top: 100, bottom: 126, right: 40 }, menu, viewport)).toEqual({ left: 8, top: 124 })
  })

  it('窗口比菜单还窄时贴左边留白', () => {
    expect(anchorMenuPosition({ top: 100, bottom: 126, right: 120 }, menu, { width: 150, height: 800 })).toEqual({ left: 8, top: 124 })
  })
})
