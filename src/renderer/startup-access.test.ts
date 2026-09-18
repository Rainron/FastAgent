import { describe, expect, it } from 'vitest'
import { shouldShowLoginScreen } from './startup-access'

describe('shouldShowLoginScreen', () => {
  it('仅在账号不可用且没有模型时显示登录界面', () => {
    expect(shouldShowLoginScreen('signed_out', 0)).toBe(true)
    expect(shouldShowLoginScreen('revoked', 0)).toBe(true)
    expect(shouldShowLoginScreen('locked', 0)).toBe(true)
    expect(shouldShowLoginScreen('signed_out', 1)).toBe(false)
    expect(shouldShowLoginScreen('ready', 0)).toBe(false)
  })
})
