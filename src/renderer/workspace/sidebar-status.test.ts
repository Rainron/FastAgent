import { describe, expect, it } from 'vitest'
import { runMarkGlyph, runMarkKind } from './sidebar-status'

describe('侧栏状态标记', () => {
  it('运行中与等待处理是进行中', () => {
    expect(runMarkKind('running')).toBe('progress')
    expect(runMarkKind('waiting')).toBe('progress')
  })

  it('已结束的结果是未读', () => {
    expect(runMarkKind('completed')).toBe('unread')
    expect(runMarkKind('failed')).toBe('unread')
    expect(runMarkKind('cancelled')).toBe('unread')
  })

  it('没有状态时不点灯', () => {
    expect(runMarkKind(null)).toBeNull()
    expect(runMarkKind(undefined)).toBeNull()
  })

  it('每种状态都有颜色以外的形状区分', () => {
    expect(runMarkGlyph('running')).toBe('spinner')
    expect(runMarkGlyph('waiting')).toBe('attention')
    expect(runMarkGlyph('failed')).toBe('alert')
    expect(runMarkGlyph('completed')).toBe('dot')
    expect(runMarkGlyph('cancelled')).toBe('dot')
  })
})
