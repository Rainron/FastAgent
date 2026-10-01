import { describe, expect, it } from 'vitest'
import { contextPressure } from './context-pressure'
import type { ContextPolicy } from '../../shared/types'

function policy(patch: Partial<ContextPolicy> = {}): ContextPolicy {
  return { conversationId: 'c1', strategy: 'auto', autoSummary: true, triggerRatio: null, keepRecentTurns: null, forceCompaction: false, inheritGlobal: true, ...patch }
}

function input(patch: Partial<Parameters<typeof contextPressure>[0]> = {}) {
  return { estimatedTokens: 50_000, contextWindow: 100_000, policy: policy(), compacting: false, ...patch }
}

describe('contextPressure 阈值口径', () => {
  it('预告的阈值是引擎真会用的那个，窗口偏小时跟着夹取走', () => {
    // 16k 窗口下触发点被下限夹到 90%，不能照 95% 预告
    const policy = { strategy: 'auto' as const, autoSummary: true, triggerRatio: 0.95 }
    // 13700/16384 ≈ 84%：已进预告区（90% - 8%），但还没到触发点
    const pressure = contextPressure({ estimatedTokens: 13_700, contextWindow: 16_384, policy, compacting: false })
    expect(pressure?.detail).toContain('到 90% 时会自动压缩')
  })
})

describe('contextPressure', () => {
  it('水位不高时不打扰', () => {
    expect(contextPressure(input())).toBeNull()
  })

  it('正在压缩时让位给输入框自己的状态', () => {
    expect(contextPressure(input({ estimatedTokens: 99_000, compacting: true }))).toBeNull()
  })

  it('数据不全时不提示，不编造百分比', () => {
    expect(contextPressure(input({ contextWindow: 0 }))).toBeNull()
    expect(contextPressure(input({ estimatedTokens: 0 }))).toBeNull()
  })

  it('接近触发点先预告，不给压缩按钮', () => {
    const pressure = contextPressure(input({ estimatedTokens: 72_000 }))
    expect(pressure).toMatchObject({ tone: 'notice', percent: 72, showCompact: false })
    expect(pressure?.detail).toContain('78%')
  })

  it('越过触发点说明会自动压缩', () => {
    expect(contextPressure(input({ estimatedTokens: 80_000 }))).toMatchObject({ tone: 'notice', showCompact: true })
  })

  it('关闭自动压缩后 80% 起就提示，并给出设置入口', () => {
    const off = policy({ strategy: 'disabled', autoSummary: false })
    expect(contextPressure(input({ estimatedTokens: 79_000, policy: off }))).toBeNull()
    expect(contextPressure(input({ estimatedTokens: 82_000, policy: off }))).toMatchObject({ tone: 'warning', showCompact: true, showSettings: true })
  })

  it('95% 起一律红色告警', () => {
    expect(contextPressure(input({ estimatedTokens: 96_000 }))).toMatchObject({ tone: 'danger', showCompact: true, showSettings: false })
    expect(contextPressure(input({ estimatedTokens: 96_000, policy: policy({ strategy: 'disabled', autoSummary: false }) }))).toMatchObject({ tone: 'danger', showSettings: true })
  })

  it('水位条要未取整的占比，刻度按夹过的触发点给', () => {
    // 16k 窗口下触发点被下限夹到 90%，刻度不能照设定的 95% 画
    const clamped = { strategy: 'auto' as const, autoSummary: true, triggerRatio: 0.95 }
    const pressure = contextPressure({ estimatedTokens: 13_700, contextWindow: 16_384, policy: clamped, compacting: false })
    expect(pressure?.triggerRatio).toBeCloseTo(0.9, 3)
    expect(pressure?.ratio).toBeCloseTo(13_700 / 16_384, 5)
  })

  it('关闭自动压缩时不给触发刻度', () => {
    const off = policy({ strategy: 'disabled', autoSummary: false })
    expect(contextPressure(input({ estimatedTokens: 82_000, policy: off }))?.triggerRatio).toBeNull()
  })

  it('用量超出窗口时占比封顶在 1，水位条不溢出', () => {
    const pressure = contextPressure(input({ estimatedTokens: 120_000 }))
    expect(pressure).toMatchObject({ percent: 100, ratio: 1 })
  })

  it('会话级阈值优先于档位默认值', () => {
    expect(contextPressure(input({ estimatedTokens: 62_000, policy: policy({ triggerRatio: 0.6 }) }))).toMatchObject({ tone: 'notice', showCompact: true })
  })
})
