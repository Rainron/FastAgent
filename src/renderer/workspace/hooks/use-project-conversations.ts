import { useEffect, useState } from 'react'
import { toWorkspaceConversation } from '../../conversation/conversation-meta'
import type { WorkspaceConversation } from '../workspace-types'

/** 展开后先给这么多条，够看清「这个项目最近在干什么」，再多用「展开显示」取。 */
export const PROJECT_CONVERSATION_PREVIEW = 5
export const PROJECT_CONVERSATION_MAX = 30

export interface ProjectConversations {
  items: WorkspaceConversation[]
  total: number
  showAll: boolean
  loaded: boolean
  toggleShowAll: () => void
}

/**
 * 展开的项目单独拉自己的会话。
 *
 * 不复用侧栏「最近」那份数据：那份是全量口径的前 N 条，按项目过滤会漏掉排在后面的会话，
 * 表现成「项目下面空着，但会话中心里明明有」。
 *
 * `refreshKey` 传侧栏的会话列表引用：新建、改名、删除都会换引用，跟着重拉一次即可。
 */
export function useProjectConversations(projectId: string, expanded: boolean, refreshKey: unknown): ProjectConversations {
  const [items, setItems] = useState<WorkspaceConversation[]>([])
  const [total, setTotal] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    void window.fastAgent.conversations
      .listPage({ pageSize: showAll ? PROJECT_CONVERSATION_MAX : PROJECT_CONVERSATION_PREVIEW, projectScope: projectId })
      .then((result) => {
        if (cancelled) return
        setItems(result.items.filter((record) => !record.archived).map(toWorkspaceConversation))
        setTotal(result.total)
        setLoaded(true)
      })
      // 取不到就当这个项目没有会话，不该把侧栏整段拖成错误态
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [projectId, expanded, showAll, refreshKey])

  const toggleShowAll = () => {
    // 收起要在同一次渲染里就把列表截短：只翻 showAll 的话，列表要等重新拉取返回才变短，
    // 调用方的滚动锚点在这一帧量不到任何位移，等数据回来几十行一下子消失，视口就被带到下面的「最近对话」。
    // 列表与预览同一个排序口径，截前 N 条和重新拉取的结果一致。
    if (showAll) setItems((current) => current.slice(0, PROJECT_CONVERSATION_PREVIEW))
    setShowAll(!showAll)
  }

  return { items, total, showAll, loaded, toggleShowAll }
}
