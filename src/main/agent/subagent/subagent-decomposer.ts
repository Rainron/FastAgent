import type { SubAgentTask } from './subagent-types'

export interface DecompositionDecision {
  shouldDelegate: boolean
  reason: string
  tasks: SubAgentTask[]
}

const WRITE_HINTS = /修改|写入|实现|重构|提交|删除|部署|最终决定|当前对话/i
const INDEPENDENT_HINTS = /分别|各自|并行|同时|调用链|测试覆盖|安全审查|性能分析|依赖关系/i

/** 只提出候选任务，不直接执行；最终是否委派仍由主 Agent 决定。 */
export function suggestReadOnlyDecomposition(prompt: string): DecompositionDecision {
  const value = prompt.trim()
  if (!value || WRITE_HINTS.test(value) || !INDEPENDENT_HINTS.test(value)) {
    return { shouldDelegate: false, reason: '任务不满足只读且独立的自动拆解条件。', tasks: [] }
  }
  const candidates: Array<[string, string, string]> = [
    ['scout', '代码结构侦察', `只读分析与该任务相关的文件、入口和调用链：${value}`],
    ['reviewer', '回归风险审查', `只读检查与该任务相关的测试覆盖、边界条件和回归风险：${value}`]
  ]
  return {
    shouldDelegate: true,
    reason: '任务包含可并行的只读调查维度，候选结果必须由主 Agent 复核。',
    tasks: candidates.map(([agentId, _name, goal], index) => ({ taskId: `suggested-${index + 1}`, agentId, goal, expectedOutput: agentId === 'reviewer' ? 'review' : 'findings' }))
  }
}
