import { describe, expect, it } from 'vitest'
import {
  applyEnabled,
  applyStrategy,
  applyTriggerPercent,
  buildContextSettingsView,
  clearRatioOverrides,
  contextWindowForModel,
  formatTokenCount
} from './context-settings-view'
import type { ModelOption } from '../../shared/types'

const base = { autoSummary: true, contextStrategy: 'auto' as const, triggerRatio: null }

describe('formatTokenCount', () => {
  it('按量级给可读单位', () => {
    expect(formatTokenCount(156_000)).toBe('156k')
    expect(formatTokenCount(1_047_576)).toBe('1.05M')
    expect(formatTokenCount(800)).toBe('800')
    expect(formatTokenCount(0)).toBe('—')
  })
})

describe('contextWindowForModel', () => {
  it('显式配置优先于按名字推断', () => {
    expect(contextWindowForModel({ context_window: 64_000, model_name: 'claude-sonnet-5' } as ModelOption)).toBe(64_000)
    expect(contextWindowForModel({ model_name: 'claude-sonnet-5' } as ModelOption)).toBe(200_000)
    expect(contextWindowForModel(null)).toBe(128_000)
  })
})

describe('buildContextSettingsView', () => {
  it('把档位默认阈值换算成绝对 token 并给出生效说明', () => {
    const view = buildContextSettingsView(base, 200_000, 'claude-sonnet-5')
    expect(view).toMatchObject({ enabled: true, custom: false, triggerPercent: 78, triggerTokens: 156_000, targetTokens: 58_192 })
    expect(view.effectiveLabel).toBe('启用 · 触发 156k · 压到 58k · 窗口 200k（claude-sonnet-5）')
  })

  it('滑杆停在设定值，绝对量与说明给换算后真正生效的数字', () => {
    // 16k 窗口下 reserve 被下限抬到 1638，触发点实际是 90%
    const view = buildContextSettingsView({ ...base, triggerRatio: 0.95 }, 16_384)
    expect(view.triggerPercent).toBe(95)
    expect(view.clamped).toBe(true)
    expect(view.triggerTokens).toBe(16_384 - 1_638)
    expect(view.effectiveLabel).toContain('为保证压缩能收敛，实际按 90% 触发')
  })

  it('手调阈值后标记为自定义', () => {
    expect(buildContextSettingsView({ ...base, triggerRatio: 0.6 }, 128_000).custom).toBe(true)
  })

  it('关闭档给出关闭说明而不是阈值', () => {
    const view = buildContextSettingsView({ ...base, contextStrategy: 'disabled', autoSummary: false }, 128_000)
    expect(view.enabled).toBe(false)
    expect(view.effectiveLabel).toContain('已关闭')
  })

  it('落点由保留区与摘要预算算出来，不再可配', () => {
    const view = buildContextSettingsView({ ...base, triggerRatio: 0.4 }, 128_000)
    // 保留区 = 窗口 25% = 32000，摘要预算缺省 8192
    expect(view.targetTokens).toBe(32_000 + 8_192)
  })
})

describe('设置页写入', () => {
  it('换档位会把手调阈值交还给档位默认值', () => {
    expect(applyStrategy({ ...base, triggerRatio: 0.5 }, 'conservative')).toEqual({
      autoSummary: true, contextStrategy: 'conservative', triggerRatio: null
    })
  })

  it('主开关关闭走关闭档，重开回到关闭前那一档', () => {
    const off = applyEnabled({ ...base, contextStrategy: 'conservative' }, false)
    expect(off).toMatchObject({ contextStrategy: 'disabled', autoSummary: false })
    expect(applyEnabled(off, true, 'conservative')).toMatchObject({ contextStrategy: 'conservative', autoSummary: true })
    // 记不住上一档时落回推荐档，不留「关闭档 + 已启用」这种非法组合
    expect(applyEnabled(off, true, 'disabled')).toMatchObject({ contextStrategy: 'auto', autoSummary: true })
  })

  it('触发阈值裁进可用区间', () => {
    expect(applyTriggerPercent(base, 5).triggerRatio).toBe(0.3)
    expect(applyTriggerPercent(base, 120).triggerRatio).toBe(0.95)
    expect(applyTriggerPercent(base, Number.NaN).triggerRatio).toBeNull()
  })

  it('调触发点只改触发点', () => {
    const patch = applyTriggerPercent({ ...base }, 60)
    expect(patch.triggerRatio).toBeCloseTo(0.6, 5)
  })


  it('可以一键交还给档位默认值', () => {
    expect(clearRatioOverrides({ ...base, triggerRatio: 0.5 })).toMatchObject({ triggerRatio: null })
  })
})
