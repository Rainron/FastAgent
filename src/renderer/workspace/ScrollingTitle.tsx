import { useEffect, useRef, useState } from 'react'
import { sidebarTitleScrollOffset } from '../../shared/sidebar-title'
import { motionEnabled } from '../motion'

/**
 * 侧栏里会被截断的标题：鼠标悬停在所在行时自右向左滚出剩下的部分，移开即回到开头。
 *
 * 用容器的 scrollLeft 而不是 transform：省略号靠的是容器的 text-overflow，
 * 换成内层元素位移就得放弃省略号，静止时反而看不出「后面还有」。
 */
export function ScrollingTitle({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [hovering, setHovering] = useState(false)

  // 悬停判定挂在整行上，不是只挂标题那几个字：鼠标停在时间、项目名那半边也算在读这一行。
  // 另外列表刷新会让行在光标底下重新挂载，这时 pointerenter 不会补发，得靠 :hover 自己补一次。
  useEffect(() => {
    const row = ref.current?.closest('.workspace-item, .project-conversation') ?? ref.current
    if (!row) return
    const enter = () => setHovering(true)
    const leave = () => setHovering(false)
    row.addEventListener('pointerenter', enter)
    row.addEventListener('pointerleave', leave)
    if (row.matches(':hover')) setHovering(true)
    return () => {
      row.removeEventListener('pointerenter', enter)
      row.removeEventListener('pointerleave', leave)
    }
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element || !hovering || !motionEnabled()) return
    // 先关掉省略号再量：省略号会一直占着右边缘，滚到底也总有几个字被它顶掉
    element.dataset.scrolling = 'true'
    let frame = 0
    let started = 0
    let overflow = 0
    const step = (now: number) => {
      if (!started) {
        started = now
        overflow = element.scrollWidth - element.clientWidth
        // 放得下就别动：一个像素的抖动比不滚更碍眼
        if (overflow <= 1) { delete element.dataset.scrolling; return }
      }
      element.scrollLeft = sidebarTitleScrollOffset(now - started, overflow)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame)
      delete element.dataset.scrolling
      element.scrollLeft = 0
    }
  }, [hovering, text])

  return <span ref={ref} className={className} title={text}>{text}</span>
}
