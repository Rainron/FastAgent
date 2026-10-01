import { useLayoutEffect, useRef, useState } from 'react'
import type { ConversationTurn } from '../../../shared/types'
import { nextFollowState, scrollNavAction, type ScrollNavAction } from '../../conversation/auto-scroll'

/** 头部吸顶阈值：只踩一次 setState，不随滚动条抖动。 */
const HEADER_STUCK_THRESHOLD = 6

function readScrollMetrics(node: HTMLDivElement) {
  return { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }
}

/**
 * 对话区滚动：贴底跟随、回到顶部/底部、头部吸顶。
 *
 * followRef 用 ref 而不是 state：滚动回调里读它，用 state 会让回调随每次滚动重新绑定。
 */
export function useConversationScroll(turns: ConversationTurn[], runId: string | null, selectedConversationId: string | null) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const [scrollNav, setScrollNav] = useState<ScrollNavAction>('none')
  const [headerStuck, setHeaderStuck] = useState(false)

  // 只在用户本来就贴着底部时才跟随，且用直接赋值而不是平滑滚动，否则流式输出会抖。
  // 内容长高也要重算按钮：不重算的话流式输出把用户挤离底部后按钮不会出现。
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    if (followRef.current) node.scrollTop = node.scrollHeight
    const stuckNow = node.scrollTop > HEADER_STUCK_THRESHOLD
    setHeaderStuck((current) => (current === stuckNow ? current : stuckNow))
    setScrollNav(scrollNavAction(readScrollMetrics(node), runId !== null))
  }, [turns, runId, selectedConversationId])

  function onConversationScroll() {
    const node = scrollRef.current
    if (!node) return
    const metrics = readScrollMetrics(node)
    followRef.current = nextFollowState(followRef.current, metrics)
    setScrollNav(scrollNavAction(metrics, runId !== null))
    const stuck = node.scrollTop > HEADER_STUCK_THRESHOLD
    setHeaderStuck((current) => (current === stuck ? current : stuck))
  }

  function jumpConversation(target: 'top' | 'bottom') {
    const node = scrollRef.current
    if (!node) return
    if (target === 'top') {
      // 回顶是用户主动跳走，顺手停掉跟随，免得流式输出立刻又把他拽回底部。
      followRef.current = false
      node.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      followRef.current = true
      node.scrollTop = node.scrollHeight
    }
    setScrollNav(scrollNavAction(readScrollMetrics(node), runId !== null))
  }

  return { scrollRef, followRef, scrollNav, headerStuck, onConversationScroll, jumpConversation }
}
