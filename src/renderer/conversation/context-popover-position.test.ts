import { describe, expect, it } from 'vitest'
import { contextPopoverPosition } from './context-popover-position'

describe('contextPopoverPosition', () => {
  it('从触发器左边展开，避免向左伸入侧栏', () => {
    expect(contextPopoverPosition({ left: 450, top: 600, bottom: 628 }, { width: 1400, height: 800 }, 400)).toEqual({ left: 450, top: 192, width: 320, maxHeight: 580 })
  })
  it('右侧空间不足时保持在窗口内', () => {
    expect(contextPopoverPosition({ left: 750, top: 600, bottom: 628 }, { width: 900, height: 800 }, 400).left).toBe(568)
  })
  it('顶部空间不足时向下打开', () => {
    expect(contextPopoverPosition({ left: 20, top: 30, bottom: 58 }, { width: 900, height: 800 }, 400).top).toBe(66)
  })
  it('窄矮窗口限制宽高而不是裁切内容', () => {
    const result = contextPopoverPosition({ left: 20, top: 180, bottom: 208 }, { width: 280, height: 240 }, 700)
    expect(result).toEqual({ left: 12, top: 12, width: 256, maxHeight: 160 })
  })
})
