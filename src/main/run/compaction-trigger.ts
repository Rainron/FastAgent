import { compactionBudget, isAutoCompactionEnabled } from '../../shared/context-policy'
import type { AgentEvent, ContextPolicy, ModelCredentials } from '../../shared/types'
import type { ContextMeasurement } from '../context-meter'
import type { RunContext } from './context'

export interface CompactionTriggerInput {
  policy: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'>
  estimatedTokens: number
  contextWindow: number
  /** 模型单次输出上限，摘要预算按它估；只影响压缩后的落点，不影响触发点。 */
  maxTokens?: number | null
  /** Pi 已经在这一轮内压过；再压一次只会白烧一次摘要调用。 */
  runtimeCompacted: boolean
  /** 已有压缩在跑（手动触发或上一轮的兜底还没结束）。 */
  compactionInFlight: boolean
}

export type CompactionTriggerDecision =
  | { compact: false; reason: 'disabled' | 'unknown-window' | 'below-threshold' | 'already-compacted' | 'in-flight' }
  | { compact: true; ratio: number; triggerTokens: number }

/**
 * 一轮结束后要不要由桌面侧补一次压缩。
 *
 * Pi 自己的阈值判定发生在「发下一条之前」与「一轮内准备下一次回答之前」，
 * 并且依赖可信的 provider usage：刚压过、usage 全零、本轮就一次模型调用等情况下都会静默跳过。
 * 那样会话会一直停在高水位，直到下次发送才可能压缩，长任务则直接撞上下文溢出。
 */
export function shouldCompactAfterRun(input: CompactionTriggerInput): CompactionTriggerDecision {
  if (!isAutoCompactionEnabled(input.policy)) return { compact: false, reason: 'disabled' }
  if (input.runtimeCompacted) return { compact: false, reason: 'already-compacted' }
  if (input.compactionInFlight) return { compact: false, reason: 'in-flight' }
  if (!(input.contextWindow > 0) || !Number.isFinite(input.estimatedTokens) || input.estimatedTokens <= 0) {
    return { compact: false, reason: 'unknown-window' }
  }
  // 判定口径必须和 Pi 逐字一致（`tokens > contextWindow - reserveTokens`，严格大于）：
  // 这里按占比判、那边按夹过的绝对量判，会出现「Pi 不压桌面压」的来回抖动。
  const { triggerTokens } = compactionBudget(input.policy, input.contextWindow, input.maxTokens)
  if (input.estimatedTokens <= triggerTokens) return { compact: false, reason: 'below-threshold' }
  return { compact: true, ratio: input.estimatedTokens / input.contextWindow, triggerTokens }
}

export interface OverThresholdReading {
  over: boolean
  ratio: number
  triggerTokens: number
}

/**
 * 「压完之后仍在触发点之上」。常规压缩返回 null、或 Pi 本轮压过却没把水位降下来时，
 * 都靠它判定还要不要继续动手；判定口径与 shouldCompactAfterRun 同一份换算。
 */
export function readOverThreshold(
  policy: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'>,
  measurement: Pick<ContextMeasurement, 'estimatedTokens' | 'contextWindow'> | undefined,
  maxTokens?: number | null
): OverThresholdReading {
  if (!measurement || !(measurement.contextWindow > 0) || !Number.isFinite(measurement.estimatedTokens) || measurement.estimatedTokens <= 0) {
    return { over: false, ratio: 0, triggerTokens: 0 }
  }
  const { triggerTokens } = compactionBudget(policy, measurement.contextWindow, maxTokens)
  return {
    over: measurement.estimatedTokens > triggerTokens,
    ratio: measurement.estimatedTokens / measurement.contextWindow,
    triggerTokens
  }
}

/** 压不动时的收尾文案：开没开强压，能给的下一步不一样。 */
export function stuckDetail(ratio: number, forceEnabled: boolean): string {
  const percent = Math.round(ratio * 100)
  return forceEnabled
    ? `上下文已达 ${percent}%，强制压缩也没有可压缩内容：请开新会话，或换一个窗口更大的模型。`
    : `上下文已达 ${percent}%，但保留区之外已无可压缩内容：可在「设置 › 上下文压缩 › 高级设置」打开「压不动时强制压缩」，或手动压缩、开新会话、换更大窗口的模型。`
}

/**
 * 兜底压缩的编排：判定、执行、强压降级、失败提示。
 * 压缩失败绝不能把已经跑完的这一轮变成失败——回答已经交付给用户了，
 * 这里最多给一条提示，让用户知道上下文仍然是满的。
 */
