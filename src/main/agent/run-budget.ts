import type { ModelUsageAggregate, RunLimits } from '../../shared/types'

/**
 * 会话 token 预算。口径是「已记录的实际用量」——输入（含缓存读写）+ 输出，
 * 取自服务商返回的 usage，不做估算，也不换算成金额。
 *
 * 判定放在开跑之前：跑到一半才发现超预算，钱已经花了，拦不住任何东西。
 */
export interface BudgetVerdict {
  /** 超预算时为 false，此时不应开始新的一轮。 */
  allowed: boolean
  usedTokens: number
  budget: number | null
  /** 拒绝原因；allowed 为 true 时是空串。 */
  reason: string
}

export function usedTokensOf(session: Pick<ModelUsageAggregate, 'inputTokens' | 'outputTokens'>): number {
  return session.inputTokens + session.outputTokens
}

export function checkConversationBudget(session: Pick<ModelUsageAggregate, 'inputTokens' | 'outputTokens'>, limits: Pick<RunLimits, 'conversationTokenBudget'>): BudgetVerdict {
  const budget = limits.conversationTokenBudget
  const usedTokens = usedTokensOf(session)
  if (budget === null) return { allowed: true, usedTokens, budget: null, reason: '' }
  if (usedTokens < budget) return { allowed: true, usedTokens, budget, reason: '' }
  return {
    allowed: false,
    usedTokens,
    budget,
    reason: `该会话已用 ${usedTokens.toLocaleString('en-US')} token，达到设置的预算 ${budget.toLocaleString('en-US')}。可在设置里调高预算，或新建会话继续。`
  }
}
