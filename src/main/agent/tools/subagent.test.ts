import { describe, expect, it } from 'vitest'
import { createSubAgentTool } from './subagent'
import type { SubAgentConfig, SubAgentResult } from '../subagent/subagent-types'
import type { ScheduledSubAgentTask } from '../subagent/subagent-scheduler'

function completed(task: ScheduledSubAgentTask): SubAgentResult {
  return { taskId: task.taskId, agentId: task.agentId, agentName: task.agentId, status: 'completed', output: 'done', truncated: false, startedAt: 0, finishedAt: 1 }
}

/** details 里只有摘要：子任务全文会被 finishToolCall 整段写进 tool_calls.result_json。 */
type ToolResultDetails = { details: { mode: string; results: Array<{ taskId: string; status: SubAgentResult['status']; handoff?: SubAgentResult['handoff'] }> } }

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
      resolveCustomAgents: () => [{ id: 'auditor', name: 'API 审查员', description: '只读检查 API 契约', systemPrompt: '只读审计', tools: ['read'], allowWrite: false, allowMcp: false, thinkingLevel: 'low', maxToolCalls: 40 }],
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
    const result = await tool.execute('call-1', { agent: 'scout', task: '看一下调用链' }, undefined, undefined, {} as never) as ToolResultDetails
    expect(result.details.results[0].status).toBe('cancelled')
  })

  it('taskId 在并发调用之间不碰撞', async () => {
    const taskIds: string[] = []
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [],
      execute: async (task) => { taskIds.push(task.taskId); return completed(task) }
    })
    // 原实现是 `subtask-${Date.now()}-${index}`：同一毫秒的两次调用会撞 id，
    // agent_tasks 的 ON CONFLICT DO UPDATE 会把前一条台账直接覆盖掉
    await Promise.all([
      tool.execute('call-1', { tasks: [{ agent: 'scout', task: 'a' }, { agent: 'scout', task: 'b' }] }, undefined, undefined, {} as never),
      tool.execute('call-2', { tasks: [{ agent: 'scout', task: 'c' }, { agent: 'scout', task: 'd' }] }, undefined, undefined, {} as never)
    ])
    expect(taskIds).toHaveLength(4)
    expect(new Set(taskIds).size).toBe(4)
  })

  it('details 只回摘要，不把子任务全文写进台账', async () => {
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [],
      execute: async (task) => ({ ...completed(task), output: '这段正文不该进 result_json' })
    })
    // details 会被 finishToolCall 整段 JSON 序列化落库，而渲染层只读 handoff
    const result = await tool.execute('call-1', { agent: 'scout', task: '看一下调用链' }, undefined, undefined, {} as never) as ToolResultDetails
    expect(JSON.stringify(result.details)).not.toContain('这段正文不该进 result_json')
    expect(result.details.results[0].status).toBe('completed')
  })

  it('自定义 Sub-agent 列表取自调用时刻：设置里新增的 agent 立即可用', async () => {
    const custom: SubAgentConfig[] = []
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => custom,
      execute: async (task) => completed(task)
    })
    await expect(tool.execute('call-1', { agent: 'auditor', task: '检查一下' }, undefined, undefined, {} as never)).rejects.toThrow('未知 Sub-agent：auditor')

    custom.push({ id: 'auditor', name: 'auditor', description: '', systemPrompt: '只读审计', tools: ['read'], allowWrite: false, allowMcp: false, thinkingLevel: 'low', maxToolCalls: 40 })
    const result = await tool.execute('call-2', { agent: 'auditor', task: '检查一下' }, undefined, undefined, {} as never) as ToolResultDetails
    expect(result.details.results[0].status).toBe('completed')
  })
})

describe('subagent 参数形式', () => {
  const tool = () => createSubAgentTool({
    resolveSignal: () => new AbortController().signal,
    resolveCustomAgents: () => [],
    execute: async (task) => completed(task)
  })

  it('chain 旁边多带一个没有 task 的顶层 agent 时按链式执行，不报错', async () => {
    // 真实模型会这样传；直接拒绝会让模型认定 chain 不可用，并把这个错误结论写进跨会话记忆
    const result = await tool().execute('call-1', { agent: 'scout', chain: [{ agent: 'scout', task: '先读' }, { agent: 'scout', task: '再算' }] }, undefined, undefined, {} as never) as ToolResultDetails
    expect(result.details.mode).toBe('chain')
    expect(result.details.results).toHaveLength(2)
  })

  it('形式不合法时报错文案列全三种形式', async () => {
    await expect(tool().execute('call-1', { agent: 'scout', task: 'x', chain: [{ agent: 'scout', task: 'y' }] }, undefined, undefined, {} as never)).rejects.toThrow(/chain/)
    await expect(tool().execute('call-1', {}, undefined, undefined, {} as never)).rejects.toThrow(/agent \+ task.*tasks.*chain/)
  })
})
