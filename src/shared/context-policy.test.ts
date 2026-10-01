import { describe, expect, it } from 'vitest'
import {
  compactionBudget,
  contextStrategyPreset,
  effectiveContextPolicy,
  forcedCompactionBudget,
  isAutoCompactionEnabled,
  migrateLegacyContextSettings,
  normalizeContextPolicyPatch,
  normalizeContextSettings,
  resolveTriggerRatio
} from './context-policy'

describe('context strategy presets', () => {
  it('未知档位回落到均衡档', () => {
    expect(contextStrategyPreset('auto').triggerRatio).toBe(0.78)
    expect(contextStrategyPreset(undefined).value).toBe('auto')
    expect(contextStrategyPreset('nope' as never).value).toBe('auto')
  })

  it('显式阈值优先于档位默认值', () => {
    expect(resolveTriggerRatio({ strategy: 'conservative', triggerRatio: null })).toBe(0.85)
    expect(resolveTriggerRatio({ strategy: 'conservative', triggerRatio: 0.5 })).toBe(0.5)
  })
})

describe('isAutoCompactionEnabled', () => {
  it('关闭档或旧的 autoSummary=false 都算未启用', () => {
    expect(isAutoCompactionEnabled({ strategy: 'auto', autoSummary: true })).toBe(true)
    expect(isAutoCompactionEnabled({ strategy: 'disabled', autoSummary: true })).toBe(false)
    expect(isAutoCompactionEnabled({ strategy: 'auto', autoSummary: false })).toBe(false)
  })
})

describe('normalizeContextSettings', () => {
  it('档位是唯一事实源，autoSummary 按它回填', () => {
    expect(normalizeContextSettings({ contextStrategy: 'aggressive', autoSummary: false })).toMatchObject({ contextStrategy: 'aggressive', autoSummary: true })
    expect(normalizeContextSettings({ contextStrategy: 'disabled', autoSummary: true })).toMatchObject({ contextStrategy: 'disabled', autoSummary: false })
  })

  it('旧记录里「关掉自动摘要但档位还在 auto」收敛成关闭档', () => {
    const migrated = migrateLegacyContextSettings({ contextStrategy: 'auto', autoSummary: false })
    expect(normalizeContextSettings(migrated)).toMatchObject({ contextStrategy: 'disabled', autoSummary: false })
  })

  it('阈值裁进可用区间', () => {
    expect(normalizeContextSettings({ contextStrategy: 'auto', triggerRatio: 0.05 }).triggerRatio).toBe(0.3)
    expect(normalizeContextSettings({ contextStrategy: 'auto', triggerRatio: 0.99 }).triggerRatio).toBe(0.95)
    expect(normalizeContextSettings({ contextStrategy: 'auto', triggerRatio: null }).triggerRatio).toBeNull()
  })

})

describe('normalizeContextPolicyPatch', () => {
  it('没碰上下文字段时原样返回', () => {
    const patch = { keepRecentTurns: 4 }
    expect(normalizeContextPolicyPatch(patch)).toBe(patch)
  })

  it('只改写出现过的键，不把未提供的阈值清成跟随档位', () => {
    const next = normalizeContextPolicyPatch({ strategy: 'conservative' }, { strategy: 'auto', triggerRatio: 0.5 })
    expect(next).toEqual({ strategy: 'conservative', autoSummary: true })
    expect('triggerRatio' in next).toBe(false)
  })

  it('会话级关闭档同样同步 autoSummary', () => {
    expect(normalizeContextPolicyPatch({ strategy: 'disabled' })).toEqual({ strategy: 'disabled', autoSummary: false })
  })

})

describe('effectiveContextPolicy', () => {
  it('把占比换算成绝对 token，供界面直接展示', () => {
    const effective = effectiveContextPolicy({ strategy: 'auto', autoSummary: true, triggerRatio: null }, 200_000)
    // 保留区 = 窗口 25% = 50000，摘要预算缺省 8192，落点是它们的和
    expect(effective).toMatchObject({ enabled: true, triggerTokens: 156_000, targetTokens: 58_192, clamped: false, triggerFollowsPreset: true })
  })

  it('窗口未知时不编造数字', () => {
    const effective = effectiveContextPolicy({ strategy: 'auto', autoSummary: true, triggerRatio: null }, 0)
    expect(effective).toMatchObject({ contextWindow: 0, triggerTokens: 0, targetTokens: 0 })
  })

  it('窗口太小被下限夹住时如实报告实际生效值', () => {
    // 16k 窗口下 reserve 会被抬到 1638，触发点实际是 90% 而不是设定的 95%
    const effective = effectiveContextPolicy({ strategy: 'auto', autoSummary: true, triggerRatio: 0.95 }, 16_384)
    expect(effective.triggerRatio).toBe(0.95)
    expect(effective.clamped).toBe(true)
    expect(effective.effectiveTriggerRatio).toBeLessThan(0.95)
    expect(effective.triggerTokens).toBe(16_384 - 1_638)
  })
})

