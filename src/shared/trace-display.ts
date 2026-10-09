import type { TraceDisplaySettings, TraceLabelStyle, TraceTimerPlacement } from './types'

export const MIN_TRACE_EXCERPT_LINES = 3
export const MAX_TRACE_EXCERPT_LINES = 200

/** 默认对齐参考稿：用时落在轨迹底部，文案用中文，读图与读文件展开即见内容。 */
export const DEFAULT_TRACE_DISPLAY: TraceDisplaySettings = {
  timerPlacement: 'bottom',
  labelStyle: 'zh',
  showTokens: true,
  showDiffStats: true,
  flatToolArgs: true,
  inlineImagePreview: true,
  textExcerpt: true,
  textExcerptLines: 20,
  // 默认关：轨迹里的文件名点开会顶掉右侧正在看的东西，想要的人自己开。
  openFileFromTrace: false
}

const TIMER_PLACEMENTS: TraceTimerPlacement[] = ['bottom', 'top', 'both']
const LABEL_STYLES: TraceLabelStyle[] = ['zh', 'en', 'compact']

export function normalizeTraceDisplay(input: Partial<TraceDisplaySettings> | undefined): TraceDisplaySettings {
  const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback
  const lines = input?.textExcerptLines
  return {
    timerPlacement: input?.timerPlacement && TIMER_PLACEMENTS.includes(input.timerPlacement) ? input.timerPlacement : DEFAULT_TRACE_DISPLAY.timerPlacement,
    labelStyle: input?.labelStyle && LABEL_STYLES.includes(input.labelStyle) ? input.labelStyle : DEFAULT_TRACE_DISPLAY.labelStyle,
    showTokens: bool(input?.showTokens, DEFAULT_TRACE_DISPLAY.showTokens),
    showDiffStats: bool(input?.showDiffStats, DEFAULT_TRACE_DISPLAY.showDiffStats),
    flatToolArgs: bool(input?.flatToolArgs, DEFAULT_TRACE_DISPLAY.flatToolArgs),
    inlineImagePreview: bool(input?.inlineImagePreview, DEFAULT_TRACE_DISPLAY.inlineImagePreview),
    textExcerpt: bool(input?.textExcerpt, DEFAULT_TRACE_DISPLAY.textExcerpt),
    textExcerptLines: typeof lines === 'number' && Number.isFinite(lines)
      ? Math.min(MAX_TRACE_EXCERPT_LINES, Math.max(MIN_TRACE_EXCERPT_LINES, Math.round(lines)))
      : DEFAULT_TRACE_DISPLAY.textExcerptLines,
    openFileFromTrace: bool(input?.openFileFromTrace, DEFAULT_TRACE_DISPLAY.openFileFromTrace)
  }
}

/**
 * token 数按千位/百万位收敛：轨迹底栏是一行状态，写满六位数字会把用时挤走。
 * 长任务的回合累计很容易破百万（每次请求都要把上下文重发一遍），到了那个量级必须进位成 M，
 * 否则会出现 `32755k` 这种没人读得出量级的数字。
 */
export function formatTokenCount(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0'
  if (total < 1000) return String(Math.round(total))
  if (total < 1_000_000) {
    const thousands = total / 1000
    return thousands < 100 ? `${Math.round(thousands * 10) / 10}k` : `${Math.round(thousands)}k`
  }
  const millions = total / 1_000_000
  return millions < 100 ? `${Math.round(millions * 10) / 10}M` : `${Math.round(millions)}M`
}
