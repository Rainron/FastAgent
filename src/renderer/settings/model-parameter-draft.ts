import type { ThinkingLevelMap } from '../../shared/types'
import type { ModelParameterOverride } from '../../shared/model-parameters'

/**
 * 模型参数的表单草稿。
 *
 * 数值与 JSON 字段在表单里必须以字符串停留：输入过程中会经过「17」「1.」「{"a":」
 * 这类中间态，边打边解析会把光标位置和已输入内容一起弄丢。草稿层只做字符串进出，
 * 解析统一在提交时发生，空串一律表示「没设过」而不是「设成空」。
 *
 * 连接内模型与云端模型覆盖共用这一层，两边的差别只在提交后写去哪里。
 */
export interface ModelParameterDraft {
  contextWindow: string
  maxTokens: string
  temperature: string
  timeout: string
  maxRetries: string
  /** 空串表示「跟随来源」，用于云端覆盖的三态；连接内模型只用 'chat' / 'multimodal'。 */
  modelKind: '' | 'chat' | 'multimodal'
  supportsThinking: '' | 'yes' | 'no'
  thinkingDefault: string
  extraBody: string
  compat: string
}

export const EMPTY_PARAMETER_DRAFT: ModelParameterDraft = {
  contextWindow: '', maxTokens: '', temperature: '', timeout: '', maxRetries: '',
  modelKind: '', supportsThinking: '', thinkingDefault: '', extraBody: '', compat: ''
}

export interface ModelParameterSource {
  context_window?: number | null
  max_tokens?: number | null
  temperature?: number
  timeout?: number
  max_retries?: number
  model_kind?: 'chat' | 'multimodal'
  supports_thinking?: boolean
  thinking_default?: string
  thinking_level_map?: ThinkingLevelMap
  extra_body?: Record<string, unknown> | null
  compat?: Record<string, unknown> | null
}

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

function jsonText(value: Record<string, unknown> | null | undefined): string {
  return value && Object.keys(value).length ? JSON.stringify(value, null, 2) : ''
}

/** 把已保存的值回填成草稿。缺失字段留空串，界面据此显示来源占位符。 */
export function draftFromSource(source: ModelParameterSource | null | undefined): ModelParameterDraft {
  if (!source) return { ...EMPTY_PARAMETER_DRAFT }
  return {
    contextWindow: numberText(source.context_window),
    maxTokens: numberText(source.max_tokens),
    temperature: numberText(source.temperature),
    timeout: numberText(source.timeout),
    maxRetries: numberText(source.max_retries),
    modelKind: source.model_kind ?? '',
    supportsThinking: source.supports_thinking === undefined ? '' : source.supports_thinking ? 'yes' : 'no',
    thinkingDefault: source.thinking_default ?? '',
    extraBody: jsonText(source.extra_body),
    compat: jsonText(source.compat)
  }
}

export type JsonFieldResult =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; error: string }

/** JSON 文本解析：空串是「未设置」（null），合法对象照收，其余给出可读错误。 */
export function parseJsonField(value: string): JsonFieldResult {
  const text = value.trim()
  if (!text) return { ok: true, data: null }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: '必须是 JSON 对象，如 {"key": "value"}' }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, error: 'JSON 格式不正确' }
  }
}

/** 正整数字段；空串、非整数、非正数一律视为未填。 */
export function positiveInteger(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/** 允许 0 与小数的数值字段（温度、重试次数）。 */
export function finiteNumber(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

/** 非负整数字段；重试次数 0 是有意义的取值，不能当作未填。 */
export function nonNegativeInteger(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

/** 草稿里所有能报错的字段；返回空数组表示可以提交。 */
export function draftErrors(draft: ModelParameterDraft): string[] {
  const errors: string[] = []
  const extraBody = parseJsonField(draft.extraBody)
  if (!extraBody.ok) errors.push(`请求体扩展字段：${extraBody.error}`)
  const compat = parseJsonField(draft.compat)
  if (!compat.ok) errors.push(`供应商兼容配置：${compat.error}`)
  if (draft.contextWindow.trim() && positiveInteger(draft.contextWindow) === undefined) errors.push('上下文窗口必须是正整数')
  if (draft.maxTokens.trim() && positiveInteger(draft.maxTokens) === undefined) errors.push('最大输出必须是正整数')
  if (draft.timeout.trim() && positiveInteger(draft.timeout) === undefined) errors.push('超时必须是正整数秒')
  if (draft.maxRetries.trim() && nonNegativeInteger(draft.maxRetries) === undefined) errors.push('重试次数必须是非负整数')
  if (draft.temperature.trim() && finiteNumber(draft.temperature) === undefined) errors.push('温度必须是数字')
  return errors
}

/**
 * 草稿 → 覆盖对象。只登记填过的字段：留空即「没设过」，调用方据此让下一级来源生效。
 * 草稿有错时返回 null，由调用方拦住提交。
 */
export function overrideFromDraft(draft: ModelParameterDraft): ModelParameterOverride | null {
  if (draftErrors(draft).length) return null
  const extraBody = parseJsonField(draft.extraBody)
  const compat = parseJsonField(draft.compat)
  if (!extraBody.ok || !compat.ok) return null
  const override: ModelParameterOverride = {}
  const contextWindow = positiveInteger(draft.contextWindow)
  if (contextWindow !== undefined) override.context_window = contextWindow
  const maxTokens = positiveInteger(draft.maxTokens)
  if (maxTokens !== undefined) override.max_tokens = maxTokens
  const temperature = finiteNumber(draft.temperature)
  if (temperature !== undefined) override.temperature = temperature
  const timeout = positiveInteger(draft.timeout)
  if (timeout !== undefined) override.timeout = timeout
  const maxRetries = nonNegativeInteger(draft.maxRetries)
  if (maxRetries !== undefined) override.max_retries = maxRetries
  if (draft.modelKind) override.model_kind = draft.modelKind
  if (draft.supportsThinking) override.supports_thinking = draft.supportsThinking === 'yes'
  if (draft.thinkingDefault.trim()) override.thinking_default = draft.thinkingDefault.trim()
  if (extraBody.data) override.extra_body = extraBody.data
  if (compat.data) override.compat = compat.data
  return override
}

/**
 * 草稿 → 连接内模型的参数补丁。
 *
 * 与覆盖的差别只有 JSON 字段：连接保存走 `?? previous`，传 undefined 表示保留旧值，
 * 所以「清空」必须显式传 null，否则用户永远删不掉已存的 extra_body。
 */
export interface ConnectionModelPatch {
  contextWindow?: number
  maxTokens?: number
  temperature?: number
  timeout?: number
  maxRetries?: number
  vision?: boolean
  reasoning?: boolean
  thinkingDefault?: string
  extraBody: Record<string, unknown> | null
  compat: Record<string, unknown> | null
}

export function connectionPatchFromDraft(draft: ModelParameterDraft): ConnectionModelPatch | null {
  const override = overrideFromDraft(draft)
  if (!override) return null
  const extraBody = parseJsonField(draft.extraBody)
  const compat = parseJsonField(draft.compat)
  if (!extraBody.ok || !compat.ok) return null
  return {
    contextWindow: override.context_window,
    maxTokens: override.max_tokens,
    temperature: override.temperature,
    timeout: override.timeout,
    maxRetries: override.max_retries,
    vision: draft.modelKind ? draft.modelKind === 'multimodal' : undefined,
    reasoning: draft.supportsThinking ? draft.supportsThinking === 'yes' : undefined,
    thinkingDefault: override.thinking_default,
    extraBody: extraBody.data,
    compat: compat.data
  }
}
