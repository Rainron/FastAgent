import type { RunStatusTone } from '../run-status'

/**
 * 侧栏状态标记的性质。所有标记都画在行尾、与操作菜单同一个位置，悬停时让位给菜单：
 * 行首要留给标题对齐与项目树的竖线，状态点插在那里会压在树线上、跑出选中底色之外。
 *
 * progress 是「正在发生」（运行中、等你处理），unread 是「有结果还没看」（完成、失败、中断），
 * 后者额外把标题加粗，扫一眼就能分出哪些有新结果。
 */
export type RunMarkKind = 'progress' | 'unread' | null

export function runMarkKind(tone: RunStatusTone | undefined | null): RunMarkKind {
  if (!tone) return null
  return tone === 'running' || tone === 'waiting' ? 'progress' : 'unread'
}

/**
 * 状态标记画成什么。颜色之外必须再有一层形状区分（WCAG 1.4.1）：
 * 运行中是转圈，等你处理是带感叹号的琥珀点，失败是带感叹号的红圈，其余结果是一枚圆点。
 */
export type RunMarkGlyph = 'spinner' | 'attention' | 'alert' | 'dot'

export function runMarkGlyph(tone: RunStatusTone): RunMarkGlyph {
  if (tone === 'running') return 'spinner'
  if (tone === 'waiting') return 'attention'
  if (tone === 'failed') return 'alert'
  return 'dot'
}
