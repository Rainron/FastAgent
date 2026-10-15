import { describe, expect, it, vi, afterEach } from 'vitest'
import { motionEnabled, resolveMotionMode } from './runtime'
import type { MotionPreference } from './tokens'

describe('resolveMotionMode', () => {
  it.each<[MotionPreference, boolean, boolean]>([
    ['on', false, true], ['on', true, true], ['off', false, false], ['system', false, true], ['system', true, false]
  ])('resolves %s with reduced=%s to enabled=%s', (preference, reduced, expected) => {
    expect(resolveMotionMode(preference, reduced)).toBe(expected)
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
