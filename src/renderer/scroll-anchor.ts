import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * 折叠时锁住锚点元素在视口里的位置。
 *
 * 展开区一收起，它上方的内容就少了一截，滚动容器的 scrollTop 不变意味着整页内容往上跳，
 * 用户点完「收起」还要自己把视线找回来。做法是折叠前量一次锚点相对滚动容器的位置，
 * DOM 提交后按位移把 scrollTop 补回去，锚点（通常就是被点的那个按钮）保持不动。
 */
function findScrollParent(node: HTMLElement): HTMLElement | null {
  for (let current = node.parentElement; current; current = current.parentElement) {
    const overflowY = getComputedStyle(current).overflowY
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue
    if (current.scrollHeight > current.clientHeight) return current
  }
  return null
}

/** 量出补偿量；两次测量都在同一个滚动容器的坐标系里做，不受窗口本身滚动影响。 */
function captureAnchor(node: HTMLElement | null): (() => void) | null {
  if (!node) return null
  const scroller = findScrollParent(node)
  if (!scroller) return null
  const before = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  return () => {
    // 锚点自己被卸载（比如展开区底部的「收起」按钮）时量出来的是 0，补偿只会把页面推得更远。
    if (!node.isConnected) return
    const after = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    const delta = after - before
    // 亚像素抖动不值得写一次 scrollTop：写了反而会打断浏览器自己的平滑滚动。
    if (Math.abs(delta) > 0.5) scroller.scrollTop += delta
  }
}

/**
 * 返回锚点 ref 与「本次交互要保位」的标记函数。
 * 在触发折叠的事件处理里先调 anchor()，再 setState；补偿在同一帧的 layout 阶段完成，不会闪。
 */
export function useScrollAnchor<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const restore = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const run = restore.current
    restore.current = null
    run?.()
  })
  const anchor = useCallback(() => { restore.current = captureAnchor(ref.current) }, [])
  return { ref, anchor }
}

/**
 * 收起一块长内容之前调用：块的开头已经滚出视口上沿（头部正吸顶显示）时，先把开头对齐到视口上沿。
 * 否则内容一收，吸顶的头部回到它原本的位置——视口上方很远的地方，用户点完收起眼前只剩后面的内容。
 * 对齐后头部仍在原来看到的位置，收起动画在它下方进行。开头本就在视口内时什么都不做。
 */
export function alignStartIfAbove(node: HTMLElement | null) {
  if (!node) return
  const scroller = findScrollParent(node)
  if (!scroller) return
  const offset = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  if (offset < -0.5) scroller.scrollTop += offset
}
