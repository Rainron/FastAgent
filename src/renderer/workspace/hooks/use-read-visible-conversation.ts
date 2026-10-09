import { useEffect } from 'react'

/**
 * 离开期间（停在设置页、窗口最小化）跑完的结果，回到这条会话且窗口可见时就算看过了；
 * 否则用户正盯着的会话在侧栏上还挂着一枚要手动点掉的未读点。
 * onRead 需引用稳定（useEventCallback），否则每次渲染都会重挂监听。
 */
export function useReadVisibleConversation(visibleConversationId: string | null, hasUnread: boolean, onRead: (conversationId: string) => void) {
  useEffect(() => {
    if (!visibleConversationId || !hasUnread) return
    const read = () => {
      if (document.visibilityState !== 'visible') return
      void window.fastAgent.chat.markRead(visibleConversationId)
      onRead(visibleConversationId)
    }
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }, [visibleConversationId, hasUnread, onRead])
}
