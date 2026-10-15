import { useCallback, useLayoutEffect, useRef } from 'react'
import { animate } from 'motion/react'
import { MOTION_DURATIONS, MOTION_EASE, motionSeconds } from './tokens'
import { motionEnabled } from './runtime'

/**
 * 内容在原地变长 / 变短时的高度过渡（代码块「展开全部」、终端输出剩余行、截断的结果全文）。
 *
 * 这类切换不是挂载 / 卸载一块区域，而是同一个节点里内容换了，Collapse 套不上。
 * 做法与 scroll-anchor 同构：点击时先 capture() 量一次旧高度，DOM 提交后在 layout 阶段
 * 量新高度，用 Motion 从旧高度补间到新高度。
 *
 * 动画结束必须把内联 height 清掉：Motion 的命令式 animate 会把终值留在 inline style 上，
 * 不清的话内容再变（流式输出、窗口缩放）就会卡在那个写死的 px 上——这是原先用 WAAPI
 * （不碰 inline style）时天然没有的问题。
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
    animate(node, { height: [`${start}px`, `${end}px`] }, {
      duration: motionSeconds(duration),
      ease: MOTION_EASE,
      onComplete: () => node.style.removeProperty('height')
    })
  })
  const capture = useCallback(() => {
    from.current = ref.current ? ref.current.getBoundingClientRect().height : null
  }, [])
  return { ref, capture }
}
