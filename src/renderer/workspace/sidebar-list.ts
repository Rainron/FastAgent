/** 裁剪预览列表；活动项可越过上限保证始终可见。 */
export function cropSidebarList<T extends { id: string }>(items: T[], limit: number, expanded: boolean, requiredIds: ReadonlySet<string> = new Set()): T[] {
  if (expanded || items.length <= limit) return items
  const kept = items.slice(0, Math.max(0, limit))
  const ids = new Set(kept.map((item) => item.id))
  for (const item of items) {
    if (requiredIds.has(item.id) && !ids.has(item.id)) {
      kept.push(item)
      ids.add(item.id)
    }
  }
  return kept
}

/** 分页重叠时按 id 去重，更新已有条目但保留列表位置。 */
export function mergeSidebarPage<T extends { id: string }>(current: T[], page: T[]): T[] {
  const next = current.slice()
  const indexes = new Map(next.map((item, index) => [item.id, index]))
  for (const item of page) {
    const index = indexes.get(item.id)
    if (index === undefined) {
      indexes.set(item.id, next.length)
      next.push(item)
    } else next[index] = item
  }
  return next
}

export interface ConversationRequestScope {
  projectId: string
  refreshKey: unknown
  expanded: boolean
  page: number
  limit: number
}

export type ConversationRequestDecision =
  /** 收起状态：不发请求，回到第一页待命 */
  | { kind: 'idle' }
  /** 作用域换了但页码还没归位，本帧只归位、不发请求 */
  | { kind: 'reset' }
  | { kind: 'fetch'; page: number; limit: number; replace: boolean }

/**
 * 决定项目会话列表这一次该不该发请求、发第几页。
 *
 * 作用域（项目 / 刷新键 / 每批条数 / 从收起变为展开）一变，页码必须先回到第一页，
 * 否则会用旧页码去补齐新作用域，表现出「换项目后列表缺了前几页」。
 */
export function resolveConversationRequest(previous: ConversationRequestScope | null, current: ConversationRequestScope): ConversationRequestDecision {
  if (!current.expanded) return { kind: 'idle' }
  const scopeChanged = !previous
    || previous.projectId !== current.projectId
    || previous.refreshKey !== current.refreshKey
    || previous.limit !== current.limit
    || (!previous.expanded && current.expanded)
  if (scopeChanged && current.page !== 1) return { kind: 'reset' }
  return { kind: 'fetch', page: current.page, limit: current.limit, replace: current.page === 1 }
}
