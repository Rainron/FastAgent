import type { KnowledgeSettings } from './types'

/**
 * 知识库单轮注入条数。条目是整段原文、比一条记忆长得多，
 * 默认 3 条沿用引入设置前写死的值，上限 8 防止一轮就把上下文吃掉一大块。
 */
export const KB_RECALL_LIMITS = { default: 3, min: 1, max: 8 } as const

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = { enabled: true, maxRecall: KB_RECALL_LIMITS.default }

export function clampKbRecall(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return KB_RECALL_LIMITS.default
  return Math.min(Math.max(Math.round(value), KB_RECALL_LIMITS.min), KB_RECALL_LIMITS.max)
}

/** knowledge 是后加的嵌套设置，旧记录里整块缺失，浅合并补不回来。 */
export function normalizeKnowledgeSettings(value: Partial<KnowledgeSettings> | undefined): KnowledgeSettings {
  return { enabled: value?.enabled ?? true, maxRecall: clampKbRecall(value?.maxRecall) }
}
