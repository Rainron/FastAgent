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

/** 不转发的高频流式事件；正文由调用方自行累积。 */
const STREAMING_TYPES = new Set<AgentEvent['type']>(['token', 'thinking', 'thinking_started', 'thinking_ended'])

const TERMINAL_TYPES = new Set<AgentEvent['type']>(['completed', 'failed', 'cancelled', 'interrupted'])

export interface SubAgentForwardContext {
  taskId: string
  agentId: string
  agentName: string
  parentToolCallId: string
  parentRunId: string
  subAgentRunId: string
}

export function isSubAgentTerminalEvent(type: AgentEvent['type']): boolean {
  return TERMINAL_TYPES.has(type)
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
