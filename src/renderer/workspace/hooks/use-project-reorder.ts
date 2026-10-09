import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { moveProjectId, readProjectOrder, sortDropIndex, writeProjectOrder } from '../project-order'

/** 按下后移动超过这个距离才算拖拽，否则仍是一次点击（展开/收起项目）。 */
const DRAG_THRESHOLD = 4
/** 指针贴近滚动容器上下边缘这么近时自动滚动，长列表才拖得到视口外的位置。 */
const AUTO_SCROLL_EDGE = 36
const AUTO_SCROLL_MAX_STEP = 12
/** 与 styles.css 里 .project-group 的让位过渡保持一致 */
const SETTLE_MS = 180

export interface ProjectDragState {
  id: string
  /** 被拖项目拖动前的下标 */
  from: number
  /** 插入到第几项之前，以拖动前的下标计 */
  dropIndex: number
}

/**
 * 侧栏工作区项目的按住拖拽排序：被拖的项目跟着指针走，其余项目实时让位，松手后落进空位。
 *
 * 用指针事件而不是 HTML5 拖放：项目行本身是按钮，原生拖放只给一张半透明截图、其他项不会让位，
 * 还会和「点一下展开」抢事件。这里按下不动就是点击，移动过阈值才进入拖拽，松开后吞掉紧随的那次 click。
 *
 * 跟手的位移直接写 DOM 的 transform，不走 React 状态：指针每动一下都重渲染整个侧栏太重。
 * 只有落点变化时才 setDrag，由渲染层给途经的项目挂让位的 class。
 *
 * 挪动基于列表里实际渲染的顺序（data-project-id），不另传 id 数组：显示顺序本身依赖这里的 order，
 * 由调用方再传回来会绕成循环。搜索过滤时列表不完整，调用方应传 enabled=false。
 */
