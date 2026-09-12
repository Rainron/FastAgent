import type { LocalModelSummary, ModelOption, ThinkingLevel } from '../shared/types'

export type ModelTabKey = 'all' | 'recent' | 'favorite'

export interface ModelTab {
  key: ModelTabKey
  label: string
  count: number
}

export interface ProviderOption {
  provider: string
  count: number
}

/** 模型与偏好异步到达时，优先保留用户上次选择，再回退到服务端默认模型。 */
export function initialSelectedModelId(models: Array<Pick<ModelOption, 'id'>>, defaultModelId: number | null | undefined, preferredModelId: number | null | undefined = null): number | null {
  return models.find((model) => model.id === preferredModelId)?.id
    ?? models.find((model) => model.id === defaultModelId)?.id
    ?? models[0]?.id
    ?? null
}

/** 打开会话时的模型：会话绑定优先；绑定的模型已删除或下架时回退到当前应用选择。 */
export function conversationModelId(models: Array<Pick<ModelOption, 'id'>>, boundModelId: number | null | undefined, fallbackModelId: number | null): number | null {
  return models.find((model) => model.id === boundModelId)?.id ?? fallbackModelId
}

const levelOrder: ThinkingLevel[] = ['auto', 'minimal', 'low', 'medium', 'high', 'max', 'xhigh', 'ultra']

const levelLabels: Record<string, string> = { auto: 'Auto', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', max: 'Max', xhigh: 'XHigh', ultra: 'Ultra' }

const levelShortLabels: Record<string, string> = { auto: 'Auto', minimal: 'Min', low: 'Low', medium: 'Med', high: 'High', max: 'Max', xhigh: 'XHi', ultra: 'Ultra' }

const levelDescriptions: Record<string, string> = {
  auto: '根据当前任务自动调整',
  minimal: '几乎不推理，最快返回',
  low: '更快响应，适合简单任务',
  medium: '平衡速度与推理能力',
  high: '适合复杂任务、代码分析和深度推理',
  max: '尽可能深入推理，耗时最长',
  xhigh: '超高强度推理，用于困难问题',
  ultra: '最高强度推理，用于极端复杂任务'
}

export function filterModelOptions(models: ModelOption[], query: string) {
  const value = query.trim().toLocaleLowerCase()
  if (!value) return models
  return models.filter((model) => [model.name, model.model_name, model.provider, model.description].some((item) => item?.toLocaleLowerCase().includes(value)))
}

/** 收藏和最近为空时不占位。 */
export function modelTabs(models: ModelOption[], options: { favoriteIds?: number[]; recentIds?: number[] } = {}): ModelTab[] {
  const favorites = modelsForTab(models, 'favorite', options)
  const recent = modelsForTab(models, 'recent', options)
  const tabs: ModelTab[] = [{ key: 'all', label: '全部', count: models.length }]
  if (recent.length) tabs.push({ key: 'recent', label: '最近', count: recent.length })
  if (favorites.length) tabs.push({ key: 'favorite', label: '收藏', count: favorites.length })
  return tabs
}

export function modelsForTab(models: ModelOption[], tab: ModelTabKey, options: { favoriteIds?: number[]; recentIds?: number[] } = {}): ModelOption[] {
  if (tab === 'favorite') {
    const favoriteIds = new Set(options.favoriteIds ?? [])
    return models.filter((model) => favoriteIds.has(model.id))
  }
  // 最近使用按点击顺序排列，不跟随模型列表原顺序。
  if (tab === 'recent') return (options.recentIds ?? []).map((id) => models.find((model) => model.id === id)).filter((model): model is ModelOption => Boolean(model))
  return models
}

export function providerOptions(models: ModelOption[]): ProviderOption[] {
  const counts = new Map<string, number>()
  for (const model of models) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1)
  return [...counts.entries()].map(([provider, count]) => ({ provider, count }))
}

/** 搜索优先于分页签和 provider 过滤，输入关键字时直接在全量模型里找。 */
export function visibleModelOptions(models: ModelOption[], options: { tab?: ModelTabKey; provider?: string | null; query?: string; favoriteIds?: number[]; recentIds?: number[] } = {}): ModelOption[] {
  const query = options.query?.trim() ?? ''
  if (query) return filterModelOptions(models, query)
  const scoped = modelsForTab(models, options.tab ?? 'all', options)
  return options.provider ? scoped.filter((model) => model.provider === options.provider) : scoped
}

