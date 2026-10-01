import { describe, expect, it } from 'vitest'
import { cjkKeepRecentScale, scaleKeepRecentTokens } from './compaction-units'

describe('cjkKeepRecentScale', () => {
  it('纯英文不缩放', () => {
    expect(cjkKeepRecentScale('hello world, this is plain ascii text')).toBe(1)
    expect(cjkKeepRecentScale('')).toBe(1)
  })

  it('纯中文缩到四分之一：Pi 按字符/4 计，一个汉字实际接近 1 token', () => {
    expect(cjkKeepRecentScale('中文内容'.repeat(100))).toBeCloseTo(0.25, 5)
  })

  it('中英混排按比例折算，结果落在 0.25 与 1 之间', () => {
    const scale = cjkKeepRecentScale('中文'.repeat(50) + 'abcd'.repeat(100))
    expect(scale).toBeGreaterThan(0.25)
    expect(scale).toBeLessThan(1)
  })
})

describe('scaleKeepRecentTokens', () => {
  it('按比例缩小并保底 1024', () => {
    expect(scaleKeepRecentTokens(8192, 0.25)).toBe(2048)
    expect(scaleKeepRecentTokens(2000, 0.25)).toBe(1024)
    expect(scaleKeepRecentTokens(undefined, 0.25)).toBeUndefined()
  })
})
