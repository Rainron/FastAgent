import type { SearchResult, SearchResultKind } from '../../../shared/types'

export const SEARCH_KIND_LABELS: Record<SearchResultKind, string> = {
  conversation: '会话',
  knowledge: '知识',
  skill: 'Skill',
  artifact: '成果'
}

export const SEARCH_KINDS: SearchResultKind[] = ['conversation', 'knowledge', 'skill', 'artifact']

/** 类型筛选：一个都不选等于全选，避免出现「什么都搜不到」的空态。 */
export function effectiveKinds(selected: readonly SearchResultKind[]): SearchResultKind[] {
  return selected.length ? [...selected] : SEARCH_KINDS
}

export function toggleKind(selected: readonly SearchResultKind[], kind: SearchResultKind): SearchResultKind[] {
  return selected.includes(kind) ? selected.filter((item) => item !== kind) : [...selected, kind]
}

/** 各类命中条数，用于筛选条上的计数。 */
export function countByKind(results: readonly SearchResult[]): Record<SearchResultKind, number> {
  const counts = { conversation: 0, knowledge: 0, skill: 0, artifact: 0 }
  for (const result of results) counts[result.kind] += 1
  return counts
}

/** 结果行的次要说明：知识与成果给原文位置，Skill 给本地路径，会话没有可给的定位。 */
export function resultLocationLabel(result: SearchResult): string {
  if (result.kind === 'conversation') return ''
  return result.locator ?? ''
}

/** 项目筛选下 Skill 不参与查询，界面要说清楚，不能让用户以为是「没命中」。 */
export function skillScopeNotice(projectScope: string): string {
  return projectScope === 'all' ? '' : 'Skill 是全局能力，按项目筛选时不参与搜索'
}
