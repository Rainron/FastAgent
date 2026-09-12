import type { MemoryRecallHit, MemoryRecord } from '../../../shared/types'

/** 召回条数上限：太多会把 prompt 撑大，太少等于没有记忆。 */
export const MIN_RECALL = 3
export const MAX_RECALL = 8
export const DEFAULT_RECALL = 5

export function clampRecallLimit(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RECALL
  return Math.min(MAX_RECALL, Math.max(MIN_RECALL, Math.round(value)))
}

export interface RankableMemory {
  memory: MemoryRecord
  /** FTS 命中的名次（0 最相关）；纯 LIKE 兜底命中时为 null。 */
  matchPosition: number | null
}

export interface RankOptions {
  now: number
  limit: number
  /** 记忆更新多久后相关性衰减到 1/e，默认 30 天。 */
  halfLifeDays?: number
}

const WEIGHT_MATCH = 0.45
const WEIGHT_IMPORTANCE = 0.3
const WEIGHT_RECENCY = 0.15
const WEIGHT_CONFIDENCE = 0.1

/**
 * 不直接用 bm25 分值：不同语料下量级差异大，跨查询不可比。
 * 只取名次转成 0~1，剩下的权重交给 importance / recency / confidence。
 */
export function scoreMemory(item: RankableMemory, total: number, options: RankOptions): number {
  const { memory } = item
  const matchScore = item.matchPosition === null || total <= 1 ? 0.5 : 1 - item.matchPosition / total
  const importanceScore = Math.min(5, Math.max(1, memory.importance)) / 5
  const ageDays = Math.max(0, options.now - memory.updatedAt) / 86_400_000
  const recencyScore = Math.exp(-ageDays / (options.halfLifeDays ?? 30))
  const confidenceScore = Math.min(1, Math.max(0, memory.confidence))
  return WEIGHT_MATCH * matchScore + WEIGHT_IMPORTANCE * importanceScore + WEIGHT_RECENCY * recencyScore + WEIGHT_CONFIDENCE * confidenceScore
}

/** 同一内容可能在多个作用域各存一条，注入时只保留分数最高的那条。 */
function dedupeByContent(hits: MemoryRecallHit[]): MemoryRecallHit[] {
  const seen = new Set<string>()
  const kept: MemoryRecallHit[] = []
  for (const hit of hits) {
    const key = hit.memory.content.replace(/\s+/g, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(hit)
  }
  return kept
}

export function rankMemories(items: RankableMemory[], options: RankOptions): MemoryRecallHit[] {
  const scored = items.map((item) => ({ memory: item.memory, score: scoreMemory(item, items.length, options) }))
  // 分数相同时按 id 定序，保证同一批输入的结果稳定可断言。
  scored.sort((left, right) => right.score - left.score || left.memory.id.localeCompare(right.memory.id))
  return dedupeByContent(scored).slice(0, Math.max(1, options.limit))
}
