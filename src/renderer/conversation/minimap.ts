// 对话缩略图的纯逻辑：把量出来的回合几何换算成 0~1 的比例条，再把点击位置换算回 scrollTop。
// 不碰 DOM，也不碰 React——组件只负责把这里的结果画出来。

import type { MinimapBlock } from './minimap-content'

export type MinimapKind = 'idle' | 'working' | 'failed'
/** 一个回合在缩略图里拆成三段：提问、执行、回答。三段的几何都从真实 DOM 量，跳转才准。 */
export type MinimapRole = 'user' | 'activity' | 'assistant'

/** 一段内容在滚动内容里的真实位置，单位是像素。 */
export interface MinimapSegment {
  id: string
  top: number
  height: number
  role: MinimapRole
  kind: MinimapKind
  /** 悬停预览用的正常字号摘要 */
  label: string
  /** 缩影里要排版的真实文字 */
  blocks: MinimapBlock[]
}

export interface MinimapMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** 短段压到 1px 以下就看不见了，给一个下限；同时避免除零。 */
const MIN_BAR_RATIO = 0.004

/**
 * 几何 → 比例条。按 scrollHeight 归一化，这样缩略图高度变化时不用重新量 DOM。
 * scrollHeight 非正数（内容还没渲染）时返回空数组，调用方据此不渲染。
 * 泛型透传：除 top/height 外的字段（角色、文字块）原样带过去，这里不认识它们。
 */
export function minimapBars<T extends { id: string; top: number; height: number }>(segments: T[], scrollHeight: number): T[] {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return []
  return segments.map((segment) => {
    const top = clampRatio(segment.top / scrollHeight)
    const height = Math.max(MIN_BAR_RATIO, clampRatio(segment.height / scrollHeight))
    return { ...segment, top: Math.min(top, 1 - height), height }
  })
}

/** 视口指示块：内容不足一屏时占满，表示「没得滚」。 */
export function minimapViewport(metrics: MinimapMetrics): { top: number; height: number } {
  const { scrollTop, scrollHeight, clientHeight } = metrics
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0 || clientHeight >= scrollHeight) return { top: 0, height: 1 }
  const height = clampRatio(clientHeight / scrollHeight)
  return { top: Math.min(clampRatio(scrollTop / scrollHeight), 1 - height), height }
}

/**
 * 点击/拖动缩略图 → 目标 scrollTop。点哪儿就把哪儿放到视口中间，
 * 而不是让它落在视口顶端——用户点的是「我想看这一块」，不是「从这里开始」。
 */
export function minimapScrollTarget(ratio: number, metrics: MinimapMetrics): number {
  const { scrollHeight, clientHeight } = metrics
  const max = Math.max(0, scrollHeight - clientHeight)
  if (max <= 0) return 0
  const target = clampRatio(ratio) * scrollHeight - clientHeight / 2
  return Math.min(Math.max(Math.round(target), 0), Math.round(max))
}

/** 指针在缩略图轨道内的位置 → 0~1；超出轨道时贴边，拖到容器外不会跳。 */
export function minimapRatioFromPointer(clientY: number, track: { top: number; height: number }): number {
  if (track.height <= 0) return 0
  return clampRatio((clientY - track.top) / track.height)
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}