export interface ModelGroup {
  /** 提供商名称，取自 ModelOption.provider。 */
  channel: string
  models: ModelOption[]
}

/**
 * 按提供商分组。provider 是用户可见的模型提供商，protocol 仅用于运行时调用。
 * 组内与组间都保持传入顺序，避免弹层每次打开顺序都在变。
 */
export function groupModelsByChannel(models: ModelOption[]): ModelGroup[] {
  const groups = new Map<string, ModelOption[]>()
  for (const model of models) {
    const existing = groups.get(model.provider)
    if (existing) existing.push(model)
    else groups.set(model.provider, [model])
  }
  return [...groups.entries()].map(([channel, items]) => ({ channel, models: items }))
}

/** 打开时只展开当前所选模型所在的分组；没有所选模型时全部折叠。 */
export function initialExpandedChannels(groups: ModelGroup[], selectedModelId: number | null): string[] {
  const owner = groups.find((group) => group.models.some((model) => model.id === selectedModelId))
  return owner ? [owner.channel] : []
}

/** 展开态下真正渲染出来的模型，顺序与列表一致，键盘上下键靠它定位。 */
export function expandedModels(groups: ModelGroup[], expanded: ReadonlySet<string>): ModelOption[] {
  return groups.flatMap((group) => expanded.has(group.channel) ? group.models : [])
}

/** 列表内 ↑↓ 循环移动，空列表返回 -1。 */
export function stepModelIndex(count: number, index: number, direction: -1 | 1): number {
  if (count <= 0) return -1
  return (index + direction + count) % count
}

export function thinkingLevelsForModel(model: ModelOption | null | undefined): ThinkingLevel[] {
  if (!model?.supports_thinking) return []
  const configured = model.thinking_profiles && typeof model.thinking_profiles === 'object' ? Object.keys(model.thinking_profiles) : []
  const values = configured.length ? configured : ['auto', 'low', 'medium', 'high']
  if (model.thinking_default && !values.some((value) => value.toLowerCase() === model.thinking_default?.toLowerCase())) values.push(model.thinking_default)
  const normalized = values.map((value) => value.toLowerCase() === 'off' ? 'auto' : value.toLowerCase()) as ThinkingLevel[]
  return [...new Set(normalized)].sort((a, b) => (levelOrder.indexOf(a) === -1 ? 99 : levelOrder.indexOf(a)) - (levelOrder.indexOf(b) === -1 ? 99 : levelOrder.indexOf(b)))
}

export function normalizeThinkingLevel(value: string | null | undefined): ThinkingLevel {
  return (value?.toLowerCase() === 'off' || !value ? 'auto' : value.toLowerCase()) as ThinkingLevel
}

export function thinkingLevelLabel(level: ThinkingLevel) {
  return levelLabels[level] || level
}

export function thinkingLevelShortLabel(level: ThinkingLevel) {
  return levelShortLabels[level] || levelLabels[level] || level
}

export function thinkingLevelDescription(level: ThinkingLevel) {
  return levelDescriptions[level] || '由模型自行决定推理强度'
}

/**
 * 底栏只显示模型名，思考强度由独立控件承担。
 */
export function triggerModelLabel(model: ModelOption | null | undefined) {
  return model?.model_name ?? '选择模型'
}

/** 弹层里的二级信息：提供商名已经在分组头上，行内只留调用协议与是否支持推理。 */
export function modelMetaLabel(model: ModelOption) {
  return [model.protocol ?? model.provider, model.supports_thinking ? 'Reasoning' : null].filter(Boolean).join(' · ')
}

/** 本地模型转成 ModelOption：负数 id 天然与云端隔离，source 标记来源供 UI 区分。 */
export function localModelToOption(local: LocalModelSummary): ModelOption {
  return {
    id: local.id,
    name: local.provider,
    model_name: local.model_name,
    model_kind: local.model_kind,
    provider: local.name,
    protocol: local.protocol ?? (local.provider === 'anthropic' || local.provider === 'openai-responses' || local.provider === 'openai' ? local.provider : 'openai'),
    description: `本地模型 · ${local.base_url}`,
    supports_thinking: local.supports_thinking,
    thinking_default: local.thinking_default,
    thinking_profiles: local.thinking_profiles,
    source: 'local'
  }
}

/** 云端 + 本地合并成一份模型列表：云端保持原顺序，本地追加在后。 */
export function mergeModelOptions(cloud: ModelOption[], local: LocalModelSummary[]): ModelOption[] {
  return [...cloud, ...local.map(localModelToOption)]
}
