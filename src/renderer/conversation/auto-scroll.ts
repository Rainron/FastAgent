/** 距底部多少像素内仍算「贴着底部」。 */
export const BOTTOM_THRESHOLD = 64

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function isNearBottom(metrics: ScrollMetrics, threshold = BOTTOM_THRESHOLD): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
}

/**
 * 用户往上翻就停止跟随，翻回底部再恢复。
 * 只在「原本贴底」时才继续跟随，避免流式输出把用户正在读的位置强行拉走。
 */
export function nextFollowState(currentlyFollowing: boolean, metrics: ScrollMetrics, threshold = BOTTOM_THRESHOLD): boolean {
  const nearBottom = isNearBottom(metrics, threshold)
  if (currentlyFollowing && !nearBottom) return false
  if (!currentlyFollowing && nearBottom) return true
  return currentlyFollowing
}

/** 离顶部超过这么多像素才值得给「回到顶部」，否则按钮会在短对话里白占地方。 */
export const TOP_THRESHOLD = 600

/** 单个按钮的四种形态：不显示 / 回到顶部 / 回到底部 / 回到最新消息。 */
export type ScrollNavAction = 'none' | 'top' | 'bottom' | 'latest'

/**
 * 同一个按钮按当前滚动位置切换语义，避免上下两个按钮同时常驻。
 * 优先照顾「看不到最新内容」这件事：离底部远就给向下的按钮，流式输出中措辞换成「回到最新消息」。
 */
export function scrollNavAction(metrics: ScrollMetrics, streaming: boolean, thresholds: { bottom?: number; top?: number } = {}): ScrollNavAction {
  const bottomThreshold = thresholds.bottom ?? BOTTOM_THRESHOLD
  const topThreshold = thresholds.top ?? TOP_THRESHOLD
  // 内容还没超出一屏，滚不动也就不需要导航。
  if (metrics.scrollHeight - metrics.clientHeight <= bottomThreshold) return 'none'
  if (!isNearBottom(metrics, bottomThreshold)) return streaming ? 'latest' : 'bottom'
  return metrics.scrollTop > topThreshold ? 'top' : 'none'
}
