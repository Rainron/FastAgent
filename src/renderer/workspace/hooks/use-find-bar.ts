import { useEffect, useState } from 'react'
import type { WorkspaceSection } from '../workspace-types'

/**
 * Ctrl+F 页内查找：只在对话分区拦截（其余分区交给浏览器默认行为），重复按下重新聚焦。
 * 离开对话分区（含进入批量管理）时收起，避免高亮残留在别的分区上。
 */
export function useFindBar(section: WorkspaceSection, batchKind: 'conversations' | 'projects' | null) {
  const [findOpen, setFindOpen] = useState(false)
  const [findRequest, setFindRequest] = useState(0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'f' || event.shiftKey || event.altKey) return
      if (!event.ctrlKey && !event.metaKey) return
      if (section !== 'chats' || batchKind === 'conversations') return
      event.preventDefault()
      setFindOpen(true)
      setFindRequest((value) => value + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [section, batchKind])

  useEffect(() => {
    if (section !== 'chats' || batchKind === 'conversations') setFindOpen(false)
  }, [section, batchKind])

  return { findOpen, findRequest, setFindOpen }
}
