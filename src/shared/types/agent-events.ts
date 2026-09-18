import type { ApprovalRequest, PermissionPreset, TodoItem } from './common'
import type { CompactionHistory, ContextState, ModelUsageRecord, ModelUsageSummary } from './context'
import type { SandboxNotice } from './sandbox'
import type { RunErrorKind } from './agent-runs'

export type ToolSource = 'builtin' | 'command' | 'mcp' | 'skill' | 'cli' | 'agent'

export interface ToolCallRecord {
  id: string
  conversationId: string
  turnId: string
  runId: string
  parentToolCallId?: string | null
  subAgentId?: string | null
  subAgentRunId?: string | null
  toolName: string
  source?: ToolSource | null
  arguments: unknown
  result: unknown
  status: 'waiting_permission' | 'running' | 'success' | 'failed' | 'denied' | 'cancelled' | 'timeout'
  permissionResult: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  error: string | null
}

export type ExecutionNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ExecutionStepState {
  id: string
  content: string
  position: number
  status: ExecutionNodeStatus
}

export interface ExecutionEventState {
  eventId: string
  type: AgentEvent['type'] | 'assistant_content_started'
  stepId: string | null
  toolCallId?: string
  thinkingId?: string
  status: ExecutionNodeStatus
  startedAt: number
  completedAt: number | null
}

export interface ExecutionSnapshot {
  runId: string
  status: ExecutionNodeStatus
  steps: ExecutionStepState[]
  events: ExecutionEventState[]
  activeStepId: string | null
  activeEventId: string | null
  activeThinkingId: string | null
}

export interface AgentEvent {
  runId: string
  conversationId?: string
  turnId?: string
  type: 'run_started' | 'run_phase' | 'token' | 'thinking' | 'thinking_started' | 'thinking_ended' | 'tool_started' | 'tool_result' | 'approval_required' | 'approval_resolved' | 'question_required' | 'permission_changed' | 'file_changed' | 'contextUpdated' | 'usageUpdated' | 'compactionCompleted' | 'todo_changed' | 'sandbox_blocked' | 'sandbox_degraded' | 'subagent_started' | 'subagent_update' | 'subagent_result' | 'subagent_failed' | 'subagent_cancelled' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  /** 不带子 Agent 全文：全文只经工具返回值交给模型，事件里放全文会被整轮 activity 反复序列化。 */
  subAgent?: { taskId: string; agentId: string; agentName: string; status: string; parentToolCallId?: string; parentRunId?: string; subAgentRunId?: string; detail?: string; handoff?: { goal: string; verified: string[]; unverified: string[]; findings: string[]; decisions: string[]; recommendations: string[]; remainingSteps: string[] } }
  phase?: 'queued' | 'compacting' | 'initializing' | 'preparing_attachments' | 'prompting' | 'waiting_first_token' | 'streaming' | 'cleanup'
  timestamp?: number
  /** 同一 run 内单调递增，用于渲染层丢弃乱序事件。 */
  sequence?: number
  elapsedMs?: number
  /** 手动压缩的阶段进度；模型生成阶段没有真实百分比时使用阶段估计。 */
  progress?: number
  modelId?: number | null
  cacheHit?: boolean
  text?: string
  tool?: string
  source?: ToolSource | null
  detail?: string
  path?: string
  /** file_changed 携带的该文件增删行数；write / shell 无旧内容可比，缺省表示「无统计」而不是 0。 */
  additions?: number
  deletions?: number
  status?: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  permission?: PermissionPreset
  /** Runtime 生成的稳定事件标识；旧事件缺失时由读取层兼容生成。 */
  eventId?: string
  /** 当前事件所属的 Plan Step。 */
  stepId?: string
  /** Thinking 生命周期标识。 */
  thinkingId?: string
  /** 工具调用标识：存在时按 ToolCallCard 聚合，缺失（chat 模式或旧数据）走原步骤条 */
  toolCallId?: string
  /** 入参摘要（命令/路径），不要放完整参数，完整参数在 tool_calls 表 */
  input?: string
  /** 截至该事件已输出的可见正文长度（token 累计），执行轨迹据此按正文切分文本段；旧数据缺省时无法切分 */
  textLength?: number
  durationMs?: number
  /** 权限判定结果：allow / ask / deny / once / session / always */
  permissionResult?: string
  /** approval_required / question_required 挂起请求 */
  approval?: ApprovalRequest
  /** todo_changed 完整清单 */
  todos?: TodoItem[]
  context?: ContextState
  usageRecord?: ModelUsageRecord
  usage?: ModelUsageSummary
  compaction?: CompactionHistory
  /** sandbox_blocked / sandbox_degraded 的结构化说明 */
  sandbox?: SandboxNotice
  /** 终态事件携带的思考全文，渲染进程据此在回合结束时补齐 activity.thinking */
  thinkingText?: string
  /** 终态事件携带按思考轮次切分的正文，第 N 段对应第 N 个 thinking_started。 */
  thinkingSegments?: string[]
  /** 终态事件携带本轮完整生成轨迹，供执行轨迹与最终回答使用不同文本源。 */
  transcriptText?: string
  /** 事件发生后的 Runtime 执行快照。 */
  execution?: ExecutionSnapshot
  /** failed 事件的失败归类，界面据此区分「网络问题可重试」与「权限被拒需改设置」。 */
  errorKind?: RunErrorKind
}
