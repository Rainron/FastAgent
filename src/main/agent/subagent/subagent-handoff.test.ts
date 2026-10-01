import { describe, expect, it } from 'vitest'
import { formatHandoffForChain, parseSubAgentHandoff, truncateSubAgentOutput } from './subagent-handoff'
import { SUBAGENT_HANDOFF_PROMPT } from './subagent-config'
import { SUBAGENT_LIMITS } from './subagent-types'

describe('subagent handoff', () => {
  it('解析标准交接结构', () => {
    const result = parseSubAgentHandoff('## 目标\n检查\n## 已验证项\n- 类型通过\n## 未验证项\n- UI\n## 关键发现\n- 有风险\n## 关键决定\n- 保持现状\n## 建议\n- 增加测试\n## 剩余步骤\n- 复核')
    expect(result).toEqual({ goal: '检查', verified: ['类型通过'], unverified: ['UI'], findings: ['有风险'], decisions: ['保持现状'], recommendations: ['增加测试'], remainingSteps: ['复核'] })
  })

  it('限制输出长度', () => {
    const result = truncateSubAgentOutput('x'.repeat(100000))
    expect(result.truncated).toBe(true)
    expect(result.output.length).toBeGreaterThan(50000)
  })

  it('交接提示词的小节与解析器一一对应', () => {
    // 解析器认 `## 建议`，提示词却从没要求写这节，recommendations 因此恒为空数组
    const headings = ['目标', '已验证项', '未验证项', '关键发现', '关键决定', '建议', '剩余步骤']
    for (const heading of headings) expect(SUBAGENT_HANDOFF_PROMPT).toContain(`## ${heading}`)
  })

  it('链式上下文只带交接，且逐层设上限', () => {
    const handoff = parseSubAgentHandoff('## 目标\n检查\n## 关键发现\n- 有风险')
    const text = formatHandoffForChain(handoff)
    expect(text).toContain('## 目标')
    expect(text).toContain('有风险')

    const overflowing = formatHandoffForChain({
      ...handoff,
      findings: Array.from({ length: SUBAGENT_LIMITS.maxChainHandoffItems + 10 }, (_, index) => `发现${index}`),
      decisions: ['x'.repeat(SUBAGENT_LIMITS.maxChainHandoffItemCharacters + 500)]
    })
    expect(overflowing).not.toContain(`发现${SUBAGENT_LIMITS.maxChainHandoffItems}`)
    expect(overflowing).toContain('…')
    expect(overflowing.length).toBeLessThanOrEqual(SUBAGENT_LIMITS.maxChainHandoffCharacters + 200)
  })

  it('交接为空时不产生噪声前缀', () => {
    expect(formatHandoffForChain(undefined)).toBe('')
    expect(formatHandoffForChain(parseSubAgentHandoff(''))).toBe('')
  })
})
