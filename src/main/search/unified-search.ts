import type { SearchQuery, SearchResponse, SearchResult, SearchResultKind } from '../../shared/types'

/** 每一类默认取多少条。四类加起来才是一屏，单类给太多会把别的类挤没。 */
export const DEFAULT_KIND_LIMIT = 20

const ALL_KINDS: SearchResultKind[] = ['conversation', 'knowledge', 'skill', 'artifact']

/** 摘要窗口：命中词左右各留这么多字符。 */
const SNIPPET_RADIUS = 40

/**
 * 命中处的一行摘要。找不到关键词（例如只命中了标题）时退回开头一段，
 * 不返回空串——列表里一行空白比一段无关文字更难判断这条是什么。
 */
export function makeSnippet(text: string, keyword: string, radius = SNIPPET_RADIUS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const index = keyword ? flat.toLowerCase().indexOf(keyword.toLowerCase()) : -1
  if (index < 0) return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat
  const start = Math.max(0, index - radius)
  const end = Math.min(flat.length, index + keyword.length + radius)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

export type SearchProvider = (input: { keyword: string; projectId: string | null; limit: number }) => SearchResult[]

export type SearchProviders = Record<SearchResultKind, SearchProvider>

export function normalizeSearchQuery(query: SearchQuery): { keyword: string; kinds: SearchResultKind[]; projectId: string | null; limit: number } {
  const kinds = query.kinds?.length ? ALL_KINDS.filter((kind) => query.kinds?.includes(kind)) : ALL_KINDS
  return {
    keyword: query.keyword.trim(),
    kinds,
    projectId: query.projectId ?? null,
    limit: Math.min(Math.max(query.limit ?? DEFAULT_KIND_LIMIT, 1), 100)
  }
}

/**
 * 四类各查一次再合并。
 *
 * Skill 是全局能力，不属于任何项目：按项目过滤时它整类退出，
 * 而不是被当成「不属于该项目」逐条过滤掉——后者会让用户以为 Skill 没命中。
 */
export function runUnifiedSearch(query: SearchQuery, providers: SearchProviders): SearchResponse {
  const { keyword, kinds, projectId, limit } = normalizeSearchQuery(query)
  if (!keyword) return { results: [], truncated: false }
  const results: SearchResult[] = []
  let truncated = false
  for (const kind of kinds) {
    if (kind === 'skill' && projectId) continue
    const found = providers[kind]({ keyword, projectId, limit })
    if (found.length >= limit) truncated = true
    results.push(...found.slice(0, limit))
  }
  // 类内保持各自的相关度顺序，跨类按更新时间排：不同类之间没有可比的相关度分数。
  results.sort((left, right) => right.updatedAt - left.updatedAt)
  return { results, truncated }
}
