import {
  TRIGGER_RATIO_RANGE,
  contextStrategyPreset,
  effectiveContextPolicy,
  normalizeContextSettings
} from '../../shared/context-policy'
import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from '../../shared/model-context-windows'
import type { AppSettings, ContextStrategy, ModelOption } from '../../shared/types'

export type ContextSettingsPatch = Pick<AppSettings, 'autoSummary' | 'contextStrategy' | 'triggerRatio'>
type ContextSettingsInput = Pick<AppSettings, 'autoSummary' | 'contextStrategy' | 'triggerRatio'>

/** 用户能拖到的百分比区间，与共享层的比例区间同源。 */
export const TRIGGER_PERCENT_RANGE = { min: Math.round(TRIGGER_RATIO_RANGE.min * 100), max: Math.round(TRIGGER_RATIO_RANGE.max * 100) }

/** 1.2k / 156k / 1.05M：阈值旁边要给绝对量，只给百分比用户无法判断够不够用。 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

/** 设置页预览用的窗口：显式配置优先，其次按模型名推断，都没有才用默认值。 */
export function contextWindowForModel(model?: ModelOption | null): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW
  return resolveContextWindow(model.context_window ?? undefined, model.model_name)
}

export interface ContextSettingsView {
  enabled: boolean
  strategy: ContextStrategy
  /** 阈值被手动调过，不再跟随档位。 */
  custom: boolean
  triggerPercent: number
  triggerTokens: number
  /** 压缩后预计落到的绝对量，现在由保留区 + 摘要预算算出来，不再可配。 */
  targetTokens: number
  contextWindow: number
  /** 换算被上下限夹过，实际触发点与设定值不一致；界面要把实际值标出来。 */
  clamped: boolean
  /** 「当前生效」诊断行，把换算结果直接摆出来，不必去翻日志。 */
  effectiveLabel: string
}

export function buildContextSettingsView(settings: ContextSettingsInput, contextWindow: number, modelName?: string | null, maxTokens?: number | null): ContextSettingsView {
  const effective = effectiveContextPolicy(
    { strategy: settings.contextStrategy, autoSummary: settings.autoSummary, triggerRatio: settings.triggerRatio },
    contextWindow,
    maxTokens
  )
  // 滑杆停在用户设的位置；绝对量与诊断行给换算后真正生效的数字。
  const triggerPercent = Math.round(effective.triggerRatio * 100)
  const source = modelName ? `窗口 ${formatTokenCount(effective.contextWindow)}（${modelName}）` : `窗口 ${formatTokenCount(effective.contextWindow)}`
  // 触发点被收敛约束或下限夹过时，界面上的百分比和引擎的做法对不上，必须说出来。
  // 不写「窗口偏小」：模型单次输出上限过大同样会夹，那种情况下窗口一点都不小。
  const clampNote = effective.clamped
    ? `（为保证压缩能收敛，实际按 ${Math.round(effective.effectiveTriggerRatio * 100)}% 触发）`
    : ''
  return {
    enabled: effective.enabled,
    strategy: settings.contextStrategy,
    custom: !effective.triggerFollowsPreset,
    triggerPercent,
    triggerTokens: effective.triggerTokens,
    targetTokens: effective.targetTokens,
    contextWindow: effective.contextWindow,
    clamped: effective.clamped,
    effectiveLabel: effective.enabled
      ? `启用 · 触发 ${formatTokenCount(effective.triggerTokens)} · 压到 ${formatTokenCount(effective.targetTokens)} · ${source}${clampNote}`
      : `已关闭 · 不自动压缩 · ${source}`
  }
}

/** 档位切换：把阈值交还给档位默认值，否则用户选了新档位却仍被旧的手调阈值盖住。 */
export function applyStrategy(settings: ContextSettingsInput, strategy: ContextStrategy): ContextSettingsPatch {
  return normalizeContextSettings({ ...settings, contextStrategy: strategy, triggerRatio: null })
}

/**
 * 主开关。关闭走「关闭」档（档位是唯一事实源），重新打开时回到关闭前那一档，
 * 拿不到就落回推荐档，不保留关闭档这个非法组合。
 */
export function applyEnabled(settings: ContextSettingsInput, enabled: boolean, fallbackStrategy: ContextStrategy = 'auto'): ContextSettingsPatch {
  if (!enabled) return normalizeContextSettings({ ...settings, contextStrategy: 'disabled' })
  const strategy = fallbackStrategy === 'disabled' ? 'auto' : fallbackStrategy
  return normalizeContextSettings({ ...settings, contextStrategy: strategy })
}

/** 触发阈值，也是唯一一个用户可调的压缩参数。 */
export function applyTriggerPercent(settings: ContextSettingsInput, percent: number): ContextSettingsPatch {
  if (!Number.isFinite(percent)) return normalizeContextSettings(settings)
  const triggerRatio = Math.min(TRIGGER_RATIO_RANGE.max, Math.max(TRIGGER_RATIO_RANGE.min, Math.round(percent) / 100))
  return normalizeContextSettings({ ...settings, triggerRatio })
}

/** 高级区里「恢复档位默认」的入口：把触发阈值交还给当前档位。 */
export function clearRatioOverrides(settings: ContextSettingsInput): ContextSettingsPatch {
  return normalizeContextSettings({ ...settings, triggerRatio: null })
}

export function strategyDescription(strategy: ContextStrategy): string {
  return contextStrategyPreset(strategy).description
}
