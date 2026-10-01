import type { ThinkingLevelMap } from './types/common'

/**
 * 云端模型的本地参数覆盖。
 *
 * 云端清单由后端下发，用户改不了；一旦某个模型的窗口、输出上限或兼容配置不对，
 * 界面数字、压缩触发点、请求体全都跟着错，而本地没有任何补救入口。这里让用户
 * 在本机覆盖这些值，覆盖永远优先于下发值——后端修正了数据也不会把用户的判断顶掉。
 *
 * 连接内模型不走这里：它们的参数本来就存在自己的 payload 里，直接改那份即可。
 *
 * 只登记「用户显式设过」的键。删除某项要把键整个删掉，不能写 null——
 * 写 null 就分不清「用户想设成空」和「用户没设过」。
 */
export interface ModelParameterOverride {
  context_window?: number
  max_tokens?: number
  temperature?: number
  timeout?: number
  max_retries?: number
  model_kind?: 'chat' | 'multimodal'
  supports_thinking?: boolean
  thinking_level_map?: ThinkingLevelMap
  thinking_default?: string
  extra_body?: Record<string, unknown> | null
  compat?: Record<string, unknown> | null
}

/** 可覆盖字段的全集；读写两端都按它裁剪，避免把无关字段写进覆盖表。 */
export const MODEL_OVERRIDE_KEYS = [
  'context_window',
  'max_tokens',
  'temperature',
  'timeout',
  'max_retries',
  'model_kind',
  'supports_thinking',
  'thinking_level_map',
  'thinking_default',
  'extra_body',
  'compat'
] as const satisfies readonly (keyof ModelParameterOverride)[]

/**
 * 覆盖表的键。用 provider + 模型名而不是后端下发的数字 id：
 * 重新登录后 id 可能变，用户设过的覆盖不该因此丢失。
 */
export function overrideKey(provider: string, modelName: string): string {
  return `${provider}\t${modelName}`
}

/** 裁剪出合法的覆盖字段，顺手丢掉 undefined 与不认识的键。 */
export function normalizeOverride(input: unknown): ModelParameterOverride {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const source = input as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of MODEL_OVERRIDE_KEYS) {
    if (source[key] !== undefined) result[key] = source[key]
  }
  return result as ModelParameterOverride
}

/** 覆盖里没有任何键时视为「未设置」，调用方据此决定删行还是写行。 */
export function isEmptyOverride(override: ModelParameterOverride): boolean {
  return Object.keys(normalizeOverride(override)).length === 0
}

/**
 * 把覆盖套到模型或凭证上。只有覆盖里出现过的键会生效，其余原样保留。
 * 泛型让 ModelOption 与 ModelCredentials 共用同一个合并点。
 */
export function applyOverride<T extends object>(model: T, override: ModelParameterOverride | undefined | null): T {
  if (!override) return model
  const patch = normalizeOverride(override)
  return Object.keys(patch).length ? { ...model, ...patch } : model
}

/** 按 provider + 模型名批量套用；查不到覆盖的模型原样返回。 */
export function applyOverrides<T extends { provider: string; model_name: string }>(
  models: T[],
  overrides: ReadonlyMap<string, ModelParameterOverride>
): T[] {
  if (!overrides.size) return models
  return models.map((model) => applyOverride(model, overrides.get(overrideKey(model.provider, model.model_name))))
}
