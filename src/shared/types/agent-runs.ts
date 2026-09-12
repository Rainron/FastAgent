import type { ConversationMode } from './common'

/** 一次 Agent 运行的台账状态。与 turn.status 同步，但独立落表，重启后仍可查。 */
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

/** 一次 Sub-agent 委派的台账状态；与 SubAgentStatus 同口径。 */
export type AgentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'

/**
 * 运行失败的归类，决定「能不能自动重试」与界面给什么建议。
 *
 * 没有 tool 这一档：单次工具失败已经逐条记在 tool_calls.error 里，
 * 再在 run 级复述一遍只会多一处需要同步的真相。
 */
export type RunErrorKind = 'model' | 'network' | 'permission' | 'sandbox' | 'timeout' | 'validation' | 'system' | 'cancelled'

export interface AgentRunRecord {
  runId: string
  conversationId: string
  turnId: string
  mode: ConversationMode
  status: AgentRunStatus
  startedAt: number
  finishedAt: number | null
  error: string | null
  /** 失败归类；旧记录与正常结束为 null。 */
  errorKind: RunErrorKind | null
  /** 本次运行内发生的自动重试次数（空响应重试、输出上限续写等）。 */
  retryCount: number
}

export interface AgentTaskRecord {
  taskId: string
  runId: string
  conversationId: string
  turnId: string
  /** 发起委派的那次 subagent 工具调用；与 tool_calls.id 对应。 */
  parentToolCallId: string | null
  /** 子运行自己的 runId，日志按它串联。 */
  subAgentRunId: string | null
  agentId: string
  agentName: string
  goal: string
  status: AgentTaskStatus
  /** 交接摘要里的目标行，用于列表里一眼看出这个子任务做了什么。 */
  summary: string | null
  error: string | null
  startedAt: number
  finishedAt: number | null
  durationMs: number | null
}

/** 一次运行连同它的委派任务；会话详情按这个结构展示。 */
export interface AgentRunLedgerEntry {
  run: AgentRunRecord
  tasks: AgentTaskRecord[]
}

/**
 * 可续跑的中断运行。恢复点不是全量快照：pi 的 session 文件已经是消息级持久化，
 * 这里只记「从哪一轮接上」与「还剩什么」，正文历史由 session 文件自己带。
 */
export interface ResumableRun {
  runId: string
  conversationId: string
  turnId: string
  /** 中断回合的原始用户请求，用于提示里说明「上次要做什么」。 */
  goal: string
  /** 中断原因，来自 agent_runs.error。 */
  reason: string | null
  errorKind: RunErrorKind | null
  /** 未完成的待办数（不含 completed / cancelled / skipped）。 */
  pendingTodos: number
  /** 上一轮已改动的文件数，用于提醒模型不要重做。 */
  changedFiles: number
  interruptedAt: number
}
