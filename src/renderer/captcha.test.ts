import { describe, expect, it } from 'vitest'
import { captchaAngleFromRatio, normalizeCaptchaAngle } from './captcha'

describe('normalizeCaptchaAngle', () => {
  it('将任意角度归一化到 0 到 360 度范围', () => {
    expect(normalizeCaptchaAngle(-20)).toBe(340)
    expect(normalizeCaptchaAngle(380)).toBe(20)
    expect(normalizeCaptchaAngle(Number.NaN)).toBe(0)
  })
})

describe('captchaAngleFromRatio', () => {
  it('按轨道比例换算角度并收敛越界值', () => {
    expect(captchaAngleFromRatio(0)).toBe(0)
    expect(captchaAngleFromRatio(1)).toBe(359)
    expect(captchaAngleFromRatio(0.5)).toBe(180)
    expect(captchaAngleFromRatio(-0.3)).toBe(0)
    expect(captchaAngleFromRatio(1.4)).toBe(359)
    expect(captchaAngleFromRatio(Number.NaN)).toBe(0)
  })
})
