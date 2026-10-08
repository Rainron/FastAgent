import { useCallback, useLayoutEffect, useRef } from 'react'
import { MOTION_DURATIONS, MOTION_EASING, motionEnabled } from './motion'

/**
 * 内容在原地变长 / 变短时的高度过渡（代码块「展开全部」、终端输出剩余行、截断的结果全文）。
 *
 * 这类切换不是挂载 / 卸载一块区域，而是同一个节点里内容换了，Collapse 套不上。
 * 做法与 scroll-anchor 同构：点击时先 capture() 量一次旧高度，DOM 提交后在 layout 阶段
 * 量新高度，用 Web Animations 从旧高度补间到新高度。不写任何内联样式，动画结束即回到自然高度，
 * 期间内容再变（流式输出）也不会卡在某个写死的 px 上。
 * 没有 capture 的渲染只读一个 ref，流式重渲染时没有额外测量。
 */
export function useHeightAnimation<T extends HTMLElement>(duration: number = MOTION_DURATIONS.expand) {
  const ref = useRef<T>(null)
  const from = useRef<number | null>(null)
  useLayoutEffect(() => {
    const start = from.current
    if (start === null) return
    from.current = null
    const node = ref.current
    if (!node || !motionEnabled()) return
    const end = node.getBoundingClientRect().height
    if (Math.abs(end - start) < 1) return
    node.animate(
      [{ height: `${start}px`, overflow: 'hidden' }, { height: `${end}px`, overflow: 'hidden' }],
      { duration, easing: MOTION_EASING }
    )
  })
  const capture = useCallback(() => {
    from.current = ref.current ? ref.current.getBoundingClientRect().height : null
  }, [])
  return { ref, capture }
}
