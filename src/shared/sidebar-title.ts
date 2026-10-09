/**
 * 侧栏会话标题的显示长度与悬停滚动。
 *
 * 字数上限决定标题被裁到多宽，剩下的部分靠悬停时的横向滚动补齐，
 * 所以上下限要留足：太小一眼看不出是哪一个会话，太大就把侧栏撑成一堵字墙。
 */
export const SIDEBAR_TITLE_CHARS = {
  default: 18,
  min: 8,
  max: 40
} as const

/** 滚动速度：每秒多少像素。太快看不清，太慢等不及，按一行中文约 6 字/秒取的。 */
export const SIDEBAR_TITLE_SCROLL_SPEED = 90
/** 到两端各停一下，否则头尾一闪而过根本读不到。 */
export const SIDEBAR_TITLE_SCROLL_HOLD_MS = 600

export function clampSidebarTitleChars(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SIDEBAR_TITLE_CHARS.default
  return Math.min(Math.max(Math.round(value), SIDEBAR_TITLE_CHARS.min), SIDEBAR_TITLE_CHARS.max)
}

/**
 * 悬停滚动的当前位移。
 *
 * 时间线：先在开头停 hold，再匀速滚到尾部，在尾部停 hold，然后回到开头重来一轮。
 * 返回值是 scrollLeft 应该落在的位置。
 */
export function sidebarTitleScrollOffset(elapsedMs: number, overflowPx: number, options?: { speed?: number; holdMs?: number }): number {
  if (overflowPx <= 0) return 0
  const speed = options?.speed ?? SIDEBAR_TITLE_SCROLL_SPEED
  const hold = options?.holdMs ?? SIDEBAR_TITLE_SCROLL_HOLD_MS
  const travel = (overflowPx / speed) * 1000
  const cycle = hold + travel + hold
  const at = ((elapsedMs % cycle) + cycle) % cycle
  if (at < hold) return 0
  if (at < hold + travel) return overflowPx * ((at - hold) / travel)
  return overflowPx
}
