import { describe, expect, it, vi, afterEach } from 'vitest'
import { unmountDecision } from './use-delayed-unmount'
import { motionEnabled } from './motion'

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

describe('motionEnabled', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubRoot(dataset: Record<string, string>) {
    vi.stubGlobal('document', { documentElement: { dataset } })
  }

  it('off 偏好直接关闭', () => {
    stubRoot({ motion: 'off' })
    expect(motionEnabled()).toBe(false)
  })

  it('system 偏好跟随系统 reduced-motion', () => {
    stubRoot({ motion: 'system', reducedMotion: 'true' })
    expect(motionEnabled()).toBe(false)
    stubRoot({ motion: 'system', reducedMotion: 'false' })
    expect(motionEnabled()).toBe(true)
  })

  it('on 偏好始终开启', () => {
    stubRoot({ motion: 'on', reducedMotion: 'true' })
    expect(motionEnabled()).toBe(true)
  })

  it('无 document 环境（测试/SSR）视为关闭', () => {
    vi.stubGlobal('document', undefined)
    expect(motionEnabled()).toBe(false)
  })
})
