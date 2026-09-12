import { describe, expect, it } from 'vitest'
import { parseSubAgentHandoff, truncateSubAgentOutput } from './subagent-handoff'

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
})
