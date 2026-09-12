import type { MemoryRecord } from '../../../shared/types'
import type { MemoryCandidate } from './memory-extractor'

/** 判定「同一条记忆的另一种说法」的相似度阈值。 */
export const DUPLICATE_THRESHOLD = 0.82

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function trigrams(text: string): Set<string> {
  const set = new Set<string>()
  for (let index = 0; index + 3 <= text.length; index += 1) set.add(text.slice(index, index + 3))
  return set
}

/** Dice 系数。与 FTS 用同一套 trigram 视角，判重口径和检索口径一致。 */
export function trigramSimilarity(left: string, right: string): number {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length < 3 || b.length < 3) return 0
  const setA = trigrams(a)
  const setB = trigrams(b)
  let shared = 0
  for (const gram of setA) if (setB.has(gram)) shared += 1
  return (2 * shared) / (setA.size + setB.size)
}

export interface MemoryWritePlan {
  /** 需要新建的记忆，supersedes 里的既有记忆同时置为 superseded。 */
  creates: Array<{ candidate: MemoryCandidate; supersedes: string[] }>
  /** 与既有记忆重复：只刷新既有条目的时间与重要性，不新增行。 */
  refreshes: Array<{ id: string; importance: number }>
}

export interface PlanOptions {
  duplicateThreshold?: number
}

/**
 * 冲突消解只认模型显式声明的替代关系（extractor 的 <替代:n>），不做「相似即替代」的推断：
 * 「用 PostgreSQL」与「读库用 PostgreSQL、写库用 MySQL」相似度很高但不是替代关系，
 * 自动替代会静默丢事实，而漏替代只是多留一条旧记忆，用户还能在管理页删掉。
 */
export function planMemoryWrites(
  candidates: readonly MemoryCandidate[],
  existing: readonly MemoryRecord[],
  options: PlanOptions = {}
): MemoryWritePlan {
  const duplicateThreshold = options.duplicateThreshold ?? DUPLICATE_THRESHOLD
  const plan: MemoryWritePlan = { creates: [], refreshes: [] }
  const refreshed = new Set<string>()
  for (const candidate of candidates) {
    const sameBucket = existing.filter((memory) => memory.status === 'active' && memory.scope === candidate.scope && memory.type === candidate.type)
    const duplicate = sameBucket
      .map((memory) => ({ memory, similarity: trigramSimilarity(memory.content, candidate.content) }))
      .sort((left, right) => right.similarity - left.similarity)
      .find((item) => item.similarity >= duplicateThreshold)
    if (duplicate) {
      if (refreshed.has(duplicate.memory.id)) continue
      refreshed.add(duplicate.memory.id)
      plan.refreshes.push({ id: duplicate.memory.id, importance: Math.max(duplicate.memory.importance, candidate.importance) })
      continue
    }
    const supersedes = candidate.replaces
      .map((index) => existing[index - 1])
      .filter((memory): memory is MemoryRecord => Boolean(memory) && memory.status === 'active')
      .map((memory) => memory.id)
    plan.creates.push({ candidate, supersedes: [...new Set(supersedes)] })
  }
  return plan
}
