import { describe, expect, it } from 'vitest'
import { suggestReadOnlyDecomposition } from './subagent-decomposer'

describe('subagent decomposer', () => {
  it('只为独立只读调查提出候选', () => {
    const result = suggestReadOnlyDecomposition('分别分析调用链和测试覆盖')
    expect(result.shouldDelegate).toBe(true)
    expect(result.tasks.map((task) => task.agentId)).toEqual(['scout', 'reviewer'])
  })
  it('拒绝写入或模糊任务', () => {
    expect(suggestReadOnlyDecomposition('实现并提交功能').shouldDelegate).toBe(false)
    expect(suggestReadOnlyDecomposition('分析一下').tasks).toEqual([])
  })
})