describe('compactionBudget', () => {
  it('窗口未知时沿用 Pi 默认值，不做猜测', () => {
    const budget = compactionBudget({ strategy: 'auto', autoSummary: true, triggerRatio: null }, 0)
    expect(budget).toMatchObject({ reserveTokens: 16_384, keepRecentTokens: 20_000, triggerTokens: 0, targetTokens: 0 })
  })

  it('任何窗口与档位组合下，保留区与预留区之和都不顶穿窗口且保留区为正', () => {
    for (const contextWindow of [8_000, 16_384, 32_000, 128_000, 200_000, 1_000_000]) {
      for (const strategy of ['auto', 'aggressive', 'conservative'] as const) {
        for (const triggerRatio of [null, 0.3, 0.5, 0.88, 0.95]) {
          const budget = compactionBudget({ strategy, autoSummary: true, triggerRatio }, contextWindow)
          expect(budget.reserveTokens + budget.keepRecentTokens).toBeLessThan(contextWindow)
          expect(budget.keepRecentTokens).toBeGreaterThan(0)
          // 压缩后的落点不能高于触发点，否则压完立刻又越线
          expect(budget.targetTokens).toBeLessThanOrEqual(budget.triggerTokens)
        }
      }
    }
  })
})

describe('forcedCompactionBudget', () => {
  const balanced = { strategy: 'auto' as const, autoSummary: true, triggerRatio: null }

  it('只收缩保留区，触发点原样不动', () => {
    const normal = compactionBudget(balanced, 400_000)
    const forced = forcedCompactionBudget(balanced, 400_000)
    // 触发点决定「什么时候压」，强压改的是「压多狠」；一起改会让实际触发时机和设置页对不上
    expect(forced.reserveTokens).toBe(normal.reserveTokens)
    expect(forced.triggerTokens).toBe(normal.triggerTokens)
    // 均衡档保留区 ≈ 窗口 55%，强压压到 15%
    expect(normal.keepRecentTokens).toBe(100_000)
    expect(forced.keepRecentTokens).toBe(40_000)
    expect(forced.targetTokens).toBeLessThan(normal.targetTokens)
  })

  it('强压不改触发时机，只动保留区', () => {
    const tight = { strategy: 'aggressive' as const, autoSummary: true, triggerRatio: 0.78 }
    const normal = compactionBudget(tight, 20_000)
    const forced = forcedCompactionBudget(tight, 20_000)
    expect(forced.reserveTokens).toBe(normal.reserveTokens)
    expect(forced.triggerTokens).toBe(normal.triggerTokens)
    expect(forced.keepRecentTokens).toBeLessThan(normal.keepRecentTokens)
  })

  it('窗口未知时原样返回，不猜', () => {
    expect(forcedCompactionBudget(balanced, 0)).toMatchObject({ reserveTokens: 16_384, keepRecentTokens: 20_000, triggerTokens: 0 })
  })

  it('任何窗口与档位组合下，强压的保留区都不大于常规且仍为正', () => {
    for (const contextWindow of [8_000, 16_384, 32_000, 128_000, 200_000, 1_000_000]) {
      for (const strategy of ['auto', 'aggressive', 'conservative'] as const) {
        for (const triggerRatio of [null, 0.3, 0.5, 0.88, 0.95]) {
          const source = { strategy, autoSummary: true, triggerRatio }
          const normal = compactionBudget(source, contextWindow)
          const forced = forcedCompactionBudget(source, contextWindow)
          expect(forced.keepRecentTokens).toBeLessThanOrEqual(normal.keepRecentTokens)
          expect(forced.keepRecentTokens).toBeGreaterThan(0)
          expect(forced.targetTokens).toBeLessThanOrEqual(forced.triggerTokens)
        }
      }
    }
  })
})

describe('effectiveContextPolicy 的 maxTokens', () => {
  const source = { strategy: 'auto' as const, autoSummary: true, triggerRatio: 0.5 }

  it('摘要预算跟着模型输出上限走，落点会跟着变', () => {
    // 会话详情曾经不传 maxTokens，于是同一条会话在设置页显示「压到 45%」、在详情里显示「压到 30%」
    const withMax = effectiveContextPolicy(source, 32_768, 512_000)
    const withoutMax = effectiveContextPolicy(source, 32_768)
    expect(withMax.targetTokens).not.toBe(withoutMax.targetTokens)
    // 两个界面读同一条会话，必须传同一个 maxTokens 才会得到同一个数
    expect(effectiveContextPolicy(source, 32_768, 512_000).targetTokens).toBe(withMax.targetTokens)
  })
})
