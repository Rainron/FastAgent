import { useEffect, useState, type RefObject } from 'react'
import { headScrolledPast, STICKY_HEAD_HEIGHT } from '../sticky-head'

/**
 * 过程头滚出会话区顶部时返回 true，用来决定吸顶条出不出。
 * 用 IntersectionObserver 而不是监听 scroll：流式输出期间每帧都在滚，逐帧量几何太贵。
 * 顶部让出吸顶条的高度：头部一滑进条下面就该出条，不能等它完全滚出去。
 */
export function usePinnedHead(target: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    const node = target.current
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') {
      setPinned(false)
      return
    }
    const root = node.closest<HTMLElement>('.conversation-scroll')
    const observer = new IntersectionObserver(([entry]) => {
      const visibleTop = entry.rootBounds?.top ?? (root?.getBoundingClientRect().top ?? 0) + STICKY_HEAD_HEIGHT
      setPinned(!entry.isIntersecting && headScrolledPast(entry.boundingClientRect.bottom, visibleTop))
    }, { root, rootMargin: `-${STICKY_HEAD_HEIGHT}px 0px 0px 0px` })
    observer.observe(node)
    return () => observer.disconnect()
  }, [target, enabled])
  return pinned
}
