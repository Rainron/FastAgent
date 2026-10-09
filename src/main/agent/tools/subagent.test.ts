import { describe, expect, it } from 'vitest'
import { createSubAgentTool } from './subagent'
import type { SubAgentConfig, SubAgentResult } from '../subagent/subagent-types'
import type { ScheduledSubAgentTask } from '../subagent/subagent-scheduler'
import { WorkspaceGate } from '../subagent/workspace-gate'

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

  it('可写标记由角色能力决定，不由模型声明；只有可写任务带写入认领', async () => {
    // 模型判断错就是两个可写子运行互相覆盖改动，所以这个标记不进工具参数
    const scheduled: ScheduledSubAgentTask[] = []
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [],
      gate: new WorkspaceGate(),
      execute: async (task) => { scheduled.push(task); return completed(task) }
    })
    await tool.execute('call-1', { tasks: [{ agent: 'scout', task: '看调用链' }, { agent: 'builder', task: '按方案改 a.ts' }] }, undefined, undefined, {} as never)
    expect(scheduled.map((task) => [task.agentId, task.canWrite, typeof task.claimWrite])).toEqual([['scout', false, 'undefined'], ['builder', true, 'function']])
  })

  it('subagent 工具不声明串行：Pi 见到串行工具会把整批串行，两次委派就变成一个接一个跑', () => {
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [],
      execute: async (task) => completed(task)
    })
    expect(tool.executionMode).not.toBe('sequential')
  })

  it('只读与可写委派都并行：一次 tasks 里的五个可写任务同时在跑，跨调用同样并行', async () => {
    const gate = new WorkspaceGate()
    let running = 0
    let peak = 0
    const releases: Array<() => void> = []
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [],
      gate,
      execute: async (task) => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise<void>((resolve) => releases.push(resolve))
        running -= 1
        return completed(task)
      }
    })
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

    const reads = Promise.all([
      tool.execute('call-1', { agent: 'scout', task: 'a' }, undefined, undefined, {} as never),
      tool.execute('call-2', { agent: 'reviewer', task: 'b' }, undefined, undefined, {} as never)
    ])
    await flush()
    expect(running).toBe(2)
    releases.splice(0).forEach((release) => release())
    await reads

    const batch = tool.execute('call-3', { tasks: ['a', 'b', 'c', 'd', 'e'].map((name) => ({ agent: 'builder', task: `写 ${name}.md` })) }, undefined, undefined, {} as never)
    await flush()
    expect(running).toBe(5)
    releases.splice(0).forEach((release) => release())
    await batch

    const writes = Promise.all([
      tool.execute('call-4', { agent: 'builder', task: '改 a.ts' }, undefined, undefined, {} as never),
      tool.execute('call-5', { agent: 'builder', task: '改 b.ts' }, undefined, undefined, {} as never)
    ])
    await flush()
    expect(running).toBe(2)
    releases.splice(0).forEach((release) => release())
    await writes
  })

  it('并行可写任务写同一文件：后来者被拒绝并得知是谁在改', async () => {
    const claims: Array<string | null> = []
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [],
      gate: new WorkspaceGate(),
      execute: async (task) => {
        claims.push(task.claimWrite?.([{ path: 'shared.ts', absolutePath: '/repo/shared.ts' }]) ?? null)
        await new Promise((resolve) => setTimeout(resolve, 0))
        return completed(task)
      }
    })
    await tool.execute('call-1', { tasks: [{ agent: 'builder', task: '改 shared.ts 的导出' }, { agent: 'builder', task: '也改 shared.ts' }] }, undefined, undefined, {} as never)
    expect(claims[0]).toBeNull()
    expect(claims[1]).toContain('shared.ts')
    expect(claims[1]).toContain('builder：改 shared.ts 的导出')
  })

  it('链式任务共用认领：后一步可以接着改前一步的文件', async () => {
    const claims: Array<string | null> = []
    const gate = new WorkspaceGate()
    let releaseOther!: () => void
    // 另一个并行的可写子代理还在跑，认领不会因为前一步结束而清空
    const other = gate.runWriter(() => new Promise<void>((resolve) => { releaseOther = resolve }))
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [],
      gate,
      execute: async (task) => {
        claims.push(task.claimWrite?.([{ path: 'a.ts', absolutePath: '/repo/a.ts' }]) ?? null)
        return completed(task)
      }
    })
    await tool.execute('call-1', { chain: [{ agent: 'builder', task: '第一步' }, { agent: 'builder', task: '第二步' }] }, undefined, undefined, {} as never)
    expect(claims).toEqual([null, null])
    releaseOther()
    await other
  })

  it('整批先发排队事件，开跑再发 running；没跑起来的任务也有终态事件', async () => {
    const events: Array<{ type: string; taskId?: string; status?: string }> = []
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [],
      emit: (event) => events.push({ type: event.type, taskId: event.subAgent?.taskId, status: event.subAgent?.status }),
      execute: async (task) => {
        if (task.task.startsWith('坏')) throw new Error('boom')
        return completed(task)
      }
    })
    await tool.execute('call-1', { chain: [{ agent: 'builder', task: '坏的第一步' }, { agent: 'builder', task: '第二步' }] }, undefined, undefined, {} as never)
    const [first, second] = [...new Set(events.map((event) => event.taskId))]
    expect(events.slice(0, 2).map((event) => event.status)).toEqual(['queued', 'queued'])
    expect(events.filter((event) => event.taskId === first).map((event) => event.type)).toEqual(['subagent_started', 'subagent_started', 'subagent_failed'])
    // 第二步被链式跳过，从没开跑，但仍要结算
    expect(events.filter((event) => event.taskId === second).map((event) => [event.type, event.status])).toEqual([['subagent_started', 'queued'], ['subagent_cancelled', 'cancelled']])
  })

  it('tasks 旁多带一个顶层 agent 时按批量形式执行，不报参数错误', async () => {
    const executed: string[] = []
    const tool = createSubAgentTool({
      resolveSignal: () => new AbortController().signal,
      resolveCustomAgents: () => [],
      execute: async (task) => { executed.push(task.agentId); return completed(task) }
    })
    await tool.execute('call-1', { agent: 'builder', tasks: [{ agent: 'builder', task: 'a' }, { agent: 'scout', task: 'b' }] }, undefined, undefined, {} as never)
    expect(executed.sort()).toEqual(['builder', 'scout'])
    await expect(tool.execute('call-2', { agent: 'builder', task: 'a', tasks: [{ agent: 'scout', task: 'b' }] }, undefined, undefined, {} as never)).rejects.toThrow('只能选择一种形式')
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
