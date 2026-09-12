import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { describeSubAgentRoster, resolveSubAgentConfig, SUBAGENT_HANDOFF_PROMPT, validateSubAgentTask } from '../subagent/subagent-config'
import type { AgentEvent } from '../../../shared/types'
import { SUBAGENT_LIMITS, type SubAgentConfig, type SubAgentResult } from '../subagent/subagent-types'
import { runSubAgentTasks, type ScheduledSubAgentTask } from '../subagent/subagent-scheduler'

export interface SubAgentToolContext {
  execute: (task: ScheduledSubAgentTask, signal: AbortSignal, parentToolCallId: string) => Promise<SubAgentResult>
  parentToolCallId?: string
  subAgentId?: string
  subAgentRunId?: string
  emit?: (event: Omit<AgentEvent, 'runId'>) => void
}

/**
 * 工具在运行时创建时注册一次，之后整个会话复用；本轮的取消信号、执行桥与自定义 Sub-agent
 * 列表必须在 execute 时刻现取，否则第二轮起拿到的是首轮的过期闭包：事件写进上一轮的回合，
 * 停止按钮也对子 Agent 失效（首轮的 signal 永远不会 abort）。
 */
export interface SubAgentToolBindings {
  resolveSignal: () => AbortSignal
  resolveCustomAgents: () => SubAgentConfig[]
  execute: SubAgentToolContext['execute']
  emit?: (event: Omit<AgentEvent, 'runId'>) => void
}

export function createSubAgentTool(context: SubAgentToolBindings) {
  // 角色清单在注册时刻取一次：它进的是系统提示，改自定义角色会让会话运行时缓存失效并重建。
  const roster = describeSubAgentRoster(context.resolveCustomAgents())
  return defineTool({
    name: 'subagent',
    label: 'Sub-agent',
    description: `将独立的只读调查或验证任务委派给专业 Sub-agent。复杂且相互独立的任务可以并行委派；依赖当前决策、正在修改的代码或最终取舍的工作必须由主 Agent 处理。\n\n可用 Sub-agent（agent 参数只能取下面的 id）：\n${roster}`,
    promptSnippet: 'Delegate independent read-only work to a sub-agent',
    promptGuidelines: [
      'agent 参数只能取工具描述里列出的 Sub-agent id，不要自造。',
      '只委派局部、独立、只读的调查或验证工作。',
      '不要委派依赖当前对话决策、正在迭代的修改或最终取舍的工作。',
      'Sub-agent 结论只作参考，主 Agent 必须整合、复核并做最终决定。',
      '复杂任务且确实节省上下文时，可用 tasks 并行委派多个子任务。',
      '要求子任务交接包含目标、已验证项、未验证项、关键决定和剩余步骤。'
    ],
    parameters: Type.Object({
      agent: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      tasks: Type.Optional(Type.Array(Type.Object({ agent: Type.String(), task: Type.String() }))),
      chain: Type.Optional(Type.Array(Type.Object({ agent: Type.String(), task: Type.String() })))
    }),
    async execute(toolCallId, params) {
      const single = params.agent !== undefined || params.task !== undefined
      const parallel = params.tasks !== undefined
      const chained = params.chain !== undefined
      if ((single ? 1 : 0) + (parallel ? 1 : 0) + (chained ? 1 : 0) !== 1 || (single && (!params.agent || !params.task)) || (parallel && !params.tasks?.length) || (chained && !params.chain?.length)) {
        throw new Error('subagent 参数必须是 agent + task，或非空 tasks，且只能选择一种形式')
      }
      const rawTasks = single
        ? [{ agent: params.agent as string, task: params.task as string }]
        : chained
          ? (params.chain ?? [])
          : (params.tasks ?? [])
      if (rawTasks.length > SUBAGENT_LIMITS.maxTasksPerCall) throw new Error(`Sub-agent 任务数不能超过 ${SUBAGENT_LIMITS.maxTasksPerCall}`)
      // 本轮的取消信号与自定义 Sub-agent 列表在调用时刻现取，不能用注册时的闭包。
      const signal = context.resolveSignal()
      const customAgents = context.resolveCustomAgents()
      const tasks = rawTasks.map((item, index) => {
        const config = resolveSubAgentConfig(item.agent, customAgents)
        if (!config) throw new Error(`未知 Sub-agent：${item.agent}`)
        const error = validateSubAgentTask(item.task, SUBAGENT_LIMITS.maxTaskCharacters)
        if (error) throw new Error(error)
        return { taskId: `subtask-${Date.now()}-${index}`, agentId: config.id, task: `${item.task}\n\n${SUBAGENT_HANDOFF_PROMPT}` }
      })
      const executeOne = async (task: ScheduledSubAgentTask, taskSignal: AbortSignal, emit: (status: import('../subagent/subagent-types').SubAgentStatus, detail?: string) => void) => {
        const config = resolveSubAgentConfig(task.agentId, customAgents)
        context.emit?.({ type: 'subagent_started', toolCallId, input: task.task, subAgent: { taskId: task.taskId, agentId: task.agentId, agentName: config?.name ?? task.agentId, status: 'queued', parentToolCallId: toolCallId } })
        const result = await context.execute(task, taskSignal, toolCallId)
        emit(result.status === 'completed' ? 'completed' : result.status, result.error)
        // 事件里只放交接摘要：子 Agent 全文最多 50k 字符，落进 turn activity 后该回合每个
        // 后续事件都要把它重新序列化一遍。全文经工具返回值交给模型，UI 只渲染 handoff。
        context.emit?.({ type: result.status === 'failed' ? 'subagent_failed' : result.status === 'cancelled' ? 'subagent_cancelled' : 'subagent_result', toolCallId, input: task.task, detail: result.error, status: result.status === 'completed' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'failed', subAgent: { taskId: task.taskId, agentId: task.agentId, agentName: result.agentName, status: result.status, parentToolCallId: toolCallId, handoff: result.handoff } })
        return result
      }
      const results = chained ? await runChain(tasks, signal, executeOne) : await runSubAgentTasks(tasks, {
        signal,
        run: async (task, signal, emit) => {
          return executeOne(task, signal, emit)
        }
      })
      return {
        content: [{ type: 'text', text: results.map(formatResult).join('\n\n') || 'Sub-agent 没有返回结果。' }],
        details: { mode: single ? 'single' : chained ? 'chain' : 'parallel', results }
      }
    }
  })
}

async function runChain(tasks: ScheduledSubAgentTask[], signal: AbortSignal, run: (task: ScheduledSubAgentTask, signal: AbortSignal, emit: (status: import('../subagent/subagent-types').SubAgentStatus, detail?: string) => void) => Promise<SubAgentResult>): Promise<SubAgentResult[]> {
  const results: SubAgentResult[] = []
  let context = ''
  for (const task of tasks) {
    if (signal.aborted) {
      results.push({ taskId: task.taskId, agentId: task.agentId, agentName: task.agentId, status: 'cancelled', output: '', truncated: false, startedAt: Date.now(), finishedAt: Date.now() })
      continue
    }
    const result = await run({ ...task, task: `${task.task}\n\n前序 Sub-agent 输出（仅供核对）：\n${context}` }, signal, () => undefined)
    results.push(result)
    context = result.output.slice(-SUBAGENT_LIMITS.maxOutputCharacters)
    if (result.status !== 'completed') break
  }
  return results
}

function formatResult(result: SubAgentResult): string {
  const header = `Sub-agent ${result.agentName} · ${result.status}`
  return `${header}\n${result.error ? `原因：${result.error}\n` : ''}${result.output || '（无输出）'}${result.truncated ? '\n[输出已截断]' : ''}`
}
