import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationTurn } from '../../../shared/types'
import { minimapScrollTarget, type MinimapKind, type MinimapMetrics, type MinimapSegment } from '../../conversation/minimap'
import { activityBlocks, minimapPreviewText, parseMinimapBlocks, type MinimapBlock } from '../../conversation/minimap-content'

const ENABLED_KEY = 'fastagent.conversation-minimap'
/** 重新量 DOM 的最小间隔：流式输出期间 turns 每帧都变，按帧量会把整棵树的布局顶起来。 */
const MEASURE_INTERVAL_MS = 240
/** 执行区窄于这个高度就不单独成段，避免制造一堆 1px 噪声段。 */
const MIN_ACTIVITY_HEIGHT = 12

function loadEnabled(): boolean {
  try { return window.localStorage.getItem(ENABLED_KEY) === '1' } catch { return false }
}

const EMPTY_METRICS: MinimapMetrics = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 }

function turnKind(turn: ConversationTurn): MinimapKind {
  if (turn.status === 'working') return 'working'
  if (turn.status === 'failed' || turn.status === 'cancelled' || turn.status === 'interrupted') return 'failed'
  return 'idle'
}

interface CachedContent {
  version: string
  blocks: MinimapBlock[]
  label: string
}

/**
 * 对话缩略图的测量、取文与跳转。
 *
 * 几何一律从真实 DOM 读（`data-turn-id` 与其中的 `.message.user` / `.message.assistant`），
 * 不按文本长度估——估出来点了跳不准，而跳不准正是这个功能唯一要解决的问题。
 * 文字按回合缓存，只有内容真的变了才重新解析；测量按时间节流；滚动只更新视口。
 */
export function useConversationMinimap(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  turns: ConversationTurn[],
  followRef: React.MutableRefObject<boolean>
) {
  const [enabled, setEnabled] = useState(loadEnabled)
  const [segments, setSegments] = useState<MinimapSegment[]>([])
  const [metrics, setMetrics] = useState<MinimapMetrics>(EMPTY_METRICS)
  const lastMeasuredAt = useRef(0)
  const measureTimer = useRef<number | null>(null)
  // 回合数据放 ref：测量函数要读它，但不该因为 turns 每帧变就重建函数、重挂监听。
  const turnsRef = useRef(turns)
  turnsRef.current = turns
  // 文字缓存：键是「回合 + 角色」，版本用长度与状态拼，流式输出下只有真的长了才重新解析。
  const contentCache = useRef(new Map<string, CachedContent>())

  const contentFor = useCallback((turn: ConversationTurn, role: 'user' | 'activity' | 'assistant'): CachedContent => {
    const key = `${turn.id}:${role}`
    const source = role === 'user' ? turn.userMessage.text : role === 'assistant' ? turn.assistantMessage?.text ?? '' : ''
    const version = role === 'activity'
      ? `${turn.activity?.events.length ?? 0}:${turn.status}`
      : `${source.length}:${turn.status}`
    const cached = contentCache.current.get(key)
    if (cached && cached.version === version) return cached
    const blocks = role === 'activity' ? activityBlocks(turn.activity?.events) : parseMinimapBlocks(source)
    const next: CachedContent = { version, blocks, label: minimapPreviewText(blocks) }
    contentCache.current.set(key, next)
    return next
  }, [])

  const measure = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    const containerTop = node.getBoundingClientRect().top
    const offset = node.scrollTop - containerTop
    const byId = new Map(turnsRef.current.map((turn) => [turn.id, turn]))
    const next: MinimapSegment[] = []
    const live = new Set<string>()

    node.querySelectorAll<HTMLElement>('[data-turn-id]').forEach((article) => {
      const turn = byId.get(article.dataset.turnId ?? '')
      if (!turn) return
      const kind = turnKind(turn)
      const userNode = article.querySelector<HTMLElement>(':scope > .message.user')
      const assistantNode = article.querySelector<HTMLElement>(':scope > .message.assistant')
      const add = (role: 'user' | 'activity' | 'assistant', top: number, height: number) => {
        if (height <= 0) return
        const content = contentFor(turn, role)
        const id = `${turn.id}:${role}`
        live.add(id)
        next.push({ id, top, height, role, kind, label: content.label, blocks: content.blocks })
      }

      const userRect = userNode?.getBoundingClientRect()
      const assistantRect = assistantNode?.getBoundingClientRect()
      if (userRect) add('user', userRect.top + offset, userRect.height)
      // 执行区没有独立容器，取提问段底边到回答段顶边这一截——轨迹卡、待办、中断横幅都在里面。
      if (userRect && assistantRect) {
        const gap = assistantRect.top - userRect.bottom
        if (gap >= MIN_ACTIVITY_HEIGHT) add('activity', userRect.bottom + offset, gap)
      }
      if (assistantRect) add('assistant', assistantRect.top + offset, assistantRect.height)
      // 回合结构异常（两段都没渲染出来）时退回整段，宁可粗一点也不要在图上留空洞。
      if (!userRect && !assistantRect) {
        const rect = article.getBoundingClientRect()
        add('assistant', rect.top + offset, rect.height)
      }
    })

    // 删掉已经不存在的回合的缓存，长会话里反复切换不会让 Map 无限涨。
    for (const key of contentCache.current.keys()) {
      if (!live.has(key)) contentCache.current.delete(key)
    }
    lastMeasuredAt.current = Date.now()
    setSegments(next)
    setMetrics({ scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight })
  }, [contentFor, scrollRef])

  // 关着的时候一次 DOM 都不读：这是主对话流，多一次 querySelectorAll 就多一次强制布局。
  useEffect(() => {
    if (!enabled) { setSegments([]); setMetrics(EMPTY_METRICS); contentCache.current.clear(); return }
    const elapsed = Date.now() - lastMeasuredAt.current
    if (elapsed >= MEASURE_INTERVAL_MS) { measure(); return }
    measureTimer.current = window.setTimeout(measure, MEASURE_INTERVAL_MS - elapsed)
    return () => { if (measureTimer.current !== null) window.clearTimeout(measureTimer.current) }
  }, [enabled, turns, measure])

  // 滚动只刷新视口指示块，不重新量几何也不重新取文；rAF 合并同一帧里的多次滚动事件。
  useEffect(() => {
    const node = scrollRef.current
    if (!enabled || !node) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setMetrics({ scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight })
      })
    }
    const onResize = () => measure()
    node.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      node.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [enabled, measure, scrollRef])

  const seek = useCallback((ratio: number) => {
    const node = scrollRef.current
    if (!node) return
    const current = { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }
    // 点缩略图是明确的「我要看别处」，停掉贴底跟随，否则流式输出下一帧就把人拽回底部。
    followRef.current = false
    node.scrollTop = minimapScrollTarget(ratio, current)
    setMetrics({ ...current, scrollTop: node.scrollTop })
  }, [followRef, scrollRef])

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current
      try { window.localStorage.setItem(ENABLED_KEY, next ? '1' : '0') } catch { /* 隐私模式下存不了，不影响本次会话 */ }
      return next
    })
  }, [])

  return { enabled, toggle, segments, metrics, seek }
}
