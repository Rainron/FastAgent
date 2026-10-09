import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEventCallback } from '../use-event-callback'
import { minimapBars, minimapRatioFromPointer, minimapViewport, type MinimapMetrics, type MinimapSegment } from './minimap'
import type { MinimapBlock } from './minimap-content'

type MinimapBar = MinimapSegment

/** 预览距视口上下边的最小留白，避免贴边的段把浮层顶出屏幕。 */
const PREVIEW_EDGE = 60

interface PreviewState {
  /** 视口坐标，配合 position: fixed 使用 */
  top: number
  right: number
  label: string
}

/**
 * 对话缩略图：按每段内容在滚动内容里的真实占比排布，内部渲染等比缩小的真实文字。
 *
 * 文字不是硬塞进窄轨道的——缩影内层按正文宽度排版，再整体 `scale` 到轨道宽度，
 * 所以行长、段落和代码块的形态跟正文一致，只是小。直接用窄宽度排会变成每行几个字，认不出分布。
 */
export const ConversationMinimap = React.memo(function ConversationMinimap({ segments, metrics, onSeek }: {
  segments: MinimapSegment[]
  metrics: MinimapMetrics
  onSeek: (ratio: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const bars = useMemo(() => minimapBars(segments, metrics.scrollHeight), [segments, metrics.scrollHeight])
  const viewport = useMemo(() => minimapViewport(metrics), [metrics])

  /**
   * 预览位置按悬停段的真实矩形算成视口坐标。
   * 传引用恒定的回调：MinimapPages 是 memo 的，普通函数声明每次渲染都是新引用，memo 会当场失效。
   */
  const showPreview = useEventCallback((element: HTMLElement, label: string) => {
    const track = trackRef.current?.getBoundingClientRect()
    if (!track || !label) { setPreview(null); return }
    const rect = element.getBoundingClientRect()
    setPreview({
      top: Math.min(Math.max(rect.top + rect.height / 2, PREVIEW_EDGE), window.innerHeight - PREVIEW_EDGE),
      right: Math.max(window.innerWidth - track.left + 8, 8),
      label
    })
  })

  // 内容不足一屏时没有可跳的地方，画出来只会挡住正文。
  if (bars.length === 0 || metrics.clientHeight >= metrics.scrollHeight) return null

  function seekFromPointer(clientY: number) {
    const track = trackRef.current?.getBoundingClientRect()
    if (!track) return
    onSeek(minimapRatioFromPointer(clientY, track))
  }

  // 按下就跳，按住可以连续拖：跟代码编辑器的缩略图一致。取景框拖动走的也是这条路径。
  function startSeek(event: React.PointerEvent) {
    event.preventDefault()
    seekFromPointer(event.clientY)
    const move = (moveEvent: PointerEvent) => seekFromPointer(moveEvent.clientY)
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const lensBottom = viewport.top + viewport.height

  return <div
    className="conversation-minimap"
    ref={trackRef}
    onPointerDown={startSeek}
    onPointerLeave={() => setPreview(null)}
    aria-hidden="true"
  >
    <MinimapPages bars={bars} onHover={showPreview} />
    {/* 视口之外轻微淡化；取景框本身是淡填充 + 细描边，底下的文字缩影仍然透得出来 */}
    <span className="minimap-shade" style={{ top: 0, height: `${viewport.top * 100}%` }} />
    <span className="minimap-shade" style={{ top: `${lensBottom * 100}%`, height: `${(1 - lensBottom) * 100}%` }} />
    <span className="minimap-lens" style={{ top: `${viewport.top * 100}%`, height: `${viewport.height * 100}%` }} />
    {/*
      预览挂到 body 而不是留在轨道里：轨道自己是个层叠上下文（z-index + backdrop-filter），
      里面的元素再怎么抬 z-index 也超不过轨道那一层，会被对话区里 z-index 更高的浮层
      （消息菜单之类）压住，看上去就是浮层和正文互相透、阴影叠在一起。
    */}
    {preview && createPortal(
      <div className="minimap-preview" style={{ top: preview.top, right: preview.right }}>{preview.label}</div>,
      document.body
    )}
  </div>
})

/** 纵向补偿的夹紧范围：超出这个区间就是内容量与真实高度差太远，硬拉只会变形。 */
const MIN_FIT = 0.5
const MAX_FIT = 1.8

/**
 * 文字缩影层：只依赖 bars，滚动时引用不变，memo 直接挡住。
 * 不把它和取景框放在同一个组件里——取景框每帧都动，混在一起等于每帧重排全部文字。
 */
const MinimapPages = React.memo(function MinimapPages({ bars, onHover }: {
  bars: MinimapBar[]
  onHover: (element: HTMLElement, label: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  /**
   * 缩影按正文宽度排版，换行位置跟正文不同，等比缩完的高度不会正好等于实测段高——
   * 长的截断、短的留白，看着就是「对不齐」。这里按自然高度和可用高度的比值补一个纵向系数。
   *
   * 读写分三趟批处理：全部重置 → 全部量 → 全部写回。混着做会每段触发一次强制重排。
   * 只在 bars 变化时跑（已被上游节流到 240ms），滚动不触发。
   */
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const pages = Array.from(root.querySelectorAll<HTMLElement>('.minimap-page'))
    pages.forEach((page) => page.style.setProperty('--minimap-fit', '1'))
    const measured = pages.map((page) => ({
      page,
      natural: page.getBoundingClientRect().height,
      available: (page.parentElement as HTMLElement | null)?.clientHeight ?? 0
    }))
    for (const { page, natural, available } of measured) {
      if (natural <= 0 || available <= 0) continue
      const fit = Math.min(Math.max(available / natural, MIN_FIT), MAX_FIT)
      page.style.setProperty('--minimap-fit', fit.toFixed(3))
    }
  }, [bars])

  return <div className="minimap-pages" ref={rootRef}>{bars.map((bar) => (
    <div
      key={bar.id}
      className={`minimap-seg ${bar.role} ${bar.kind}`}
      // 高度收 1px 让相邻段之间留条缝；跳转取的是轨道比例，与这里的盒子无关，不影响落点。
      style={{ top: `${bar.top * 100}%`, height: `calc(${bar.height * 100}% - 1px)` }}
      onPointerEnter={(event) => onHover(event.currentTarget, bar.label)}
    >
      <div className="minimap-page">
        {bar.blocks.map((block, index) => <MinimapBlockView key={index} block={block} />)}
      </div>
    </div>
  ))}</div>
})

function MinimapBlockView({ block }: { block: MinimapBlock }) {
  if (block.kind === 'code') return <pre className="mm-code">{block.text}</pre>
  if (block.kind === 'heading') return <div className="mm-heading">{block.text}</div>
  if (block.kind === 'list') return <div className="mm-list">{block.text}</div>
  if (block.kind === 'quote') return <div className="mm-quote">{block.text}</div>
  return <p className="mm-para">{block.text}</p>
}
