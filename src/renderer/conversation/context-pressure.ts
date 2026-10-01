import { compactionBudget, isAutoCompactionEnabled, resolveTriggerRatio } from '../../shared/context-policy'
import type { ContextPolicy } from '../../shared/types'

/**
 * 输入框上方的上下文压力提示。
 *
 * 设置里承诺过「关闭自动压缩后接近上限只提示」，但这条提示此前根本不存在，
 * 用户只能靠工具栏那个百分比自己发现。主流产品都把余量提示放在输入区旁边，这里对齐。
 */

/** 距离触发点还有多少余量就开始预告。太早会常驻噪音，太晚等于没提示。 */
export const NOTICE_HEADROOM = 0.08
/** 关闭自动压缩后的提醒线；再往上就只剩手动压缩这一条路。 */
export const DISABLED_WARNING_RATIO = 0.8
/** 无论开关如何，到这个水位都必须红色告警：再写下去就是上下文溢出。 */
export const CRITICAL_RATIO = 0.95

export type ContextPressureTone = 'notice' | 'warning' | 'danger'
export type ContextPressureLevel = 'normal' | ContextPressureTone

/**
 * 水位分级。上下文环的配色与输入框上方的提示条必须共用这一个判定：
 * 环按固定的 70/85/95 变色、提示条按阈值说话的话，用户看到的颜色和真正会发生的事对不上。
 */
export function contextPressureLevel(ratio: number, policy: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'> | null, contextWindow?: number): ContextPressureLevel {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'normal'
  if (ratio >= CRITICAL_RATIO) return 'danger'
  // 没有策略（会话还没选、设置未就绪）时退回「关闭」那套保守口径，只按绝对水位提示。
  if (!policy || !isAutoCompactionEnabled(policy)) return ratio >= DISABLED_WARNING_RATIO ? 'warning' : 'normal'
  return ratio >= effectiveTriggerRatio(policy, contextWindow) - NOTICE_HEADROOM ? 'notice' : 'normal'
}

/**
 * 提示里说的阈值必须是引擎真会用的那个：窗口偏小时换算会被下限夹住，
 * 照设定值预告「到 95% 才压」而实际 90% 就压了，用户只会觉得压缩时机随机。
 * 拿不到窗口时退回设定值——那种场景下也算不出夹取结果。
 */
function effectiveTriggerRatio(policy: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'>, contextWindow?: number): number {
  if (!contextWindow || !(contextWindow > 0)) return resolveTriggerRatio(policy)
  return compactionBudget(policy, contextWindow).effectiveTriggerRatio
}

export interface ContextPressure {
  tone: ContextPressureTone
  percent: number
  /** 未取整的占比，0–1。提示条的水位条按它画，用 percent 会在高位丢掉最后一格。 */
  ratio: number
  /** 自动压缩触发点占比，0–1；关闭自动压缩时为 null，水位条不画刻度。 */
  triggerRatio: number | null
  title: string
  detail: string
  /** 是否给出「立即压缩」按钮；关闭档与告警态都要给。 */
  showCompact: boolean
  /** 是否给出「压缩设置」入口，引导到设置页把自动压缩打开。 */
  showSettings: boolean
}

export interface ContextPressureInput {
  estimatedTokens: number
  contextWindow: number
  policy: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'>
  /** 正在压缩时输入框已有自己的状态文案，这里让位。 */
  compacting: boolean
}

export function contextPressure(input: ContextPressureInput): ContextPressure | null {
  if (input.compacting) return null
  if (!(input.contextWindow > 0) || !Number.isFinite(input.estimatedTokens) || input.estimatedTokens <= 0) return null
  const ratio = Math.min(1, input.estimatedTokens / input.contextWindow)
  const percent = Math.min(100, Math.round(ratio * 100))
  const enabled = isAutoCompactionEnabled(input.policy)
  const level = contextPressureLevel(ratio, input.policy, input.contextWindow)
  if (level === 'normal') return null
  const triggerRatio = effectiveTriggerRatio(input.policy, input.contextWindow)
  // 关闭自动压缩时没有触发点可言，水位条不该画一条不会发生的刻度。
  const markRatio = enabled ? triggerRatio : null

  if (level === 'danger') {
    return {
      tone: 'danger',
      percent,
      ratio,
      triggerRatio: markRatio,
      title: `上下文已用 ${percent}%`,
      detail: enabled
        ? '自动压缩没能把占用降下来，继续发送可能触发上下文溢出。建议立即压缩或换一个更大窗口的模型。'
        : '自动压缩已关闭，继续发送可能触发上下文溢出。',
      showCompact: true,
      showSettings: !enabled
    }
  }

  if (!enabled) {
    return {
      tone: 'warning',
      percent,
      ratio,
      triggerRatio: markRatio,
      title: `上下文已用 ${percent}%`,
      detail: '自动压缩已关闭，需要手动压缩才能腾出空间。',
      showCompact: true,
      showSettings: true
    }
  }

  if (ratio >= triggerRatio) {
    return {
      tone: 'notice',
      percent,
      ratio,
      triggerRatio: markRatio,
      title: `上下文已用 ${percent}%`,
      detail: '已越过触发阈值：有可压缩的旧回合时会自动压缩，最近几轮按设置保留不压。',
      showCompact: true,
      showSettings: false
    }
  }
  return {
    tone: 'notice',
    percent,
    ratio,
    triggerRatio: markRatio,
    title: `上下文已用 ${percent}%`,
    detail: `到 ${Math.round(triggerRatio * 100)}% 时会自动压缩旧回合。`,
    showCompact: false,
    showSettings: false
  }
}
