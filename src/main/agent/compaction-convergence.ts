/**
 * 会话内压缩的收敛判定。
 *
 * Pi 在每次调模型之前判 `tokens > contextWindow - reserveTokens`，压完接着判。
 * 压缩本身也要烧一次模型调用，所以只要水位反复越线，一轮之内可以无限压下去。
 *
 * 实测 32768 窗口、触发点 20025 时一轮压了 22 次，形状是这样的：
 *
 *     29219 -> 17944    25808 -> 18236    26217 -> 17469 ...
 *
 * 注意每次都压到了触发点以下——**单看「有没有压下去」判不出问题**。真正的病根是
 * 落点（~18k）与触发点（20k）只差 2k：一个工具结果就又越线，于是压缩变成了空转。
 * 换算层保证不了这个余量，因为系统提示词与工具定义这类不可压内容既不进摘要也不进
 * 保留区预算，小窗口下它自己就吃掉了大半空间。
 *
 * 所以停手判定有三条，任意一条命中就停掉本轮自动压缩：
 * 1. 压完反而没变小——再压一百次也一样；
 * 2. 连续两次压完仍在触发点之上；
 * 3. 一轮内压缩次数超预算——专抓上面那种「次次成功却在空转」的抖动。
 */

export interface CompactionAttempt {
  /** 这次压缩前的上下文用量（provider usage 口径）。 */
  tokensBefore: number
  /** 压缩后重新测量的用量，与 tokensBefore 同口径。 */
  tokensAfter: number
}

export interface ConvergenceState {
  /** 连续几次压缩没能把水位压到触发点以下。 */
  consecutiveStalled: number
  /** 本轮已经压了几次。 */
  total: number
}

export const INITIAL_CONVERGENCE_STATE: ConvergenceState = { consecutiveStalled: 0, total: 0 }

/** 连续这么多次压不到触发点以下就判定为不收敛。1 次可能是估算抖动，2 次就是结构性的。 */
export const MAX_STALLED_COMPACTIONS = 2

/**
 * 一轮内允许的压缩次数上限。
 *
 * 配置健康时一轮压 0~2 次；压到 5 次以上说明落点与触发点之间的余量撑不住一次正常的
 * 工具调用，继续压只是在反复烧摘要调用。宁可停下来让用户换个窗口，也不要静默烧额度。
 */
export const MAX_COMPACTIONS_PER_RUN = 5

export type ConvergenceReason = 'no-progress' | 'still-over-threshold' | 'thrashing'

export interface ConvergenceVerdict {
  state: ConvergenceState
  /** 判定为不收敛：调用方应停掉本轮的自动压缩并给出可见提示。 */
  stalled: boolean
  reason?: ConvergenceReason
}

export interface ConvergenceLimits {
  maxStalled?: number
  maxPerRun?: number
}

/**
 * 记一次压缩结果并判定是否还要继续压。
 *
 * @param triggerTokens 触发点绝对量；未知（<=0）时不判「是否压到线下」，但次数上限照算——
 *                      空转与窗口是否已知无关。
 */
export function trackCompactionConvergence(
  state: ConvergenceState,
  attempt: CompactionAttempt,
  triggerTokens: number,
  limits: ConvergenceLimits = {}
): ConvergenceVerdict {
  const maxStalled = limits.maxStalled ?? MAX_STALLED_COMPACTIONS
  const maxPerRun = limits.maxPerRun ?? MAX_COMPACTIONS_PER_RUN
  const total = state.total + 1
  const measured = Number.isFinite(attempt.tokensBefore) && attempt.tokensBefore > 0
    && Number.isFinite(attempt.tokensAfter) && attempt.tokensAfter > 0

  // 压完反而没变小：再压一百次也是这个结果，不必等够次数。
  if (measured && attempt.tokensAfter >= attempt.tokensBefore) {
    return { state: { consecutiveStalled: state.consecutiveStalled + 1, total }, stalled: true, reason: 'no-progress' }
  }

  const overThreshold = measured && triggerTokens > 0 && attempt.tokensAfter > triggerTokens
  const consecutiveStalled = overThreshold ? state.consecutiveStalled + 1 : 0
  const next: ConvergenceState = { consecutiveStalled, total }

  if (overThreshold && consecutiveStalled >= maxStalled) return { state: next, stalled: true, reason: 'still-over-threshold' }
  // 次数上限最后判：前两条能说清「为什么压不动」，它只兜住「说不清但明显在空转」。
  if (total >= maxPerRun) return { state: next, stalled: true, reason: 'thrashing' }
  return { state: next, stalled: false }
}

/** 停手时给用户的说明。压缩已经救不了这条会话，只能换窗口、抬阈值或开新会话。 */
export function convergenceStalledDetail(reason: ConvergenceReason, ratio: number, total: number): string {
  const percent = Math.round(ratio * 100)
  if (reason === 'no-progress') {
    return `自动压缩没能减少上下文（仍占 ${percent}%），已停止本轮压缩：请换一个窗口更大的模型或开新会话。`
  }
  if (reason === 'still-over-threshold') {
    return `连续压缩都没能压到触发线以下（仍占 ${percent}%），已停止本轮压缩以免反复消耗额度：请换一个窗口更大的模型或开新会话。`
  }
  return `本轮已自动压缩 ${total} 次仍未稳定（当前占 ${percent}%），已停止本轮压缩以免反复消耗额度：压缩后的落点离触发阈值太近，请调高触发阈值、换更大窗口的模型或开新会话。`
}
