import { useCallback, useEffect, useRef, useState } from 'react'
import { toWorkspaceConversation } from '../../conversation/conversation-meta'
import { mergeSidebarPage, resolveConversationRequest, type ConversationRequestScope } from '../sidebar-list'
import type { WorkspaceConversation } from '../workspace-types'

/** 展开后先给这么多条，够看清「这个项目最近在干什么」，再多用「展开显示」取。 */
export const PROJECT_CONVERSATION_PREVIEW = 5
export const PROJECT_CONVERSATION_PAGE_SIZE = 100

export interface ProjectConversations {
  items: WorkspaceConversation[]
  total: number
  showAll: boolean
  loaded: boolean
  loading: boolean
  error: boolean
  hasMore: boolean
  loadMore: () => void
  retry: () => void
  toggleShowAll: () => void
}

/**
 * 展开的项目单独拉自己的会话。
 *
 * 不复用侧栏「最近」那份数据：那份是全量口径的前 N 条，按项目过滤会漏掉排在后面的会话，
 * 表现成「项目下面空着，但会话中心里明明有」。
 *
 * `refreshKey` 由会话增删改事件递增，搜索最近对话时不触发项目列表重拉。
 */
export function useProjectConversations(projectId: string, expanded: boolean, refreshKey: unknown, previewLimit = PROJECT_CONVERSATION_PREVIEW): ProjectConversations {
  const [items, setItems] = useState<WorkspaceConversation[]>([])
  const [total, setTotal] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const limit = showAll ? PROJECT_CONVERSATION_PAGE_SIZE : previewLimit
  const previousRequestScope = useRef<ConversationRequestScope | null>(null)

  useEffect(() => {
    const decision = resolveConversationRequest(previousRequestScope.current, { projectId, refreshKey, expanded, page, limit })
    previousRequestScope.current = { projectId, refreshKey, expanded, page, limit }
    if (decision.kind === 'idle') { setPage(1); setHasMore(false); setLoading(false); return }
    if (decision.kind === 'reset') { setPage(1); setHasMore(false); return }
    let cancelled = false
    setLoading(true)
    setError(false)
    void window.fastAgent.conversations
      .listPage({ page: decision.page, pageSize: decision.limit, projectScope: projectId })
      .then((result) => {
        if (cancelled) return
        const mapped = result.items.filter((record) => !record.archived).map(toWorkspaceConversation)
        setItems((current) => decision.replace ? mapped : mergeSidebarPage(current, mapped))
        setTotal(result.total)
        setLoaded(true)
        setHasMore(decision.page * decision.limit < result.total)
      })
      .catch(() => { if (!cancelled) { setLoaded(true); setError(true); setHasMore(false) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, expanded, page, limit, refreshKey, retryKey])

  const toggleShowAll = useCallback(() => {
    // 收起要在同一次渲染里就把列表截短：只翻 showAll 的话，列表要等重新拉取返回才变短，
    // 调用方的滚动锚点在这一帧量不到任何位移，等数据回来几十行一下子消失，视口就被带到下面的「最近对话」。
    // 列表与预览同一个排序口径，截前 N 条和重新拉取的结果一致。
    if (showAll) { setItems((current) => current.slice(0, previewLimit)); setPage(1); setHasMore(false) }
    else setPage(1)
    setShowAll((current) => !current)
  }, [showAll, previewLimit])
  const loadMore = useCallback(() => { if (!loading && hasMore) setPage((current) => current + 1) }, [loading, hasMore])
  const retry = useCallback(() => { setRetryKey((current) => current + 1) }, [])

  return { items, total, showAll, loaded, loading, error, hasMore, loadMore, retry, toggleShowAll }
}
