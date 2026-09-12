import { describe, expect, it } from 'vitest'
import { createSubAgentTool } from './subagent'
import type { SubAgentConfig, SubAgentResult } from '../subagent/subagent-types'
import type { ScheduledSubAgentTask } from '../subagent/subagent-scheduler'

function completed(task: ScheduledSubAgentTask): SubAgentResult {
  return { taskId: task.taskId, agentId: task.agentId, agentName: task.agentId, status: 'completed', output: 'done', truncated: false, startedAt: 0, finishedAt: 1 }
}

/** 运行时按会话缓存、工具只注册一次，因此本轮上下文必须在调用时刻现取。 */
describe('subagent 工具的按轮解析', () => {
  it('取消信号取自调用时刻：上一轮的信号已 abort 不影响本轮委派', async () => {
    const stale = new AbortController()
    stale.abort()
    let current = stale
    const executed: string[] = []
    const tool = createSubAgentTool({
      resolveSignal: () => current.signal,
      resolveCustomAgents: () => [],
      execute: async (task) => { executed.push(task.taskId); return completed(task) }
    })

    // 首轮：信号已取消，任务不应真正执行
    await tool.execute('call-1', { agent: 'scout', task: '看一下调用链' }, undefined, undefined, {} as never)
    expect(executed).toHaveLength(0)

    // 次轮换上新的信号，工具必须用新的
    current = new AbortController()
    await tool.execute('call-2', { agent: 'scout', task: '看一下调用链' }, undefined, undefined, {} as never)
    expect(executed).toHaveLength(1)
  })

  it('工具描述带出可委派角色清单，自定义角色也在其中', () => {
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [{ id: 'auditor', name: 'API 审查员', description: '只读检查 API 契约', systemPrompt: '只读审计', tools: ['read'], allowWrite: false, allowMcp: false, thinkingLevel: 'low', maxTurns: 8 }],
      execute: async (task) => completed(task)
    })
    expect(tool.description).toContain('- scout：')
    expect(tool.description).toContain('- auditor：只读检查 API 契约')
  })

  it('本轮取消会传播到子任务', async () => {
    const controller = new AbortController()
    controller.abort()
    const tool = createSubAgentTool({
      resolveSignal: () => controller.signal,
      resolveCustomAgents: () => [],
      execute: async (task) => completed(task)
    })
    const result = await tool.execute('call-1', { agent: 'scout', task: '看一下调用链' }, undefined, undefined, {} as never) as { details: { results: SubAgentResult[] } }
    expect(result.details.results[0].status).toBe('cancelled')
  })

  it('自定义 Sub-agent 列表取自调用时刻：设置里新增的 agent 立即可用', async () => {
    const custom: SubAgentConfig[] = []
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => custom,
      execute: async (task) => completed(task)
    })
    await expect(tool.execute('call-1', { agent: 'auditor', task: '检查一下' }, undefined, undefined, {} as never)).rejects.toThrow('未知 Sub-agent：auditor')

    custom.push({ id: 'auditor', name: 'auditor', description: '', systemPrompt: '只读审计', tools: ['read'], allowWrite: false, allowMcp: false, thinkingLevel: 'low', maxTurns: 8 })
    const result = await tool.execute('call-2', { agent: 'auditor', task: '检查一下' }, undefined, undefined, {} as never) as { details: { results: SubAgentResult[] } }
    expect(result.details.results[0].status).toBe('completed')
  })
})