export async function compactIfOverThreshold(options: {
  ctx: RunContext
  namespace: string
  conversationId: string
  policy: ContextPolicy
  credentials: ModelCredentials
  measurement: ContextMeasurement | undefined
  runtimeCompacted: boolean
  emit: (event: Omit<AgentEvent, 'runId'>) => void
}): Promise<{ compacted: boolean }> {
  const { ctx, namespace, conversationId, measurement, policy } = options
  const force = policy.forceCompaction
  const warn = (detail: string) => options.emit({ type: 'run_phase', phase: 'compacting', status: 'failed', detail })

  /**
   * 强压：常规压缩已经证明压不动了才走。收缩保留区重压，仍不行转按回合摘要重开 session。
   * 见 index.ts 的 forceCompactConversation。
   */
  const escalate = async (ratio: number): Promise<{ compacted: boolean }> => {
    console.info('[compaction] 常规压缩压不动，转强制压缩', { conversationId, ratio: Number(ratio.toFixed(3)) })
    options.emit({ type: 'run_phase', phase: 'compacting', detail: '常规压缩没能腾出空间，正在强制压缩', status: 'running' })
    try {
      const forced = await ctx.forceCompactConversation(namespace, conversationId, options.credentials)
      if (forced) {
        options.emit({ type: 'compactionCompleted', context: forced.context, compaction: forced.compaction, detail: '强制压缩完成', status: 'completed' })
        return { compacted: true }
      }
      console.warn('[compaction] 强制压缩仍无可压缩内容', { conversationId })
      warn(stuckDetail(ratio, true))
      return { compacted: false }
    } catch (error) {
      console.error('[compaction] 强制压缩失败:', error)
      warn(`上下文已达 ${Math.round(ratio * 100)}%，强制压缩未成功：${error instanceof Error ? error.message : '压缩调用失败'}`)
      return { compacted: false }
    }
  }

  const decision = shouldCompactAfterRun({
    policy,
    estimatedTokens: measurement?.estimatedTokens ?? 0,
    contextWindow: measurement?.contextWindow ?? 0,
    maxTokens: options.credentials.max_tokens,
    runtimeCompacted: options.runtimeCompacted,
    compactionInFlight: ctx.activeCompactions.has(`${namespace}:${conversationId}`)
  })
  if (!decision.compact) {
    // Pi 本轮压过就不再叠加一次桌面压缩（只会白烧一次摘要调用），但「压过」不等于「压下去了」：
    // 保留区本身就接近窗口时，压完仍可能停在红线上。这条路径此前完全无声，
    // 用户看到的就是「一直 99%，压缩却说自己成功了」。
    if (decision.reason === 'already-compacted') {
      const reading = readOverThreshold(policy, measurement, options.credentials.max_tokens)
      if (reading.over) {
        console.warn('[compaction] 会话内压缩后仍高于触发点', { conversationId, ratio: Number(reading.ratio.toFixed(3)), triggerTokens: reading.triggerTokens })
        if (force) return escalate(reading.ratio)
        warn(`本轮已自动压缩，但上下文仍占 ${Math.round(reading.ratio * 100)}%：可在「设置 › 上下文压缩 › 高级设置」打开「压不动时强制压缩」，或手动压缩、开新会话、换更大窗口的模型。`)
      }
    }
    return { compacted: false }
  }
  console.info('[compaction] 桌面侧阈值兜底触发', { conversationId, ratio: Number(decision.ratio.toFixed(3)), triggerTokens: decision.triggerTokens })
  try {
    const result = await ctx.compactConversation(namespace, conversationId, 'threshold-desktop', options.credentials)
    // 没有可压缩内容时 Pi 与回合切分都返回 null。这不是错误，但在高水位上它意味着
    // 「常规压缩这条路已经走不通了」——保留区之外没东西可摘要，再等下去只会撞上溢出。
    if (!result) {
      console.warn('[compaction] 越过阈值但没有可压缩内容', { conversationId, ratio: Number(decision.ratio.toFixed(3)) })
      if (force) return escalate(decision.ratio)
      warn(stuckDetail(decision.ratio, false))
    }
    return { compacted: Boolean(result) }
  } catch (error) {
    console.error('[compaction] 阈值兜底压缩失败:', error)
    warn(`上下文已达 ${Math.round(decision.ratio * 100)}%，自动压缩未成功：${error instanceof Error ? error.message : '压缩调用失败'}`)
    return { compacted: false }
  }
}
