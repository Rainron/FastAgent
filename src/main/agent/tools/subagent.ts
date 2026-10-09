import { randomUUID } from 'node:crypto'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { describeSubAgentRoster, resolveSubAgentConfig, subAgentCanWrite, SUBAGENT_HANDOFF_PROMPT, validateSubAgentTask } from '../subagent/subagent-config'
import type { AgentEvent } from '../../../shared/types'
import { SUBAGENT_LIMITS, type SubAgentConfig, type SubAgentResult, type SubAgentStatus } from '../subagent/subagent-types'
import { formatHandoffForChain } from '../subagent/subagent-handoff'
import { runSubAgentChain, runSubAgentTasks, type ScheduledSubAgentTask } from '../subagent/subagent-scheduler'
import type { WorkspaceGate, WriteTarget } from '../subagent/workspace-gate'

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
  /** 跨调用的工作区闸门：同一条消息里的多次 subagent 调用会被 Pi 并行执行，写入冲突按文件认领。 */
  gate?: WorkspaceGate
}

export function createSubAgentTool(context: SubAgentToolBindings) {
  // 角色清单在注册时刻取一次：它进的是系统提示，改自定义角色会让会话运行时缓存失效并重建。
  const roster = describeSubAgentRoster(context.resolveCustomAgents())
  return defineTool({
    name: 'subagent',
    label: 'Sub-agent',
    description: `将边界清晰、可独立完成的调查、验证或实现任务委派给专业 Sub-agent。只读角色用于调查与验证；可写角色能改文件、执行命令，只在方案已经确定、改动范围已经写清楚时委派。相互独立的任务可以并行；依赖当前决策或最终取舍的工作必须由主 Agent 处理。\n\n可用 Sub-agent（agent 参数只能取下面的 id）：\n${roster}`,
    promptSnippet: 'Delegate a scoped task to a sub-agent',
    // 不声明 executionMode: 'sequential'：Pi 见到批次里有一个串行工具就把整批串行，
    // 模型分两次调用 subagent 时两个子代理会一个跑完才开始下一个。写冲突改由 WorkspaceGate 按文件认领：
    // 子代理一律并行，可写子代理只等同批主 Agent 的写操作做完。
    promptGuidelines: [
      'agent 参数只能取工具描述里列出的 Sub-agent id，不要自造。',
      '只委派局部、独立、目标可自洽判定的工作。',
      '委派可写角色前，方案、涉及文件与验证方式必须已经确定；探索性的改动自己做。',
      'task 里要写清改动范围与禁止事项，子 Agent 看不到当前对话的历史。',
      '相互独立的实现任务（包括可写任务）放进同一次 tasks 并行执行，不要一个一个委派。按文件拆分并在每个 task 里写明它负责的文件：同一文件被一个子任务写过后，其他并行子任务再写会被系统拒绝。',
      '有先后依赖的任务用 chain；安装依赖、git 提交、全量构建这类改动全局状态的命令不要放进并行子任务，由主 Agent 在它们结束后执行。',
      'Sub-agent 结论只作参考，主 Agent 必须复核其改动与结论并做最终决定。',
      '复杂任务且确实节省上下文时，可用 tasks 并行委派多个子任务。',
      '要求子任务交接包含目标、改动文件、已验证项、未验证项、关键决定和剩余步骤。'
    ],
    parameters: Type.Object({
      agent: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      tasks: Type.Optional(Type.Array(Type.Object({ agent: Type.String(), task: Type.String() }))),
      chain: Type.Optional(Type.Array(Type.Object({ agent: Type.String(), task: Type.String() })))
    }),
    async execute(toolCallId, params) {
      // tasks / chain 旁边多带一个顶层 agent 是模型的常见写法，按批量形式处理，
      // 不为此报错让主 Agent 白白多跑一轮。
      const single = params.task !== undefined || (params.agent !== undefined && params.tasks === undefined && params.chain === undefined)
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
      const tasks = rawTasks.map((item) => {
        const config = resolveSubAgentConfig(item.agent, customAgents)
        if (!config) throw new Error(`未知 Sub-agent：${item.agent}`)
        const error = validateSubAgentTask(item.task, SUBAGENT_LIMITS.maxTaskCharacters)
        if (error) throw new Error(error)
        // taskId 曾是 `subtask-${Date.now()}-${index}`：两次并发调用落在同一毫秒就会撞 id，
        // agent_tasks 的 ON CONFLICT DO UPDATE 直接覆盖掉前一条，轨迹分组也会把两个子任务并成一张卡。
        // 可写与否由角色能力决定，不交给模型声明：模型判断错就是两个子运行互相覆盖改动。
        const canWrite = subAgentCanWrite(config)
        const taskId = `subtask-${randomUUID()}`
        // 链式任务共用一个认领者：后一步本来就要接着改前一步的文件。
        const owner = chained ? toolCallId : taskId
        const label = `${config.name}：${taskPreview(item.task)}`
        const gate = context.gate
        const claimWrite = canWrite && gate
          ? (targets: WriteTarget[]) => {
            const conflict = gate.claimFiles(owner, label, targets)
            return conflict ? `${conflict.path} 正由并行的 Sub-agent「${conflict.ownerLabel}」修改，本任务不能再写它：两个子代理同时改同一文件会互相覆盖。跳过这个文件，把需要的改动写进交接的「剩余步骤」，由主 Agent 合并。` : null
          }
          : undefined
        return { taskId, agentId: config.id, agentName: config.name, task: `${item.task}\n\n${SUBAGENT_HANDOFF_PROMPT}`, canWrite, ...(claimWrite ? { claimWrite } : {}) }
      })
      const subAgentInfo = (task: (typeof tasks)[number], status: SubAgentStatus) => ({ taskId: task.taskId, agentId: task.agentId, agentName: task.agentName, status, parentToolCallId: toolCallId })
      // 整批先登记为排队：只在真正开跑时才发事件的话，排队中的子任务在界面上根本不出现。
      for (const task of tasks) context.emit?.({ type: 'subagent_started', toolCallId, input: task.task, subAgent: subAgentInfo(task, 'queued') })
      const settled = new Set<string>()
      const emitResult = (task: (typeof tasks)[number], result: SubAgentResult) => {
        if (settled.has(task.taskId)) return
        settled.add(task.taskId)
        // 事件里只放交接摘要：子 Agent 全文最多 50k 字符，落进 turn activity 后该回合每个
        // 后续事件都要把它重新序列化一遍。全文经工具返回值交给模型，UI 只渲染 handoff。
        context.emit?.({ type: result.status === 'failed' ? 'subagent_failed' : result.status === 'cancelled' ? 'subagent_cancelled' : 'subagent_result', toolCallId, input: task.task, detail: result.error, status: result.status === 'completed' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'failed', subAgent: { ...subAgentInfo(task, result.status), agentName: result.agentName, handoff: result.handoff } })
      }
      const byId = new Map(tasks.map((task) => [task.taskId, task]))
      const executeOne = async (scheduled: ScheduledSubAgentTask, taskSignal: AbortSignal) => {
        const task = byId.get(scheduled.taskId)!
        const run = () => {
          context.emit?.({ type: 'subagent_started', toolCallId, input: task.task, subAgent: subAgentInfo(task, 'running') })
          return context.execute(scheduled, taskSignal, toolCallId)
        }
        const result = context.gate && task.canWrite ? await context.gate.runWriter(run, taskSignal) : await run()
        emitResult(task, result)
        return result
      }
      const results = chained
        ? await runSubAgentChain(tasks, { signal, run: executeOne }, (previous) => formatHandoffForChain(previous.handoff))
        : await runSubAgentTasks(tasks, { signal, run: executeOne })
      // 没跑起来的任务（取消、链式跳过、执行桥抛错）也要有终态事件，否则界面上一直停在排队或转圈。
      for (const result of results) {
        const task = byId.get(result.taskId)
        if (task) emitResult(task, result)
      }
      return {
        content: [{ type: 'text', text: results.map(formatResult).join('\n\n') || 'Sub-agent 没有返回结果。' }],
        // 全文只走 content 交给模型。details 会被 finishToolCall 整段 JSON 序列化进
        // tool_calls.result_json，把 8 × 50k 的子任务正文一起存下来，而渲染层只读 handoff。
        details: { mode: single ? 'single' : chained ? 'chain' : 'parallel', results: results.map(summarizeResult) }
      }
    }
  })
}

function summarizeResult(result: SubAgentResult) {
  return {
    taskId: result.taskId,
    agentId: result.agentId,
    agentName: result.agentName,
    status: result.status,
    handoff: result.handoff,
    truncated: result.truncated,
    error: result.error,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt
  }
}

function taskPreview(task: string): string {
  const line = task.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? ''
  return line.length > 40 ? `${line.slice(0, 40)}…` : line
}

function formatResult(result: SubAgentResult): string {
  const header = `Sub-agent ${result.agentName} · ${result.status}`
  return `${header}\n${result.error ? `原因：${result.error}\n` : ''}${result.output || '（无输出）'}${result.truncated ? '\n[输出已截断]' : ''}`
}
