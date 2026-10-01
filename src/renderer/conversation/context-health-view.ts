import { compactionBudget, isAutoCompactionEnabled, resolveTriggerRatio } from '../../shared/context-policy'
import type { ContextPolicy } from '../../shared/types'
import { contextPressureLevel, type ContextPressureLevel } from './context-pressure'

/**
 * 上下文环与其浮层的展示口径。
 *
 * 这个控件只回答一个问题：「我还能聊多久」。配色、刻度、首屏文案全部由生效阈值决定，
 * 不再用写死的 70/85/95——那套数字和用户设的触发点毫无关系。
 */

export interface ContextHealthViewInput {
  estimatedTokens: number
  contextWindow: number
  policy: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'> | null
}

export interface ContextHealthView {
  ratio: number
  percent: number
  level: ContextPressureLevel
  /** 环上的阈值刻度位置（0–1）；关闭自动压缩或数据不全时为 null，不画刻度。 */
  triggerMark: number | null
  /** 距离触发点还剩多少 token；已越线为 0，未启用为 null。 */
  remainingTokens: number | null
  /** 浮层首屏那一行：一句话说明当前状态与下一步会发生什么。 */
  headline: string
}

function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

export function contextHealthView(input: ContextHealthViewInput): ContextHealthView {
  const usable = input.contextWindow > 0 && Number.isFinite(input.estimatedTokens) && input.estimatedTokens > 0
  const ratio = usable ? Math.min(1, Math.max(0, input.estimatedTokens / input.contextWindow)) : 0
  const percent = Math.round(ratio * 100)
  const level = contextPressureLevel(ratio, input.policy, input.contextWindow)
  const enabled = Boolean(input.policy) && isAutoCompactionEnabled(input.policy!)

  if (!usable) {
    return { ratio: 0, percent: 0, level: 'normal', triggerMark: null, remainingTokens: null, headline: '尚无用量；收到模型返回后更新' }
  }
  if (!enabled) {
    return {
      ratio,
      percent,
      level,
      triggerMark: null,
      remainingTokens: null,
      headline: `还能用 ${formatTokens(input.contextWindow - input.estimatedTokens)} · 自动压缩已关闭`
    }
  }
  // 刻度与余量必须用换算并夹过之后的触发点：环的配色（contextPressureLevel）已经按它判，
  // 这里再按设定值画，会出现「环变色了但刻度还在前面」这种自相矛盾的显示。
  const budget = compactionBudget(input.policy!, input.contextWindow)
  const triggerRatio = budget.triggerTokens > 0 ? budget.effectiveTriggerRatio : resolveTriggerRatio(input.policy!)
  const triggerTokens = budget.triggerTokens > 0 ? budget.triggerTokens : Math.round(input.contextWindow * triggerRatio)
  const remainingTokens = Math.max(0, triggerTokens - input.estimatedTokens)
  return {
    ratio,
    percent,
    level,
    // 刻度超出环一圈就没有意义了：阈值恒在 0–1 之间，这里只做防御性裁剪。
    triggerMark: Math.min(1, Math.max(0, triggerRatio)),
    remainingTokens,
    headline: remainingTokens > 0
      ? `还能用 ${formatTokens(remainingTokens)} · 到 ${formatTokens(triggerTokens)} 自动压缩`
      : `已越过 ${formatTokens(triggerTokens)} 触发线 · 本轮结束后自动压缩`
  }
}

/** 压缩计数那一行；从没压过时不给可点入口，点开只会是空列表。 */
export function compactionSummaryLabel(count: number, latestAt: string | null | undefined): string {
  if (!count) return '尚未压缩'
  if (!latestAt) return `已压缩 ${count} 次`
  const parsed = Date.parse(latestAt)
  if (Number.isNaN(parsed)) return `已压缩 ${count} 次`
  return `已压缩 ${count} 次 · 最近 ${new Date(parsed).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}
