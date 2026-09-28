import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { findOccurrences, stepMatchIndex } from './find-in-text'

/** CSS Custom Highlight API 的运行时检测；不可用时退化为仅计数与跳转。 */
const HIGHLIGHT_SUPPORTED = typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights !== null

const ALL_HIGHLIGHT = 'find-matches'
const ACTIVE_HIGHLIGHT = 'find-match-active'

/** 流式输出期间 turns 每帧都在变，重扫描按这个节流间隔执行。 */
const RESCAN_INTERVAL = 300

export interface FindBarProps {
  open: boolean
  /** 每次按下 Ctrl+F 自增一次：已打开时重新聚焦并全选查找输入。 */
  request: number
  /** 查找范围：对话滚动容器，命中只统计该容器内已渲染的文本。 */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 内容信号（turns 引用）：变化时节流重扫，流式输出期间保持高亮新鲜。 */
  contentVersion: unknown
  /** 会话标识：切换会话后从第 1 个命中重新开始。 */
  scopeKey: string | null
  onClose: () => void
  /** 命中跳转前调用：宿主借此停掉「贴底跟随」，避免流式输出把视口拽回底部。 */
  onBeforeJump: () => void
}

/**
 * 对话分区的页内查找条（Ctrl+F）。
 * 命中用 CSS Custom Highlight API 铺底高亮，不改动消息组件的渲染树，
 * 流式输出每帧重建 DOM 也不会与 React 状态打架。
 */
export const FindBar = React.memo(function FindBar({ open, request, containerRef, contentVersion, scopeKey, onClose, onBeforeJump }: FindBarProps) {
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  // 命中与当前序号以 ref 为准：节流扫描与键盘导航都要读最新值，不能等下一次渲染。
  const matchesRef = useRef<Range[]>([])
  const activeIndexRef = useRef(0)
  const lastScanAtRef = useRef(0)
  const lastQueryRef = useRef<string | null>(null)
  const lastScopeRef = useRef<string | null>(scopeKey)
  const inputRef = useRef<HTMLInputElement>(null)

  function registerAll(ranges: Range[]) {
    if (HIGHLIGHT_SUPPORTED) CSS.highlights.set(ALL_HIGHLIGHT, new Highlight(...ranges))
  }

  function registerActive(ranges: Range[], index: number) {
    if (HIGHLIGHT_SUPPORTED) CSS.highlights.set(ACTIVE_HIGHLIGHT, new Highlight(...(ranges[index] ? [ranges[index]] : [])))
  }

  function clearRegisteredHighlights() {
    if (HIGHLIGHT_SUPPORTED) {
      CSS.highlights.delete(ALL_HIGHLIGHT)
      CSS.highlights.delete(ACTIVE_HIGHLIGHT)
    }
  }

  function jumpTo(index: number) {
    const range = matchesRef.current[index]
    if (!range) return
    onBeforeJump()
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' })
  }

  function goTo(delta: number) {
    const next = stepMatchIndex(activeIndexRef.current, delta, matchesRef.current.length)
    activeIndexRef.current = next
    setActiveIndex(next)
    registerActive(matchesRef.current, next)
    jumpTo(next)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      goTo(event.shiftKey ? -1 : 1)
    }
  }

  // 节流扫描：输入与内容变化共享同一条节流队列，流式输出期间按固定间隔重扫，
  // 不会因为 turns 每帧都变而一直把扫描推迟到流结束。
  useEffect(() => {
    if (!open) return
    void contentVersion
    const elapsed = Date.now() - lastScanAtRef.current
    const timer = window.setTimeout(() => {
      lastScanAtRef.current = Date.now()
      const container = containerRef.current
      const needle = query.trim()
      const ranges: Range[] = []
      if (container && needle) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
          for (const occurrence of findOccurrences(node.data, needle)) {
            const range = document.createRange()
            range.setStart(node, occurrence.start)
            range.setEnd(node, occurrence.end)
            ranges.push(range)
          }
        }
      }
      // 新查询或新会话从第 1 个命中开始；同内容的重扫只收敛越界序号，不打断用户当前浏览位置。
      const fresh = query !== lastQueryRef.current || scopeKey !== lastScopeRef.current
      lastQueryRef.current = query
      lastScopeRef.current = scopeKey
      const nextActive = fresh ? 0 : Math.min(activeIndexRef.current, Math.max(0, ranges.length - 1))
      matchesRef.current = ranges
      activeIndexRef.current = nextActive
      setActiveIndex(nextActive)
      setMatchCount(ranges.length)
      registerAll(ranges)
      registerActive(ranges, nextActive)
      if (fresh) jumpTo(nextActive)
    }, Math.max(0, RESCAN_INTERVAL - elapsed))
    return () => window.clearTimeout(timer)
    // 跳转与注册只读 ref 与稳定回调，不列依赖也不受闭包过期影响。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, scopeKey, contentVersion])

  // F3/F4 全局翻页：焦点不在查找输入上（比如点了消息正文）时也要能翻命中。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F3') { event.preventDefault(); goTo(1); return }
      if (event.key === 'F4') { event.preventDefault(); goTo(-1) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // goTo 只读 ref 与稳定回调，不必随重渲染重建监听。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 关闭即清高亮与命中缓存；重新打开视为新查询，从第 1 个命中开始。
  useEffect(() => {
    if (open) {
      lastQueryRef.current = null
      return
    }
    matchesRef.current = []
    clearRegisteredHighlights()
  }, [open])

  // 卸载兜底：组件随分区切走被移除时不能把高亮留在页面上。
  useEffect(() => clearRegisteredHighlights, [])

  // 打开与每次 Ctrl+F 都把焦点放回查找输入并全选，便于直接覆盖关键词。
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open, request])

  if (!open) return null
  const countLabel = matchCount > 0 ? `${activeIndex + 1} / ${matchCount}` : query.trim() ? '无匹配' : ''
  return <div className="find-bar" role="search">
    <input ref={inputRef} value={query} spellCheck={false} placeholder="在对话中查找" aria-label="在当前对话中查找" onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} />
    <span className="find-count">{countLabel}</span>
    <button className="icon-button" onClick={() => goTo(-1)} disabled={matchCount === 0} aria-label="上一个匹配" title="上一个（F4 / Shift+Enter）"><ChevronUp size={14} /></button>
    <button className="icon-button" onClick={() => goTo(1)} disabled={matchCount === 0} aria-label="下一个匹配" title="下一个（F3 / Enter）"><ChevronDown size={14} /></button>
    <button className="icon-button" onClick={onClose} aria-label="关闭查找" title="关闭（Esc）"><X size={14} /></button>
  </div>
})
