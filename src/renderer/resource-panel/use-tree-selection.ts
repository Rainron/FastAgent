import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { marqueeHits, mergeSelection, rangeSelection, toggleSelection, type MarqueeRow, type TreeSelectionItem } from './tree-selection'

/** 框选时指针进入滚动区上下边缘这么多像素就自动滚动。 */
const MARQUEE_SCROLL_EDGE = 28
const MARQUEE_SCROLL_STEP = 12
/** 移动不到这个距离算点击：点空白处清空选择。 */
const MARQUEE_THRESHOLD = 4

/**
 * 资源树（Workspace / Artifacts）共用的多选：
 * - 按住右键上下拖（从行上或空白处都行）拉出选框，框到的行全部选中；Ctrl 按住则追加。
 *   左键留给拖动移动文件，所以选择走右键；右键不拖动时照常弹出右键菜单。
 * - 左键在空白处拖同样框选，在空白处单击清空选择；
 * - 行上 Ctrl/⌘ 点击切换单项、Shift 点击选连续范围；普通点击清空多选后照旧打开；
 * - Esc 清空。
 * 行必须带 data-tree-path / data-tree-kind，框选靠它们从 DOM 量出每行位置。
 * 多选只在本次面板生命周期内有效，不进持久化：重开面板还留着一批选中项，误删的风险大于便利。
 */
export function useTreeSelection(scrollRef: RefObject<HTMLDivElement | null>, activePath: string | null) {
  const [selection, setSelection] = useState<TreeSelectionItem[]>([])
  const [marquee, setMarquee] = useState<{ top: number; height: number } | null>(null)
  const anchorRef = useRef<string | null>(null)
  const dragRef = useRef<{ button: 0 | 2; startY: number; base: TreeSelectionItem[]; moved: boolean } | null>(null)
  // 右键拖选松手后，系统随后还会发一次 contextmenu（Windows 在松手时发），要吞掉，否则框完就弹菜单。
  const suppressMenuRef = useRef(false)
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const clear = useCallback(() => {
    setSelection([])
    anchorRef.current = null
  }, [])

  const paths = useMemo(() => new Set(selection.map((entry) => entry.path)), [selection])

  /** 行点击：选择手势返回后不再打开；普通点击清空多选再执行 fallback。 */
  function handleRowClick(event: React.MouseEvent, item: TreeSelectionItem, order: TreeSelectionItem[], fallback: () => void) {
    if (item.path !== '' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      // 第一次 Ctrl 点选时把当前打开的那一项一并带上，和系统文件管理器一致。
      const active = selection.length ? null : order.find((entry) => entry.path === activePath && entry.path !== item.path) ?? null
      setSelection((current) => toggleSelection(active ? [active] : current, item))
      anchorRef.current = item.path
      return
    }
    if (item.path !== '' && event.shiftKey) {
      event.preventDefault()
      setSelection(rangeSelection(order, anchorRef.current ?? activePath, item))
      if (anchorRef.current === null) anchorRef.current = item.path
      return
    }
    if (selection.length) setSelection([])
    anchorRef.current = item.path
    fallback()
  }

  /** 挂在滚动容器上：右键在任何位置、左键只在空白处（不在行、按钮上）按下时开始框选。 */
  function onScrollMouseDown(event: React.MouseEvent) {
    if (event.button !== 0 && event.button !== 2) return
    const host = scrollRef.current
    if (!host) return
    if (event.button === 0 && (event.target as HTMLElement).closest('[data-tree-path], button, a, input')) return
    const rect = host.getBoundingClientRect()
    // 点在滚动条上不算
    if (event.clientX >= rect.left + host.clientWidth) return
    // 左键在空白处按下要挡掉文字选择；右键不拦，没拖动时还要照常弹出右键菜单
    if (event.button === 0) event.preventDefault()
    dragRef.current = {
      button: event.button,
      startY: event.clientY - rect.top + host.scrollTop,
      base: event.ctrlKey || event.metaKey ? selectionRef.current : [],
      moved: false
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && selection.length) {
      event.stopPropagation()
      clear()
    }
  }

  // 监听挂在 window 上：指针移出面板时也能继续框选与自动滚动。
  useEffect(() => {
    const finish = (released: boolean) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setMarquee(null)
      if (drag.button === 2) {
        if (drag.moved) {
          suppressMenuRef.current = true
          // 松手点不在面板里时可能没有 contextmenu，标记要自己过期，不能吞掉下一次正常右键。
          window.setTimeout(() => { suppressMenuRef.current = false }, 300)
        }
        return
      }
      // 左键在空白处单击（没拖）：清空选择
      if (released && !drag.moved && !drag.base.length) clear()
    }
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      const host = scrollRef.current
      if (!drag || !host) return
      // 松手发生在窗口外时收不到 mouseup，按键状态是唯一可靠的结束信号。
      if (!(event.buttons & (drag.button === 2 ? 2 : 1))) { finish(false); return }
      const rect = host.getBoundingClientRect()
      if (event.clientY < rect.top + MARQUEE_SCROLL_EDGE) host.scrollTop -= MARQUEE_SCROLL_STEP
      else if (event.clientY > rect.bottom - MARQUEE_SCROLL_EDGE) host.scrollTop += MARQUEE_SCROLL_STEP
      const currentY = Math.max(0, Math.min(event.clientY - rect.top + host.scrollTop, host.scrollHeight))
      if (!drag.moved && Math.abs(currentY - drag.startY) < MARQUEE_THRESHOLD) return
      drag.moved = true
      const top = Math.min(drag.startY, currentY)
      const bottom = Math.max(drag.startY, currentY)
      setMarquee({ top, height: bottom - top })
      const rows: MarqueeRow[] = Array.from(host.querySelectorAll<HTMLElement>('[data-tree-path]')).map((element) => {
        const box = element.getBoundingClientRect()
        return {
          path: element.dataset.treePath ?? '',
          kind: element.dataset.treeKind === 'dir' ? 'dir' : 'file',
          top: box.top - rect.top + host.scrollTop,
          bottom: box.bottom - rect.top + host.scrollTop
        }
      })
      setSelection(mergeSelection(drag.base, marqueeHits(rows, top, bottom)))
    }
    const onUp = (event: MouseEvent) => {
      if (dragRef.current && event.button === dragRef.current.button) finish(true)
    }
    // 捕获阶段拦在 React 的根监听之前：行上的 onContextMenu 根本收不到这一次。
    const onContextMenu = (event: MouseEvent) => {
      if (!suppressMenuRef.current) return
      suppressMenuRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [scrollRef, clear])

  return { selection, setSelection, paths, marquee, clear, handleRowClick, onScrollMouseDown, onKeyDown }
}
