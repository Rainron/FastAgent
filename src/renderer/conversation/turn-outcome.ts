import type { RunKind } from './ExecutionTrace'
import { formatMessageTime } from './message-time'

export interface CancelledOutcome {
  /** 取消前已经跑过工具：结果还在，续跑有意义。 */
  hasWork: boolean
  /** 「继续执行」是往当前会话发一句续跑，只有最后一轮才接得上。 */
  canContinue: boolean
}

/**
 * 取消在出字之前时正文区是空的，用户看到的只有一行「已取消」，下一步只能自己去想。
 * 这种情况在正文位置给出下一步；有半截回答时回答本身和操作条已经在，不再加。
 */
export function cancelledOutcome(input: { kind: RunKind; answerText: string; hasWork: boolean; isLast: boolean }): CancelledOutcome | null {
  if (input.kind !== 'cancelled' || input.answerText.trim()) return null
  return { hasWork: input.hasWork, canContinue: input.hasWork && input.isLast }
}

/** 没有回答头可挂的回合（没出字就结束），「模型 · 时间」挪到收尾行，不能直接丢掉。 */
export function traceMetaLine(input: { kind: RunKind; answerText: string; modelName?: string; createdAt: string }, now?: Date): string | undefined {
  if (input.kind === 'working' || input.answerText.trim()) return undefined
  const parts = [input.modelName, formatMessageTime(input.createdAt, now)].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}
