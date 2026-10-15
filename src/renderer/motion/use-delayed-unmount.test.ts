import { describe, expect, it } from 'vitest'
import { unmountDecision } from './use-delayed-unmount'

describe('unmountDecision', () => {
  it('打开中或从未挂载时保持现状', () => {
    expect(unmountDecision(true, true, 100, true)).toBe('keep')
    expect(unmountDecision(true, false, 100, true)).toBe('keep')
    expect(unmountDecision(false, false, 100, true)).toBe('keep')
  })

  it('动效开启时延迟卸载，给退场动画留出窗口', () => {
    expect(unmountDecision(false, true, 100, true)).toBe('delayed')
  })

  it('动效关闭或时长为 0 时立即卸载', () => {
    expect(unmountDecision(false, true, 100, false)).toBe('immediate')
    expect(unmountDecision(false, true, 0, true)).toBe('immediate')
  })
})
