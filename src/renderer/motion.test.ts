import { describe, expect, it } from 'vitest'
import { MOTION_DURATIONS, MOTION_EASING, resolveMotionMode, type MotionPreference } from './motion'

describe('motion settings', () => {
  it('uses the configured durations and easing', () => {
    expect(MOTION_DURATIONS.pageEnter).toBe(180)
    expect(MOTION_DURATIONS.sidebar).toBe(220)
    expect(MOTION_EASING).toBe('cubic-bezier(0.2, 0, 0, 1)')
  })

  it.each<[MotionPreference, boolean, boolean]>([
    ['on', false, true], ['on', true, true], ['off', false, false], ['system', false, true], ['system', true, false]
  ])('resolves %s with reduced=%s to enabled=%s', (preference, reduced, expected) => {
    expect(resolveMotionMode(preference, reduced)).toBe(expected)
  })
})
