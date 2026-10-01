import { describe, expect, it } from 'vitest'
import { compactionSummaryLabel, contextHealthView } from './context-health-view'
import type { ContextPolicy } from '../../shared/types'

function policy(patch: Partial<ContextPolicy> = {}): ContextPolicy {
  return { conversationId: 'c1', strategy: 'auto', autoSummary: true, triggerRatio: null, keepRecentTurns: null, forceCompaction: false, inheritGlobal: true, ...patch }
}

describe('contextHealthView', () => {
  it('没有用量时不编造百分比', () => {
    const view = contextHealthView({ estimatedTokens: 0, contextWindow: 128_000, policy: policy() })
    expect(view).toMatchObject({ percent: 0, level: 'normal', triggerMark: null, remainingTokens: null })
    expect(view.headline).toContain('尚无用量')
  })

  it('窗口未知时同样按「无用量」处理', () => {
    expect(contextHealthView({ estimatedTokens: 50_000, contextWindow: 0, policy: policy() }).percent).toBe(0)
  })

  it('首屏直接回答还能用多少、到哪压缩', () => {
    const view = contextHealthView({ estimatedTokens: 100_000, contextWindow: 200_000, policy: policy() })
    // 均衡档 78% → 156k 触发，剩 56k
    expect(view).toMatchObject({ percent: 50, level: 'normal', triggerMark: 0.78, remainingTokens: 56_000 })
    expect(view.headline).toBe('还能用 56k · 到 156k 自动压缩')
  })

  it('越线后说明本轮结束就压', () => {
    const view = contextHealthView({ estimatedTokens: 170_000, contextWindow: 200_000, policy: policy() })
    expect(view).toMatchObject({ level: 'notice', remainingTokens: 0 })
    expect(view.headline).toContain('已越过 156k 触发线')
  })

  it('配色跟着生效阈值走，不是写死的 70/85/95', () => {
    // 触发点 60% 时，62% 就该进入提醒态；固定档位下这个水位还是「正常」
    expect(contextHealthView({ estimatedTokens: 62_000, contextWindow: 100_000, policy: policy({ triggerRatio: 0.6 }) }).level).toBe('notice')
    expect(contextHealthView({ estimatedTokens: 62_000, contextWindow: 100_000, policy: policy() }).level).toBe('normal')
  })

  it('换算被夹过时，刻度与余量按实际生效的触发点给', () => {
    // 窗口 20k、触发设 95%：预留量被下限夹到 2k，引擎实际 18k 就压。
    // 刻度照设定值画会和环的配色对不上——配色一直按夹过的那个判。
    const view = contextHealthView({ estimatedTokens: 10_000, contextWindow: 20_000, policy: policy({ triggerRatio: 0.95 }) })
    expect(view).toMatchObject({ triggerMark: 0.9, remainingTokens: 8_000 })
    expect(view.headline).toBe('还能用 8k · 到 18k 自动压缩')
  })

  it('关闭自动压缩时不画刻度，只报剩余窗口', () => {
    const view = contextHealthView({ estimatedTokens: 90_000, contextWindow: 100_000, policy: policy({ strategy: 'disabled', autoSummary: false }) })
    expect(view).toMatchObject({ level: 'warning', triggerMark: null, remainingTokens: null })
    expect(view.headline).toBe('还能用 10k · 自动压缩已关闭')
  })

  it('策略未就绪时退回保守口径，不当作已启用', () => {
    const view = contextHealthView({ estimatedTokens: 96_000, contextWindow: 100_000, policy: null })
    expect(view).toMatchObject({ level: 'danger', triggerMark: null })
  })
})

describe('compactionSummaryLabel', () => {
  it('没压过时不给可点入口的文案', () => {
    expect(compactionSummaryLabel(0, null)).toBe('尚未压缩')
  })

  it('时间不可解析时只报次数', () => {
    expect(compactionSummaryLabel(3, 'not-a-date')).toBe('已压缩 3 次')
    expect(compactionSummaryLabel(3, null)).toBe('已压缩 3 次')
  })

  it('带最近时间', () => {
    expect(compactionSummaryLabel(2, '2026-01-01T06:22:00.000Z')).toMatch(/^已压缩 2 次 · 最近 \d{2}:\d{2}$/)
  })
})
