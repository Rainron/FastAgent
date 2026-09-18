import type { AbilityInstallMeta, AbilitySource, AbilityType, AgentRunRecord, AgentRunStatus, RunErrorKind, AgentTaskRecord, AgentTaskStatus, AppSettings, ClientPreferences, ConversationMode, ExecutionSnapshot, McpConnectionSnapshot, MemoryRecord, MemoryScope, MemorySettings, MemoryStatus, MemoryType, TurnActivity, TurnRuntimeConfig, TurnStatus } from '../../shared/types'
import { defaultSandboxSettings } from '../../shared/sandbox'
import { DEFAULT_PAGE_SIZE } from '../../shared/pagination'
import { clampRecallLimit, DEFAULT_RECALL } from '../agent/memory/memory-rank'

export interface ConversationRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  archived: boolean
  projectId: string | null
  /** 会话绑定的模型；null 表示还没发过消息，打开时用账户默认模型。 */
  modelId: number | null
}

export const defaultSettings: AppSettings = {
  motionPreference: 'system',
  startAtLogin: false,
  showOnStartup: true,
  closeToTray: true,
  theme: 'system',
  autoSummary: true,
  contextStrategy: 'auto',
  triggerRatio: null,
  keepRecentTurns: null,
  shellPreference: 'bash',
  bashPath: '',
  externalEditorPath: '',
  agentAbilityPolicy: { mode: 'all_enabled', agentAbilityIds: [] },
  subAgentEnabled: true,
  memory: { enabled: true, autoExtract: true, maxRecall: DEFAULT_RECALL, extractModelId: null },
  sandbox: defaultSandboxSettings,
  quickDialogEnabled: true
}

export const defaultRuntimeConfig = (): TurnRuntimeConfig => ({ modelId: null, thinkingLevel: 'auto', mode: 'chat', permission: null, project: null })

export const defaultClientPreferences = (): ClientPreferences => ({ recentServers: [], favoriteModelIds: [], recentModelIds: [], selectedModelId: null, modePrompts: {}, sidebarSections: { workspace: true, recent: true }, paginationPageSize: DEFAULT_PAGE_SIZE })

/** 旧版本的 code 模式已并入 agent，读旧记录时就地归一，不改写库里的原始 JSON。 */
export function normalizeRuntimeConfig(value: Partial<TurnRuntimeConfig>): Partial<TurnRuntimeConfig> {
  return (value.mode as string) === 'code' ? { ...value, mode: 'agent' } : value
}

export interface TurnRow {
  namespace: string
  conversation_id: string
  turn_id: string
  user_message: string
  attachments: string
  activity: string | null
  assistant_message: string | null
  citations: string
  artifacts: string
  runtime_config: string
  status: TurnStatus
  created_at: string
  updated_at: string
}

export interface ConversationRow {
  conversation_id: string
  title: string
  created_at: string
  updated_at: string
  archived: number
  project_id: string | null
  model_id: number | null
}

export function mapConversation(row: ConversationRow): ConversationRecord {
  return { id: row.conversation_id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at, archived: Boolean(row.archived), projectId: row.project_id, modelId: row.model_id }
}

export interface AbilityMetaRow {
  ability_type: AbilityType
  ability_id: string
  source: AbilitySource
  plugin_id: string | null
  source_id: string | null
  version: string | null
  installed_at: string
  updated_at: string
  last_used_at: string | null
  use_count: number
  latest_version: string | null
  latest_checked_at: string | null
}

export function mapAbilityMeta(row: AbilityMetaRow): AbilityInstallMeta {
  return {
    abilityType: row.ability_type,
    abilityId: row.ability_id,
    source: row.source,
    pluginId: row.plugin_id ?? undefined,
    sourceId: row.source_id ?? undefined,
    version: row.version ?? undefined,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    useCount: row.use_count,
    latestVersion: row.latest_version ?? undefined,
    latestCheckedAt: row.latest_checked_at ?? undefined
  }
}

export interface AgentRunRow {
  run_id: string
  conversation_id: string
  turn_id: string
  mode: ConversationMode
  status: AgentRunStatus
  started_at: number
  finished_at: number | null
  error: string | null
  error_kind: RunErrorKind | null
  retry_count: number
}

export function mapAgentRun(row: AgentRunRow): AgentRunRecord {
  return {
    runId: row.run_id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    mode: row.mode,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    errorKind: row.error_kind ?? null,
    // 旧库补列前读出来是 undefined，不能直接透传给 UI 做算术
    retryCount: row.retry_count ?? 0
  }
}

export interface AgentTaskRow {
  task_id: string
  run_id: string
  conversation_id: string
  turn_id: string
  parent_tool_call_id: string | null
  sub_agent_run_id: string | null
  agent_id: string
  agent_name: string
  goal: string
  status: AgentTaskStatus
  summary: string | null
  error: string | null
  started_at: number
  finished_at: number | null
  duration_ms: number | null
}

export function mapAgentTask(row: AgentTaskRow): AgentTaskRecord {
  return {
    taskId: row.task_id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    parentToolCallId: row.parent_tool_call_id,
    subAgentRunId: row.sub_agent_run_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    goal: row.goal,
    status: row.status,
    summary: row.summary,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms
  }
}

/** memory 是后加的嵌套设置，旧记录里整块缺失或只有半截字段，浅合并补不回来。 */
export function normalizeMemorySettings(value: Partial<MemorySettings> | undefined): MemorySettings {
  return {
    enabled: value?.enabled ?? true,
    autoExtract: value?.autoExtract ?? true,
    maxRecall: clampRecallLimit(value?.maxRecall),
    extractModelId: typeof value?.extractModelId === 'number' ? value.extractModelId : null
  }
}

export interface MemoryRow {
  memory_id: string
  scope: MemoryScope
  scope_id: string | null
  type: MemoryType
  content: string
  importance: number
  confidence: number
  source_conversation_id: string | null
  source_turn_id: string | null
  source_run_id: string | null
  status: MemoryStatus
  superseded_by: string | null
  created_at: number
  updated_at: number
  last_accessed_at: number | null
  expires_at: number | null
}

export function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.memory_id,
    scope: row.scope,
    scopeId: row.scope_id,
    type: row.type,
    content: row.content,
    importance: row.importance,
    confidence: row.confidence,
    sourceConversationId: row.source_conversation_id,
    sourceTurnId: row.source_turn_id,
    sourceRunId: row.source_run_id,
    status: row.status,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    expiresAt: row.expires_at
  }
}

export function emptyConnectionSnapshot(): McpConnectionSnapshot {
  return { state: 'unknown', error: null, toolCount: 0, resourceCount: 0, promptCount: 0, tools: [] }
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function normalizeTurnActivity(activity: TurnActivity | null, turnStatus: TurnStatus): TurnActivity | null {
  if (!activity) return null
  if (!activity.execution) return activity
  const execution: ExecutionSnapshot = { ...activity.execution, status: turnStatus === 'completed' ? 'completed' : turnStatus === 'failed' || turnStatus === 'interrupted' ? 'failed' : turnStatus === 'cancelled' ? 'cancelled' : activity.execution.status }
  if (execution.status !== 'running') {
    execution.activeStepId = null
    execution.activeEventId = null
    execution.activeThinkingId = null
    execution.steps = execution.steps.map((step) => step.status === 'running' ? { ...step, status: execution.status } : step)
    execution.events = execution.events.map((event) => event.status === 'running' ? { ...event, status: execution.status, completedAt: event.completedAt ?? Date.now() } : event)
  }
  return { ...activity, execution }
}
