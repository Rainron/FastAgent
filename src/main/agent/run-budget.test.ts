import { describe, expect, it } from 'vitest'
import { checkConversationBudget, usedTokensOf } from './run-budget'

const session = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens })

describe('usedTokensOf', () => {
  it('输入与输出相加；输入本身已含缓存读写', () => {
    expect(usedTokensOf(session(1000, 200))).toBe(1200)
  })
})

describe('checkConversationBudget', () => {
  it('没配预算时一律放行', () => {
    const verdict = checkConversationBudget(session(999_999, 0), { conversationTokenBudget: null })
    expect(verdict).toMatchObject({ allowed: true, budget: null, reason: '' })
  })

  it('未达预算放行', () => {
    expect(checkConversationBudget(session(500, 100), { conversationTokenBudget: 1000 }).allowed).toBe(true)
  })

  it('达到预算即拒绝，理由里给出实际用量与预算', () => {
    const verdict = checkConversationBudget(session(900, 100), { conversationTokenBudget: 1000 })
    expect(verdict.allowed).toBe(false)
    expect(verdict.usedTokens).toBe(1000)
    expect(verdict.reason).toContain('1,000')
    expect(verdict.reason).toContain('新建会话')
  })

  it('超出后同样拒绝，不因为超得多就换一套说法', () => {
    expect(checkConversationBudget(session(5000, 0), { conversationTokenBudget: 1000 }).allowed).toBe(false)
  })
})
