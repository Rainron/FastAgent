import type { ThinkingLevel } from '../../../shared/types'
import { SUBAGENT_DEFAULT_MAX_TOOL_CALLS, SUBAGENT_MAX_TOOL_CALLS_CEILING } from '../../../shared/subagent'

export type SubAgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'
export type SubAgentExpectedOutput = 'findings' | 'review' | 'verification'

export interface SubAgentConfig {
  id: string
  name: string
  description: string
  systemPrompt: string
  /** 已授予的工具，取值来自 `shared/subagent` 的 SUBAGENT_TOOL_IDS；`shell` 在执行时映射成实际 shell 工具名。 */
  tools: string[]
  /**
   * 是否允许给这个角色授予写类工具（edit / write / patch / shell）。
   *
   * 它只管「能不能选」，真正的边界是 `tools`：归一时会按它裁掉写类工具，
   * 子运行的计划模式也按 `tools` 里有没有写类工具决定，不另立一套判断。
   */
  allowWrite: boolean
  /** 是否把父运行已连接的 MCP 工具一并给子运行。 */
  allowMcp: boolean
  thinkingLevel: ThinkingLevel
  /**
   * 工具调用次数上限；缺省时用设置里的 `subAgentMaxToolCalls`。
   *
   * 原字段名是 maxTurns，但轮次从来没有传给子运行——pi 的 `session.prompt()` 内部
   * 才是轮次循环，SDK 也不提供上限选项，那个配置填多少都不生效。
   * 这里改成真正能观测、也真正生效的量。
   */
  maxToolCalls?: number
}

export interface SubAgentTask {
  taskId: string
  agentId: string
  goal: string
  context?: string
  expectedOutput?: SubAgentExpectedOutput
  verificationRequirements?: string[]
  forbiddenActions?: string[]
}

export interface SubAgentResult {
  taskId: string
  agentId: string
  agentName: string
  status: Exclude<SubAgentStatus, 'queued' | 'running'>
  output: string
  // 结果里的交接一律来自 parseSubAgentHandoff，小节齐全；事件与落库结构另有历史记录，那边 changedFiles 是可选的。
  handoff?: { goal: string; changedFiles: string[]; verified: string[]; unverified: string[]; findings: string[]; decisions: string[]; recommendations: string[]; remainingSteps: string[] }
  error?: string
  truncated: boolean
  startedAt: number
  finishedAt: number
}

export interface SubAgentRunEvent {
  taskId: string
  agentId: string
  agentName: string
  status: SubAgentStatus
  output?: string
  detail?: string
}

export const SUBAGENT_LIMITS = {
  /** 与单次任务上限一致：一次委派的任务全部同时起跑，不在工具内部再排队。 */
  maxParallelTasks: 8,
  maxTasksPerCall: 8,
  maxTaskCharacters: 20_000,
  maxOutputCharacters: 50_000,
  /** 与设置界面共用同一份：推荐默认值与可配上限。 */
  defaultMaxToolCalls: SUBAGENT_DEFAULT_MAX_TOOL_CALLS,
  maxToolCallsCeiling: SUBAGENT_MAX_TOOL_CALLS_CEILING,
  maxRuntimeMs: 10 * 60 * 1000,
  /** 链式传递的是结构化交接而非全文，三个上限分别管总量、条数和单条长度。 */
  maxChainHandoffCharacters: 12_000,
  maxChainHandoffItems: 20,
  maxChainHandoffItemCharacters: 1_000
} as const
