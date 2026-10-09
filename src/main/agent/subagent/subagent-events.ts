import type { AgentEvent } from '../../../shared/types'

/**
 * 子运行事件向父运行转发的过滤与映射。
 *
 * 子运行的流式增量（token/thinking）曾被原样转发成 subagent_update：这类事件走不到父运行
 * emit 里的 token 快路径，每条都要读回整轮 activity、全量 JSON 序列化再写库，并立即推一次 IPC，
 * 主进程与渲染端双双退化成 O(N²)，界面直接卡死。子 Agent 的流式正文本来也不上屏，
 * 完整输出随最终结果一次性回传即可。
 */

/**
 * 单个子任务允许转发的非终态事件上限。这些事件驱动卡片上的动态（当前动作 + 已完成数），
 * 打满后卡片就停在最后一次进度上，因此要能覆盖正常子运行的工具调用量：
 * maxTurns 12 轮、每轮若干次工具、起止各一条，实测 2 个子任务约 116 条。
 * 仍保留上限，是为了给未来新增的高频事件兜底，不让同类洪水再次压垮主进程。
 */
export const SUBAGENT_MAX_FORWARDED_EVENTS = 400

/**
 * 不转发的事件：流式正文由调用方自行累积；上下文与用量快照只对子运行自己有意义。
 *
 * contextProgress 在流式输出期间每 250ms 一条，折成不带工具的 subagent_update 后卡片上什么都不显示，
 * 却占掉转发配额（实测 5 个子任务 1464 条里 1392 条是它），配额一满真正的工具进度就被丢掉，
 * 卡片停在「启动中」；每条还要把整轮 activity 重新序列化写库。用量记录由调用方直接落库。
 */
const STREAMING_TYPES = new Set<AgentEvent['type']>(['token', 'thinking', 'thinking_started', 'thinking_ended', 'contextProgress', 'contextUpdated', 'usageUpdated'])

const TERMINAL_TYPES = new Set<AgentEvent['type']>(['completed', 'failed', 'cancelled', 'interrupted'])

/**
 * 原样转发、不折叠成 subagent_update 的事件。
 *
 * file_changed 带着 path 与增删行，父运行靠它登记 Artifact、刷新本轮改动统计；折叠后这些字段
 * 全丢，可写 Sub-agent 改的文件在产物面板与改动条上就彻底不存在。它映射不到执行轨迹动作，
 * 原样放行不会在轨迹上多出一条。同理不受转发配额限制——丢一条就等于丢一个文件。
 */
const PASSTHROUGH_TYPES = new Set<AgentEvent['type']>(['file_changed'])

export interface SubAgentForwardContext {
  taskId: string
  agentId: string
  agentName: string
  parentToolCallId: string
  parentRunId: string
  subAgentRunId: string
}

const FORWARD_INPUT_MAX = 160

function truncateForwardInput(input: string): string {
  return input.length > FORWARD_INPUT_MAX ? `${input.slice(0, FORWARD_INPUT_MAX)}…` : input
}

export function isSubAgentTerminalEvent(type: AgentEvent['type']): boolean {
  return TERMINAL_TYPES.has(type)
}

/** 原样转发的事件不占转发配额：它们服务的是产物登记，不是卡片上的进度动画。 */
export function isSubAgentPassthroughEvent(type: AgentEvent['type']): boolean {
  return PASSTHROUGH_TYPES.has(type)
}

/**
 * 子运行事件 → 父运行事件；返回 null 表示丢弃。
 * forwarded 为该子任务已转发的非终态事件数；终态事件不受配额限制，
 * 否则轨迹上的 Sub-agent 卡片会永远停在「执行中」。
 */
export function forwardSubAgentEvent(
  event: Omit<AgentEvent, 'runId'>,
  context: SubAgentForwardContext,
  forwarded: number
): Omit<AgentEvent, 'runId'> | null {
  if (STREAMING_TYPES.has(event.type)) return null
  if (PASSTHROUGH_TYPES.has(event.type)) return event
  const terminal = TERMINAL_TYPES.has(event.type)
  if (!terminal && forwarded >= SUBAGENT_MAX_FORWARDED_EVENTS) return null
  const type: AgentEvent['type'] = event.type === 'completed'
    ? 'subagent_result'
    : event.type === 'failed'
      ? 'subagent_failed'
      : event.type === 'cancelled' || event.type === 'interrupted'
        ? 'subagent_cancelled'
        : 'subagent_update'
  // 子运行的终态事件不一定带 status（如 cancelled 只有 detail），这里按事件类型补齐，
  // 否则卡片状态会停留在 running。
  const subAgentStatus = event.type === 'completed'
    ? 'completed'
    : event.type === 'failed'
      ? 'failed'
      : event.type === 'cancelled' || event.type === 'interrupted'
        ? 'cancelled'
        : event.status ?? 'running'
  return {
    type,
    toolCallId: context.parentToolCallId,
    tool: event.tool,
    // 只带工具开始时的入参摘要且截短：卡片与过程头要说「正在读取 App.tsx」，
    // 但每条事件都会进整轮 activity 反复序列化，不能把整段命令原样搬过来。
    ...(event.type === 'tool_started' && event.input ? { input: truncateForwardInput(event.input) } : {}),
    detail: event.detail,
    status: event.status,
    subAgent: {
      taskId: context.taskId,
      agentId: context.agentId,
      agentName: context.agentName,
      status: subAgentStatus,
      parentToolCallId: context.parentToolCallId,
      parentRunId: context.parentRunId,
      subAgentRunId: context.subAgentRunId,
      detail: event.detail
    }
  }
}
