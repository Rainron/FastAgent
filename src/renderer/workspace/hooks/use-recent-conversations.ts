import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { toWorkspaceConversation } from '../../conversation/conversation-meta'
import { useEventCallback } from '../../use-event-callback'
import { mergeSidebarPage } from '../sidebar-list'
import type { WorkspaceConversation } from '../workspace-types'

const PAGE_SIZE = 100

export interface RecentConversations {
  items: WorkspaceConversation[]
  setItems: Dispatch<SetStateAction<WorkspaceConversation[]>>
  total: number
  loading: boolean
  error: string | null
  loadMore: () => void
  retry: () => void
  setQuery: (query: string) => void
}

/** 最近对话始终跨工作区；搜索由服务端分页，避免只搜到预览中的几条。 */
export function useRecentConversations(refreshKey: number, selectionKey: string | null): RecentConversations {
  const [items, setItems] = useState<WorkspaceConversation[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const page = useRef(0)
  const generation = useRef(0)
  const busy = useRef(false)
  const fetchPage = useEventCallback((nextPage: number, replace: boolean) => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError(null)
    const request = generation.current
    void window.fastAgent.conversations.listPage({ page: nextPage, pageSize: PAGE_SIZE, projectScope: 'all', keyword: query.trim() || undefined })
      .then((result) => {
        if (request !== generation.current) return
        setItems((current) => replace ? result.items.filter((item) => !item.archived).map(toWorkspaceConversation) : mergeSidebarPage(current, result.items.filter((item) => !item.archived).map(toWorkspaceConversation)))
        setTotal(result.total)
        page.current = result.page
      })
      .catch(() => { if (request === generation.current) setError('最近对话加载失败') })
      .finally(() => { if (request === generation.current) { busy.current = false; setLoading(false) } })
  })

  useEffect(() => {
    generation.current++
    busy.current = false
    page.current = 0
    fetchPage(1, true)
    return () => { generation.current++; busy.current = false }
  }, [refreshKey, selectionKey, query, fetchPage])

  const loadMore = useEventCallback(() => {
    if (error || busy.current || page.current * PAGE_SIZE >= total) return
    fetchPage(page.current + 1, false)
  })
  const retry = useEventCallback(() => { if (!busy.current) fetchPage(page.current + 1, page.current === 0) })
  return { items, setItems, total, loading, error, loadMore, retry, setQuery }
}
