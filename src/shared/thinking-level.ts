import type { ModelThinkingLevel, ThinkingLevel, ThinkingLevelMap } from './types'

export interface ThinkingCapabilities {
  supports_thinking?: boolean
  thinking_default?: string
  thinking_profiles?: Record<string, unknown> | null
  thinking_level_map?: ThinkingLevelMap
}

const levels: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** 就近落位的偏好顺序：优先 low，其次 minimal，再逐级升高。 */
const lowPreference: ModelThinkingLevel[] = ['low', 'minimal', 'medium', 'high', 'xhigh', 'max']

export function getSupportedThinkingLevels(model: ThinkingCapabilities | null | undefined): ModelThinkingLevel[] {
  if (!model?.supports_thinking) return ['off']
  const profiles = Object.keys(model.thinking_profiles ?? {}).map((level) => level.toLowerCase())
  const configured = profiles.filter((level) => levels.includes(level as ModelThinkingLevel))
  return levels.filter((level) => {
    const mapped = model.thinking_level_map?.[level]
    // 官方显式禁用的档位（off:null 等）永远不可选，profiles 与 default 都不能重新启用。
    if (mapped === null) return false
    // 高级档位必须由官方给出 provider 映射才可选用，不猜测。
    if ((level === 'xhigh' || level === 'max') && typeof mapped !== 'string') return false
    // 平台下发 thinking_profiles 时视为官方声明的可选集合：未声明的档（含 off）不提供。
    // 没有 profiles 时交给官方 map 与默认能力决定，不额外推断「关闭思考」。
    return !configured.length || configured.includes(level)
  })
}

/** UI 可选档位：思考模型不提供「关闭」，off 只留给不支持思考的模型在运行时使用。 */
export function selectableThinkingLevels(model: ThinkingCapabilities | null | undefined): ModelThinkingLevel[] {
  if (!model?.supports_thinking) return []
  return getSupportedThinkingLevels(model).filter((level) => level !== 'off')
}

/** 就近落位到 low；模型连一档思考档都没有时退回 off。 */
export function nearestThinkingLevel(model: ThinkingCapabilities | null | undefined): ModelThinkingLevel {
  const selectable = selectableThinkingLevels(model)
  for (const level of lowPreference) {
    if (selectable.includes(level)) return level
  }
  return selectable[0] ?? 'off'
}

export function normalizeThinkingLevel(value: string | null | undefined, model?: ThinkingCapabilities | null): ThinkingLevel {
  const requested = value?.trim().toLowerCase()
  if (!requested || requested === 'auto') return 'auto'
  const supported = getSupportedThinkingLevels(model)
  // 旧版 Ultra 从未是 pi 合法档位，恢复时保留其选择最高强度的意图。
  if (requested === 'ultra') return supported.at(-1) ?? 'auto'
  // 「关闭」已从 UI 可选项移除：历史值与平台配置里的 off 就近落位到最低思考档，不再回到 off。
  if (requested === 'off' && model?.supports_thinking) return nearestThinkingLevel(model)
  return supported.includes(requested as ModelThinkingLevel) ? requested as ModelThinkingLevel : 'auto'
}

/** UI 默认档：平台默认 → 模型默认 → 就近 low；不支持思考的模型交回 auto，由调用方隐藏选择器。 */
export function defaultThinkingLevel(preferred: string | null | undefined, model: ThinkingCapabilities | null | undefined): ThinkingLevel {
  if (!model?.supports_thinking) return 'auto'
  const normalized = normalizeThinkingLevel(preferred || model.thinking_default, model)
  return normalized === 'auto' ? nearestThinkingLevel(model) : normalized
}

export function resolveThinkingLevel(value: string | null | undefined, model: ThinkingCapabilities | null | undefined): ModelThinkingLevel {
  if (!model?.supports_thinking) return 'off'
  const normalized = normalizeThinkingLevel(value, model)
  if (normalized !== 'auto') return normalized
  // 模型未配置默认档时不能再落 levels[0]（那是 off）：就近落位到最低思考档。
  const defaultLevel = normalizeThinkingLevel(model.thinking_default, model)
  return defaultLevel === 'auto' ? nearestThinkingLevel(model) : defaultLevel
}
