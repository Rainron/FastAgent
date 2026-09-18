import type { ModelThinkingLevel, ThinkingLevel, ThinkingLevelMap } from './types'

export interface ThinkingCapabilities {
  supports_thinking?: boolean
  thinking_default?: string
  thinking_profiles?: Record<string, unknown> | null
  thinking_level_map?: ThinkingLevelMap
}

const levels: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function getSupportedThinkingLevels(model: ThinkingCapabilities | null | undefined): ModelThinkingLevel[] {
  if (!model?.supports_thinking) return ['off']
  const profiles = Object.keys(model.thinking_profiles ?? {}).map((level) => level.toLowerCase())
  const configured = profiles.filter((level) => levels.includes(level as ModelThinkingLevel))
  return levels.filter((level) => {
    const mapped = model.thinking_level_map?.[level]
    if (mapped === null) return false
    if ((level === 'xhigh' || level === 'max') && typeof mapped !== 'string') return false
    return level === 'off' || !configured.length || configured.includes(level)
  })
}

export function normalizeThinkingLevel(value: string | null | undefined, model?: ThinkingCapabilities | null): ThinkingLevel {
  const requested = value?.trim().toLowerCase()
  if (!requested || requested === 'auto') return 'auto'
  const supported = getSupportedThinkingLevels(model)
  // 旧版 Ultra 从未是 pi 合法档位，恢复时保留其选择最高强度的意图。
  if (requested === 'ultra') return supported.at(-1) ?? 'auto'
  return supported.includes(requested as ModelThinkingLevel) ? requested as ModelThinkingLevel : 'auto'
}

export function resolveThinkingLevel(value: string | null | undefined, model: ThinkingCapabilities | null | undefined): ModelThinkingLevel {
  if (!model?.supports_thinking) return 'off'
  const normalized = normalizeThinkingLevel(value, model)
  if (normalized !== 'auto') return normalized
  const defaultLevel = normalizeThinkingLevel(model.thinking_default, model)
  return defaultLevel === 'auto' ? getSupportedThinkingLevels(model)[0] ?? 'off' : defaultLevel
}
