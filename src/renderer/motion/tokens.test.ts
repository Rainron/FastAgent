import { describe, expect, it } from 'vitest'
import { MOTION_DURATIONS, MOTION_EASING, MOTION_EASE } from './tokens'

describe('motion tokens', () => {
  it('uses the configured durations', () => {
    expect(MOTION_DURATIONS.pageEnter).toBe(180)
    expect(MOTION_DURATIONS.sidebar).toBe(220)
    expect(MOTION_DURATIONS.popoverOpen).toBe(140)
    expect(MOTION_DURATIONS.popoverClose).toBe(100)
    expect(MOTION_DURATIONS.dialog).toBe(200)
  })

  /**
   * 缓动是单一来源：CSS 的 --motion-ease 必须与这个值相同（styles.css 的 :root）。
   * 历史上 JS 与 CSS 各用一条曲线，同一套交互的补间与过渡收尾速度对不上。
   */
  it('keeps one easing shared with CSS', () => {
    expect(MOTION_EASING).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
    expect(MOTION_EASE).toEqual([0.2, 0.8, 0.2, 1])
  })
})