export function useProjectReorder(enabled: boolean) {
  const [order, setOrder] = useState<string[]>(() => readProjectOrder(window.localStorage))
  const [drag, setDrag] = useState<ProjectDragState | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  // 松手时被拖项目的视觉位置；新顺序渲染后从这里平滑落进真实位置（FLIP），而不是瞬移
  const settleRef = useRef<{ id: string; top: number } | null>(null)

  useEffect(() => () => cleanupRef.current?.(), [])
  // 拖到一半开了搜索，列表不再完整，直接作废这次拖拽
  useEffect(() => { if (!enabled) cleanupRef.current?.() }, [enabled])

  useLayoutEffect(() => {
    const settle = settleRef.current
    settleRef.current = null
    const list = listRef.current
    if (!settle || !list) return
    const element = list.querySelector<HTMLElement>(`[data-project-id="${CSS.escape(settle.id)}"]`)
    if (!element) return
    const delta = settle.top - element.getBoundingClientRect().top
    element.style.transition = 'none'
    element.style.transform = `translateY(${delta}px)`
    element.classList.add('settling')
    void element.offsetHeight
    element.style.transition = ''
    element.style.transform = ''
    const timer = window.setTimeout(() => element.classList.remove('settling'), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [order])

  const onPointerDown = (event: React.PointerEvent, id: string) => {
    if (!enabled || event.button !== 0) return
    // 行尾的新建与菜单按钮保持原样，不从那里起拖
    if ((event.target as HTMLElement).closest('.item-new-chat, .item-actions')) return
    const list = listRef.current
    if (!list) return
    cleanupRef.current?.()
    const scroller = list.closest<HTMLElement>('.sidebar-scroll')
    const scrollTop = () => scroller?.scrollTop ?? 0
    const startY = event.clientY
    const startScroll = scrollTop()
    let started = false
    let pointerY = startY
    let frame = 0
    // 以下在拖拽开始那一刻量一次，之后都按「内容坐标」（视口坐标 + 滚动量）算，滚动时不失准
    let groups: HTMLElement[] = []
    let from = -1
    let centers: number[] = []
    let draggedCenter = 0
    let dropIndex = -1
    let dragged: HTMLElement | null = null

    const begin = () => {
      groups = Array.from(list.querySelectorAll<HTMLElement>('[data-project-id]'))
      from = groups.findIndex((group) => group.dataset.projectId === id)
      if (from < 0) return false
      dragged = groups[from]
      // 展开的项目会带一长串会话，只按项目行本身的中心比较，否则落点离指针很远
      centers = groups.map((group) => {
        const rect = ((group.firstElementChild as HTMLElement | null) ?? group).getBoundingClientRect()
        return rect.top + rect.height / 2 + startScroll
      })
      draggedCenter = centers[from]
      // 让位距离 = 被拖项目整组的高度加组间距，其余项正好空出它的位置
      const gap = groups.length > 1 ? parseFloat(getComputedStyle(groups[1]).marginTop) || 0 : 0
      list.style.setProperty('--reorder-shift', `${dragged.getBoundingClientRect().height + gap}px`)
      list.classList.add('reordering')
      document.body.classList.add('project-reordering')
      window.getSelection()?.removeAllRanges()
      dropIndex = from
      setDrag({ id, from, dropIndex })
      return true
    }
    const update = () => {
      const offset = pointerY - startY + (scrollTop() - startScroll)
      if (dragged) dragged.style.transform = `translateY(${offset}px)`
      const next = sortDropIndex(centers, from, draggedCenter + offset)
      if (next !== dropIndex) {
        dropIndex = next
        setDrag({ id, from, dropIndex })
      }
    }
    // 贴边时按距离加速滚动；用 rAF 循环而不是只在 pointermove 里滚，指针停在边上也能继续滚
    const autoScroll = () => {
      frame = 0
      if (!scroller || !started) return
      const rect = scroller.getBoundingClientRect()
      const depth = pointerY < rect.top + AUTO_SCROLL_EDGE ? pointerY - (rect.top + AUTO_SCROLL_EDGE)
        : pointerY > rect.bottom - AUTO_SCROLL_EDGE ? pointerY - (rect.bottom - AUTO_SCROLL_EDGE) : 0
      if (!depth) return
      const before = scroller.scrollTop
      scroller.scrollTop += Math.max(-AUTO_SCROLL_MAX_STEP, Math.min(AUTO_SCROLL_MAX_STEP, depth / 3))
      if (scroller.scrollTop !== before) update()
      frame = requestAnimationFrame(autoScroll)
    }
    const move = (moveEvent: PointerEvent) => {
      pointerY = moveEvent.clientY
      if (!started) {
        if (Math.abs(pointerY - startY) < DRAG_THRESHOLD) return
        if (!begin()) { cleanup(); return }
        started = true
      }
      moveEvent.preventDefault()
      update()
      if (!frame) frame = requestAnimationFrame(autoScroll)
    }
    const finish = (commit: boolean) => {
      const element = dragged
      if (!started || !element) { cleanup(); return }
      // 松开时浏览器会在同一个按钮上补发 click，不挡掉就会顺带把项目展开/收起
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
      const next = commit ? moveProjectId(groups.map((group) => group.dataset.projectId ?? ''), id, dropIndex) : null
      if (!next) {
        // 取消或落回原位：先挂上过渡再撤 transform，被拖项目沿动画回到原处，让位的项目同样滑回去
        element.classList.add('settling')
        cleanup(true)
        window.setTimeout(() => {
          element.classList.remove('settling')
          // 期间可能已经开始了下一次拖拽，那次自己挂着 reordering，不能被这里摘掉
          if (!cleanupRef.current) list.classList.remove('reordering')
        }, SETTLE_MS)
        return
      }
      settleRef.current = { id, top: element.getBoundingClientRect().top }
      // 让位的项目在新顺序里本来就处在目标位置，撤 transform 时不能再播一遍滑动
      list.classList.add('reorder-commit')
      requestAnimationFrame(() => requestAnimationFrame(() => list.classList.remove('reorder-commit')))
      cleanup()
      // 撤掉 transform 与新顺序必须在同一帧生效：这里是原生监听器，React 不会同步提交，
      // 中间漏画一帧就会看到列表先弹回旧顺序再跳到新顺序
      flushSync(() => setOrder(next))
      writeProjectOrder(window.localStorage, next)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const keydown = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') cancel() }
    const cleanup = (keepTransition = false) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', keydown)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (dragged) dragged.style.transform = ''
      // 取消时保留让位过渡，途经的项目要滑回原处；--reorder-shift 也得留到它们滑完
      if (!keepTransition) {
        list.classList.remove('reordering')
        list.style.removeProperty('--reorder-shift')
      }
      document.body.classList.remove('project-reordering')
      cleanupRef.current = null
      setDrag(null)
    }
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', keydown)
  }

  const onClickCapture = (event: React.MouseEvent) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return { order, drag, listRef, onPointerDown, onClickCapture }
}
